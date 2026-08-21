/**
 * ADAPTERS LAYER — Conversation Summary Service
 *
 * Generates an AI summary of an ongoing conversation for the operator's
 * right-rail panel. Marcos's request #2: when a conversation is open,
 * the right side shows nombre, resumen rápido de lo hablado, datos
 * claves — so the operator gets context fast and never re-reads the
 * whole thread.
 *
 * Trigger model: best-effort, debounced. Called from the conversation
 * handler after every saved CUSTOMER message via a void promise — never
 * blocks the customer reply path, and any failure (Claude rate limit,
 * budget cap, network) silently leaves the previous summary in place.
 *
 * Cost control: the regenerate gate skips Claude entirely when the
 * conversation hasn't changed enough since the last summary (see the
 * CONVERSATION_SUMMARY_* env vars below).
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaClient, MessageSender } from '@prisma/client';
import { NotificationsGateway } from '../../infrastructure/notifications/notifications.gateway';
import { getMessageCipher } from '../security/message-cipher';

export interface ConversationSummary {
  summary: string;          // 1–3 sentences, plain Spanish
  products: string[];       // product names / SKUs mentioned by the customer
  status: string;           // short status descriptor ("Esperando precio", "Cotización enviada", "Reclamando demora")
  keyFacts: string[];       // bullet-point data points (cantidad, presupuesto, dirección, urgencia)
  updatedAt: string;        // ISO timestamp
  messageCount: number;     // total messages in conversation at generation time
}

@Injectable()
export class ConversationSummaryService {
  private readonly logger = new Logger(ConversationSummaryService.name);
  private readonly prisma: PrismaClient;
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly minMessagesToSummarize: number;
  private readonly minNewMessagesToRegenerate: number;
  private readonly debounceMs: number;
  private readonly historyWindow: number;

  constructor(
    private readonly gateway: NotificationsGateway,
    @Optional() prismaShared?: import('../repositories/prisma.service').PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
    const apiKey = process.env.CLAUDE_API_KEY;
    this.client = apiKey && apiKey !== 'sk-ant-your-api-key-here' ? new Anthropic({ apiKey }) : null;
    this.model = process.env.CONVERSATION_SUMMARY_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
    this.maxTokens = parseInt(process.env.CONVERSATION_SUMMARY_MAX_TOKENS || '500', 10);
    this.minMessagesToSummarize = parseInt(
      process.env.CONVERSATION_SUMMARY_MIN_MESSAGES || '3',
      10,
    );
    this.minNewMessagesToRegenerate = parseInt(
      process.env.CONVERSATION_SUMMARY_MIN_NEW_MESSAGES || '2',
      10,
    );
    this.debounceMs = parseInt(
      process.env.CONVERSATION_SUMMARY_DEBOUNCE_MS || '60000',
      10,
    );
    this.historyWindow = parseInt(
      process.env.CONVERSATION_SUMMARY_HISTORY_WINDOW || '30',
      10,
    );
    if (this.client) {
      this.logger.log(
        `✅ Summary service ready (model=${this.model}, min-msgs=${this.minMessagesToSummarize}, regen-after=${this.minNewMessagesToRegenerate}, debounce=${this.debounceMs}ms, window=${this.historyWindow})`,
      );
    } else {
      this.logger.warn('Summary service disabled — CLAUDE_API_KEY not configured');
    }
  }

  /**
   * Fire-and-forget entrypoint called by the conversation handler after a
   * customer message is saved. Returns immediately; the actual work runs
   * detached. Errors are logged at debug level — the previous summary
   * stays in place on failure.
   *
   * `force=true` skips the time + delta debounce so an operator-driven
   * "refrescar" click always regenerates, even if the last summary is
   * fresh. The min-messages floor still applies (no point summarizing
   * a 1-message conversation).
   */
  scheduleRegenerate(conversationId: string, force = false): void {
    if (!this.client) return;
    void this.tryRegenerate(conversationId, force).catch((err) => {
      this.logger.debug(`Summary regenerate skipped for ${conversationId}: ${err?.message || err}`);
    });
  }

  /**
   * Read the current cached summary. Returns null when the conversation
   * has never been summarized (e.g. very new, no inbound customer
   * messages yet).
   */
  async getSummary(conversationId: string): Promise<ConversationSummary | null> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        aiSummary: true,
        aiSummaryUpdatedAt: true,
        aiSummaryMessageCount: true,
      },
    });
    if (!conv || !conv.aiSummary) return null;
    const stored = conv.aiSummary as any;
    return {
      summary: stored.summary || '',
      products: Array.isArray(stored.products) ? stored.products : [],
      status: stored.status || '',
      keyFacts: Array.isArray(stored.keyFacts) ? stored.keyFacts : [],
      updatedAt: conv.aiSummaryUpdatedAt?.toISOString() || new Date().toISOString(),
      messageCount: conv.aiSummaryMessageCount || 0,
    };
  }

  private async tryRegenerate(conversationId: string, force = false): Promise<void> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        aiSummaryUpdatedAt: true,
        aiSummaryMessageCount: true,
        contact: { select: { name: true } },
        _count: { select: { messages: true } },
      },
    });
    if (!conv) return;

    const total = conv._count.messages;
    if (total < this.minMessagesToSummarize) {
      this.logger.debug(`Summary skipped ${conversationId}: only ${total} messages`);
      return;
    }

    const lastCount = conv.aiSummaryMessageCount ?? 0;
    const lastAt = conv.aiSummaryUpdatedAt?.getTime() ?? 0;
    const now = Date.now();

    // Two debounces in series (only when NOT forced by an operator click):
    //  - Time gate: if we just summarized < debounceMs ago, skip.
    //  - Delta gate: if fewer than minNewMessages have been added since
    //    the last summary, skip. Combined they prevent burst regeneration
    //    when a customer sends 5 rapid-fire messages.
    if (!force) {
      if (lastAt > 0 && now - lastAt < this.debounceMs) {
        this.logger.debug(
          `Summary skipped ${conversationId}: debounced (${Math.round((now - lastAt) / 1000)}s ago)`,
        );
        return;
      }
      if (total - lastCount < this.minNewMessagesToRegenerate) {
        this.logger.debug(
          `Summary skipped ${conversationId}: only ${total - lastCount} new messages since last summary`,
        );
        return;
      }
    }

    const summary = await this.generate(conversationId, conv.contact?.name || null);
    if (!summary) return;

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        aiSummary: summary as any,
        aiSummaryUpdatedAt: new Date(),
        aiSummaryMessageCount: total,
      },
    });

    this.gateway.broadcast('conversation:summary:updated', {
      conversationId,
      messageCount: total,
      at: new Date().toISOString(),
    });

    this.logger.log(`📝 Summary regenerated for ${conversationId} (${total} messages)`);
  }

  private async generate(
    conversationId: string,
    contactName: string | null,
  ): Promise<Omit<ConversationSummary, 'updatedAt' | 'messageCount'> | null> {
    if (!this.client) return null;

    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { timestamp: 'desc' },
      take: this.historyWindow,
      select: { sender: true, content: true, isFromAI: true, timestamp: true },
    });
    // Reverse so the prompt reads oldest → newest.
    messages.reverse();

    const cipher = getMessageCipher();
    const transcript = messages
      .map((m) => {
        const who =
          m.sender === MessageSender.CUSTOMER
            ? 'Cliente'
            : m.isFromAI
              ? 'Agente IA'
              : 'Operador';
        const text = cipher.decrypt(m.content || '').replace(/\s+/g, ' ').trim();
        return `${who}: ${text}`;
      })
      .filter((line) => line.length > 0)
      .join('\n');

    const prompt = [
      'Sos un asistente que prepara contexto rápido para el operador que va a responder esta conversación.',
      contactName ? `El cliente se llama: ${contactName}.` : 'El cliente no tiene nombre registrado.',
      '',
      'Tu salida es JSON puro, sin texto antes ni después, con esta forma exacta:',
      '{"summary":"1-3 oraciones en español describiendo de qué se trata la consulta","products":["productos mencionados por el cliente, en minúsculas, sin precios"],"status":"frase corta del estado actual (ej: Esperando cotización, Reclamando demora, Pidiendo dirección)","keyFacts":["dato útil 1","dato útil 2","dato útil 3"]}',
      '',
      'Reglas:',
      '- Hablá del cliente en tercera persona ("pidió", "consulta", "quiere").',
      '- No inventes datos: si no está en la conversación, no lo pongas.',
      '- keyFacts deben ser hechos concretos: cantidades, dirección, presupuesto, urgencia, tipo de uso. Máximo 4.',
      '- products es solo lo que el cliente mencionó, no recomendaciones del agente.',
      '- status es lo que está pasando AHORA mismo en la conversación, no un historial.',
      '',
      'Transcripción:',
      transcript,
    ].join('\n');

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });
      const block = response.content.find((c: any) => c.type === 'text') as any;
      const text = block?.text ?? '';
      // Extract JSON — Claude sometimes wraps in code fences.
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        this.logger.warn(`Summary parse failed for ${conversationId}: no JSON in response`);
        return null;
      }
      const parsed = JSON.parse(match[0]);
      return {
        summary: String(parsed.summary || '').slice(0, 800),
        products: Array.isArray(parsed.products)
          ? parsed.products.slice(0, 8).map((p: any) => String(p).slice(0, 80))
          : [],
        status: String(parsed.status || '').slice(0, 120),
        keyFacts: Array.isArray(parsed.keyFacts)
          ? parsed.keyFacts.slice(0, 4).map((f: any) => String(f).slice(0, 200))
          : [],
      };
    } catch (error: any) {
      this.logger.debug(`Summary generation error for ${conversationId}: ${error.message}`);
      return null;
    }
  }
}
