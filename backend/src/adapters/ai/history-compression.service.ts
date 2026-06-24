/**
 * ADAPTERS LAYER — Conversation history compression (Bloque E #5).
 *
 * Marcos 2026-06-06 cost optimisation. Long-running WhatsApp / webchat
 * conversations resend every prior message to Claude on every turn —
 * 10+ messages of history multiplied by every fresh customer reply
 * adds up. This service collapses the OLDER portion of a conversation
 * into a single cacheable summary text block, keeping only the last
 * few messages verbatim. The system block hits prompt cache between
 * turns, so the cost per turn drops by the size of the compressed
 * window.
 *
 * Strategy:
 *   - When the conversation has fewer than `threshold` messages, do
 *     nothing — full verbatim history is cheap enough.
 *   - Otherwise, read the existing `ConversationSummaryService`
 *     summary (already maintained for the operator panel) and render
 *     it as a Spanish system block, then return only the last
 *     `tailSize` messages.
 *   - If no summary exists yet (very fresh conversation), fall back
 *     to full verbatim history — there's nothing to compress to.
 *
 * Env knobs (all read at call time so a runtime flip applies without
 * restart):
 *   HISTORY_COMPRESSION_ENABLED        default true
 *   HISTORY_COMPRESSION_THRESHOLD      default 10  (# msgs to start)
 *   HISTORY_COMPRESSION_TAIL_SIZE      default 5   (# msgs verbatim)
 *   HISTORY_COMPRESSION_MAX_BYTES      default 1500
 *   HISTORY_COMPRESSION_CHANNELS       default "WHATSAPP,TIENDANUBE_WEBCHAT,FACEBOOK,INSTAGRAM,MERCADOLIBRE"
 *                                      Marcos 2026-06-24: ML sumado al
 *                                      default. Pre-venta sigue siendo
 *                                      one-shot (queda corto, no entra
 *                                      al umbral), pero los reclamos
 *                                      post-venta van y vuelven varios
 *                                      turnos y ahi si se beneficia.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { ConversationSummaryService } from './conversation-summary.service';
import { CostOptCounterService } from './cost-opt-counter.service';

export interface CompressionResult<TMsg = any> {
  /** Spanish system-block text to push into the prompt (cached), or
   *  null to skip injection. */
  systemBlock: string | null;
  /** Trimmed-from-the-tail message slice the caller should feed into
   *  `buildAIContext`. When `systemBlock` is null this is the full
   *  original list. */
  recentMessages: TMsg[];
  /** True when compression actually fired (caller may want to log it). */
  compressed: boolean;
}

@Injectable()
export class HistoryCompressionService {
  private readonly logger = new Logger(HistoryCompressionService.name);

  constructor(
    private readonly summaries: ConversationSummaryService,
    @Optional() private readonly costOptCounter?: CostOptCounterService,
  ) {}

  enabled(): boolean {
    return (process.env.HISTORY_COMPRESSION_ENABLED ?? 'true').toLowerCase() !== 'false';
  }

  private threshold(): number {
    const n = Number(process.env.HISTORY_COMPRESSION_THRESHOLD);
    return Number.isFinite(n) && n > 0 ? n : 10;
  }

  private tailSize(): number {
    const n = Number(process.env.HISTORY_COMPRESSION_TAIL_SIZE);
    return Number.isFinite(n) && n > 0 ? n : 5;
  }

  private maxBytes(): number {
    const n = Number(process.env.HISTORY_COMPRESSION_MAX_BYTES);
    return Number.isFinite(n) && n > 0 ? n : 1500;
  }

  private channelEnabled(channel?: Channel): boolean {
    const raw = process.env.HISTORY_COMPRESSION_CHANNELS;
    const list = raw && raw.length > 0
      ? raw.split(',').map((s) => s.trim().toUpperCase())
      // Marcos 2026-06-24: ML sumado al default — los reclamos post-venta
      // tienen threads largos donde la compresión ayuda. Pre-venta queda
      // corta y nunca pasa el threshold, asi que no hay riesgo de
      // contexto cortado en el flujo donde no se quiere.
      : ['WHATSAPP', 'TIENDANUBE_WEBCHAT', 'FACEBOOK', 'INSTAGRAM', 'MERCADOLIBRE'];
    if (!channel) return false;
    return list.includes(channel);
  }

  /**
   * The hot path called by the inbound handler right before
   * `buildAIContext`. Returns the maybe-compressed history + a
   * system-block text the caller can hand to ClaudeService via
   * `turn.compressedHistorySummary`.
   *
   * Best-effort: any failure (missing summary, DB hiccup, oversized
   * block) returns the input untouched so the conversation still
   * reaches Claude with full verbatim context.
   */
  async maybeCompress<TMsg = any>(args: {
    conversationId: string;
    channel: Channel;
    fullHistory: TMsg[];
  }): Promise<CompressionResult<TMsg>> {
    const noop: CompressionResult<TMsg> = {
      systemBlock: null,
      recentMessages: args.fullHistory,
      compressed: false,
    };
    if (!this.enabled()) return noop;
    if (!this.channelEnabled(args.channel)) return noop;
    const threshold = this.threshold();
    if (args.fullHistory.length < threshold) return noop;

    try {
      const summary = await this.summaries.getSummary(args.conversationId);
      if (!summary || !summary.summary) {
        // No cached summary yet — the summary service schedules
        // regeneration after every customer message, so the next
        // turn should have one. For THIS turn we leave history
        // verbatim rather than ship Claude a blind cut.
        return noop;
      }
      const block = this.renderBlock(summary, args.fullHistory.length);
      if (!block || Buffer.byteLength(block, 'utf8') > this.maxBytes()) {
        return noop;
      }
      const tail = this.tailSize();
      const recentMessages = args.fullHistory.slice(-tail);
      this.logger.debug(
        `compressed ${args.fullHistory.length} → ${recentMessages.length} msgs (conv=${args.conversationId.slice(0, 8)}, summary=${summary.summary.length}c)`,
      );
      // Marcos 2026-06-24: registramos para el widget de Bloque E.
      // El "ahorro" estimado es ~1000 tokens por mensaje cortado (el
      // promedio de un msg WA tipico). Usamos default del counter
      // (~6K) si no podemos calcular mejor.
      const cutCount = args.fullHistory.length - recentMessages.length;
      const estimatedTokensSaved = Math.max(0, cutCount * 250);
      this.costOptCounter?.record({
        source: 'history-compression',
        intent: `cut:${cutCount}`,
        conversationId: args.conversationId,
        estimatedTokensSaved: estimatedTokensSaved > 0 ? estimatedTokensSaved : undefined,
      });
      return { systemBlock: block, recentMessages, compressed: true };
    } catch (err: any) {
      this.logger.warn(`history compression failed (non-fatal): ${err.message}`);
      return noop;
    }
  }

  /** Render the summary record into a compact Spanish system block. */
  private renderBlock(
    summary: {
      summary: string;
      products: string[];
      status: string;
      keyFacts: string[];
    },
    totalMessages: number,
  ): string | null {
    const lines: string[] = [];
    lines.push(
      '[Resumen de conversación previa — los últimos turnos están copiados textualmente más abajo. Usalo para mantener continuidad sin pedir al cliente que repita.]',
    );
    if (summary.summary) lines.push(`Resumen: ${summary.summary}`);
    if (summary.status) lines.push(`Estado: ${summary.status}`);
    if (summary.products && summary.products.length > 0) {
      lines.push(`Productos mencionados: ${summary.products.join(', ')}`);
    }
    if (summary.keyFacts && summary.keyFacts.length > 0) {
      lines.push('Datos clave:');
      for (const f of summary.keyFacts) lines.push(`- ${f}`);
    }
    lines.push(`(Historial total: ${totalMessages} mensajes.)`);
    const text = lines.join('\n').trim();
    return text.length > 0 ? text : null;
  }
}
