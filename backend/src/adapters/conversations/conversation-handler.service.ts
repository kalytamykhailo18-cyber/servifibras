/**
 * ADAPTERS LAYER - Conversation Handler Service
 * Connects incoming messages to AI and manages conversation history
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { SocialMediaService } from '../social/social-media.service';
import { ConversationSummaryService } from '../ai/conversation-summary.service';
import { ConversationScorerService } from '../quality/conversation-scorer.service';
import { PrismaClient, Channel, MessageSender, ConversationStatus, ContactType, ContentType } from '@prisma/client';
import { IConversationHandler, ConversationHandleResult } from '../../use-cases/conversations/conversation-handler.interface';
import { WhatsAppIncomingMessage } from '../../domain/entities/whatsapp-message.entity';
import { SocialIncomingMessage, SocialPlatform } from '../../domain/entities/social-message.entity';
import { MercadoLibreIncomingMessage, MercadoLibreMessageType } from '../../domain/entities/mercadolibre-message.entity';
import { WebchatIncomingMessage } from '../../domain/entities/webchat-message.entity';
import { ClaudeService } from '../ai/claude.service';
import { AIConversation, AIMessage } from '../../domain/entities/ai-message.entity';
import { getMessageCipher } from '../security/message-cipher';
import { LeadAutoAssignmentService } from '../lead-detection/lead-auto-assignment.service';
import { MetricsBroadcaster } from '../../infrastructure/notifications/metrics-broadcaster.service';
import {
  HUMAN_HANDOFF_DETECTOR,
  IHumanHandoffDetector,
} from '../../use-cases/lead-detection/human-handoff-detector.interface';
import { HumanHandoffService } from '../lead-detection/human-handoff.service';
import { ContactDimensionsService } from '../lead-detection/contact-dimensions.service';
import {
  COMPLEXITY_CLASSIFIER,
  IComplexityClassifier,
} from '../../use-cases/lead-detection/complexity-classifier.interface';
import { OrderStatusReplyService } from './order-status-reply.service';
import { FaqPreAiService } from './faq-pre-ai.service';
import { ProductLookupShortcutService } from './product-lookup-shortcut.service';
import { PublicationFaqService } from '../admin/publication-faq.service';
import { MlPublicationKnowledgeService } from '../admin/ml-publication-knowledge.service';
import { MlBatchQueueService } from '../ai/ml-batch-queue.service';
import { HistoryCompressionService } from '../ai/history-compression.service';
import { looksLikeTestContactName } from './test-contact-patterns';
import { isAcknowledgment, looksLikeUnresolvedFromStaff, claudeConfirmAckCloses } from './acknowledgment-detector';
// Used only in the MercadoLibre handler — optional injection so the
// other channel modules' instances of this handler don't need to
// resolve the ML service.
import type { MercadoLibreService } from '../mercadolibre/mercadolibre.service';
import { MERCADOLIBRE_SERVICE } from '../../use-cases/mercadolibre/mercadolibre.token';

@Injectable()
export class ConversationHandlerService implements IConversationHandler {
  private readonly logger = new Logger(ConversationHandlerService.name);
  private readonly prisma: PrismaClient;

  constructor(
    private readonly claudeService: ClaudeService,
    private readonly leadAutoAssignment: LeadAutoAssignmentService,
    private readonly metrics: MetricsBroadcaster,
    @Inject(HUMAN_HANDOFF_DETECTOR)
    private readonly handoffDetector: IHumanHandoffDetector,
    private readonly handoff: HumanHandoffService,
    private readonly contactDimensions: ContactDimensionsService,
    @Inject(COMPLEXITY_CLASSIFIER)
    private readonly complexity: IComplexityClassifier,
    private readonly orderStatusReply: OrderStatusReplyService,
    private readonly faqPreAi: FaqPreAiService,
    private readonly productLookup: ProductLookupShortcutService,
    // Optional — provided by AIModule which is imported by every
    // channel module. Marked optional so unit-test harnesses that
    // instantiate the handler bare don't crash.
    @Optional() private readonly publicationFaq?: PublicationFaqService,
    @Optional() private readonly mlKnowledge?: MlPublicationKnowledgeService,
    // Optional — ML batch queue (Bloque E item 4). When the env flag
    // is on, ML inbound enqueues the question instead of calling
    // Claude inline. The cron in AdminModule dispatches + polls.
    @Optional() private readonly mlBatchQueue?: MlBatchQueueService,
    // Optional — history compression (Bloque E item 5). When the
    // conversation has more than HISTORY_COMPRESSION_THRESHOLD turns
    // the older portion gets collapsed to a cached system block, and
    // only the tail goes to Claude verbatim. Saves the input-token
    // bill on long-running WA/webchat threads.
    @Optional() private readonly historyCompression?: HistoryCompressionService,
    // Optional — only the Social module instance has it wired; the
    // WhatsApp module's handler instance leaves it undefined. WA Cloud
    // doesn't expose contact photos anyway, so the omission is correct.
    @Optional() private readonly socialMedia?: SocialMediaService,
    // Optional — wired by modules that import NotificationsModule
    // (everything except embedded scripts). The summary regenerate is
    // best-effort: if the service is absent in some context, we just
    // skip generation rather than crash.
    @Optional() private readonly summary?: ConversationSummaryService,
    // Same pattern as the summary service — wired only in module
    // contexts that have the quality scorer available. Live rescoring
    // runs after each AI reply to keep the right-rail score panel
    // fresh without waiting for the conversation to close.
    @Optional() private readonly scorer?: ConversationScorerService,
    // Optional — only the MercadoLibre module instance has this wired.
    // When present, `handleMercadoLibreMessage` fetches the listing
    // referenced by `message.itemId` and hands it to Claude as a
    // per-turn system block so replies are anchored to the actual ML
    // publication. WhatsApp / Webchat handlers ignore it.
    @Optional() @Inject(MERCADOLIBRE_SERVICE)
    private readonly mercadolibre?: MercadoLibreService,
    // Marcos 2026-08-21: shared Prisma pool. Cae a un local
    // PrismaClient si el módulo global no está resuelto (paths
    // standalone / tests / scripts).
    @Optional() prismaShared?: import('../repositories/prisma.service').PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  /**
   * Try the deterministic order-status auto-reply. Returns the canned text
   * to send, or `null` to fall through to Claude. Errors are swallowed inside
   * the service — nothing here should ever break the inbound pipeline.
   */
  private async tryOrderStatusReply(
    contactId: string,
    text: string,
  ): Promise<string | null> {
    try {
      return await this.orderStatusReply.maybeReply(contactId, text);
    } catch (err: any) {
      this.logger.error(`Order-status reply errored (non-fatal): ${err.message}`);
      return null;
    }
  }

  /**
   * Try the deterministic pre-AI FAQ shortcut (horarios / dirección /
   * envíos). Returns the canned QuickReply content if a known intent
   * matched and the corresponding `faq-*` shortcut is configured, or
   * `null` to fall through to Claude. Errors are swallowed inside the
   * service — same contract as `tryOrderStatusReply`.
   */
  private async tryFaqPreAiReply(
    channel: Channel,
    text: string,
  ): Promise<string | null> {
    try {
      return await this.faqPreAi.maybeReply(channel, text);
    } catch (err: any) {
      this.logger.error(`FAQ pre-AI reply errored (non-fatal): ${err.message}`);
      return null;
    }
  }

  /**
   * Bloque E item 3 — Marcos 2026-06-06 cost optimisation: per-listing
   * operator-curated FAQs. When an ML inbound matches an active FAQ
   * registered for that item, answer instantly (zero Claude tokens)
   * and bump the hit counter. Returns null to fall through.
   */
  /**
   * Marcos 2026-06-24 (Phase C — modo cerrado de respuesta). Si la
   * publicación tiene suficientes Q&A curadas, corremos Haiku con un
   * prompt cerrado que sólo lee de la ficha + Q&A validadas. Sin
   * tools, sin RAG, sin historial. Si el modelo declina (no puede
   * contestar con la info de arriba) devuelve null y el caller cae
   * al pipeline regular. Errores son swallowed — nunca rompen el flujo.
   */
  private async tryConstrainedReply(args: {
    itemId: string;
    buyerQuestion: string;
    buyerNickname?: string | null;
    listing?: any;
    accountKey?: 'mercadolibre' | 'mercadolibre_cuenta2' | null;
  }): Promise<{ reply: string; autoSendAllowed: boolean; selfEvalScore: number } | null> {
    if (!this.mlKnowledge) return null;
    try {
      const r = await this.mlKnowledge.tryConstrainedReply(args);
      if (!r.usedConstrained || !r.reply) return null;
      this.logger.log(
        `🔒 Constrained reply ${args.itemId} (${r.curatedRowsUsed} curated rows, self-eval=${(r.selfEvalScore ?? 0).toFixed(1)}, autoSend=${r.autoSendAllowed})`,
      );
      return {
        reply: r.reply,
        autoSendAllowed: !!r.autoSendAllowed,
        selfEvalScore: r.selfEvalScore ?? 0,
      };
    } catch (err: any) {
      this.logger.warn(`Constrained reply non-fatal failure: ${err.message}`);
      return null;
    }
  }

  private async tryPublicationFaqReply(args: {
    channel: Channel;
    itemId: string | null | undefined;
    text: string;
  }): Promise<string | null> {
    if (args.channel !== Channel.MERCADOLIBRE) return null;
    if (!args.itemId || !this.publicationFaq) return null;
    try {
      const match = await this.publicationFaq.findMatch(args.itemId, args.text);
      if (!match) return null;
      void this.publicationFaq.recordHit(match.id);
      this.logger.log(
        `📚 Publication FAQ hit for item ${args.itemId}: faq=${match.id.slice(0, 8)} keywords=[${match.keywords.join(',')}]`,
      );
      return match.answer;
    } catch (err: any) {
      this.logger.error(`Publication FAQ lookup errored (non-fatal): ${err.message}`);
      return null;
    }
  }

  /**
   * Bloque E item 1 — Marcos 2026-06-06 cost optimisation: when the
   * inbound is a simple "precio?" / "stock?" / "cuánto sale" against
   * a known product, answer from the catalog instead of paying for a
   * Claude call. Routes by channel: ML uses the per-turn listing
   * context; WA / webchat fuzzy-match against Product catalog (only
   * fires on an unambiguous single-product hit).
   */
  private async tryProductLookupReply(args: {
    channel: Channel;
    text: string;
    mlListing?: {
      title: string | null;
      price: number | null;
      availableQuantity: number | null;
      currencyId: string | null;
    } | null;
  }): Promise<string | null> {
    try {
      if (args.channel === Channel.MERCADOLIBRE) {
        return await this.productLookup.tryMlReply({
          text: args.text,
          listing: args.mlListing ?? null,
        });
      }
      return await this.productLookup.tryGenericReply({
        text: args.text,
        channel: args.channel,
      });
    } catch (err: any) {
      this.logger.error(`Product lookup shortcut errored (non-fatal): ${err.message}`);
      return null;
    }
  }

  /**
   * Re-read the conversation's `aiPaused` flag from the DB. We re-read here
   * (rather than trusting the find-or-create return value) because the flag
   * can flip between message arrivals — an operator may have hit "Pausar IA"
   * while the previous customer message was being processed.
   */
  private async isAiPaused(conversationId: string): Promise<boolean> {
    try {
      const c = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { aiPaused: true },
      });
      return !!c?.aiPaused;
    } catch {
      // On read failure default to "not paused" so a flaky DB doesn't
      // accidentally silence the AI for everyone.
      return false;
    }
  }

  /**
   * Detect a laminado PRFV (poliéster reforzado con fibra de vidrio)
   * cotization request on an ML pre-venta question. Marcos's 2026-06-01
   * rule: the AI must NOT answer these — they go straight to a human
   * operator because the price depends on cut, thickness, finish and
   * volume that only the team can confirm.
   *
   * Two trigger paths:
   *   (a) Question text mentions a laminate-family product (laminado,
   *       lámina, plancha, PRFV, revestimiento fibra) AND has a pricing
   *       intent (presupuesto, cotización, precio, X m², a medida).
   *   (b) The PUBLICATION the question is on is laminate-family (title
   *       contains those keywords), AND the question has pricing /
   *       quantity intent — even if the buyer doesn't repeat the word
   *       "lámina" in their question. Marcos 2026-06-02: an ML buyer
   *       asked "Yo necesito 10 metros x el ancho de 2,60mtrs. El total
   *       es el valor x 10?" on a "Lámina Prfv Revestimiento" listing,
   *       and the agent answered. The text-only detector missed it
   *       because the buyer never wrote "lámina".
   *
   * Pure availability questions ("¿tenés láminas?") still get an AI
   * reply — both paths require a pricing/quantity signal.
   */
  private isLaminadoPrfvCotizationQuestion(
    text: string,
    publicationTitle?: string | null,
  ): boolean {
    if (!text) return false;
    const raw = text.toLowerCase();
    const LAMINATE_RE =
      /\b(lamin(?:a|ado|ados)|l[áa]mina[s]?|plancha[s]?|revestimiento[s]?\s+(?:de\s+)?fibra|prfv|panel(?:es)?\s+(?:de\s+)?fibra)\b/;
    const PRICING_INTENT_RE =
      /\b(presupuesto|presupuestar|cotiz(?:o|aci[óo]n|ar|ame|arme|adlo)|cu[áa]nto\s+(?:sale|cuesta|me\s+sale|me\s+saldr[íi]a|me\s+cobra[sn]?)|precio\s+(?:por|de|final|total)|valor\s+(?:por|de|final|total)|\d+\s*m\s*[²2]|a\s+medida\b|medidas\b)/;
    // Broader quantitative-intent regex: any X metros / X mtrs / X
    // unidades / "el total es / cuánto me sale" phrasing. The publication-
    // context path uses this because buyers on laminate listings often
    // ask for quotes without using the word "presupuesto" — they just
    // give dimensions and ask the total.
    const QUANTITATIVE_INTENT_RE =
      /\b(\d+\s*(?:metros?|mtrs?|m\s*lineales?|m\s*[²2]|unidades?|kg))\b|\bel\s+total\b|\bvalor\s+x\s*\d+\b|\bcu[aá]nto\b/;

    // Path (a): text-only — same as before.
    if (LAMINATE_RE.test(raw) && PRICING_INTENT_RE.test(raw)) return true;

    // Path (b): publication-context — if the listing the question is
    // anchored to is itself a laminate-family product, treat any
    // pricing/quantity intent in the buyer's text as a cotization
    // request. This catches "10 metros x el ancho de 2,60mtrs" style
    // questions where the buyer doesn't repeat the product name.
    if (publicationTitle) {
      const titleLower = publicationTitle.toLowerCase();
      if (LAMINATE_RE.test(titleLower)) {
        if (PRICING_INTENT_RE.test(raw) || QUANTITATIVE_INTENT_RE.test(raw)) return true;
      }
    }

    return false;
  }

  /**
   * Run Marcos's 3-level complexity check on an inbound customer message.
   * Returns whether the AI should still respond:
   *   L1 — yes, AI replies normally
   *   L2 — yes, AI replies + we flag the conversation for Brenda's queue
   *   L3 — NO, escalate to human-only and skip Claude entirely
   *
   * Errors are logged, never thrown — classification must not break the
   * customer-reply pipeline. On error we default to L1 ("AI replies") to
   * avoid silently dropping legitimate traffic.
   */
  private async classifyAndMaybeEscalate(
    conversationId: string,
    contactId: string,
    text: string,
  ): Promise<{ aiShouldRespond: boolean; level: 1 | 2 | 3 }> {
    try {
      const cls = await this.complexity.classify(text);
      this.logger.log(`🎚️ Complexity classified: L${cls.level} (${cls.reason}) signals=${cls.signals.join(',')}`);
      if (cls.level === 3) {
        await this.handoff.escalate({
          conversationId,
          contactId,
          source: 'customer',
          signals: cls.signals,
          reason: 'complexity_l3:' + cls.reason,
        });
        return { aiShouldRespond: false, level: 3 };
      }
      if (cls.level === 2) {
        // AI still replies, but Brenda also gets the conversation flagged
        // so she follows up. We use the same escalation primitive so the
        // existing UI badge / Socket.io flow lights up — the conversation
        // continues active, the flag clears when Brenda replies.
        await this.handoff.escalate({
          conversationId,
          contactId,
          source: 'customer',
          signals: cls.signals,
          reason: 'complexity_l2:' + cls.reason,
        });
        return { aiShouldRespond: true, level: 2 };
      }
      return { aiShouldRespond: true, level: 1 };
    } catch (err: any) {
      this.logger.error(`Complexity classify failed (non-fatal, defaulting to L1): ${err.message}`);
      return { aiShouldRespond: true, level: 1 };
    }
  }

  /**
   * Detect explicit-handoff signals and escalate the conversation. Errors are
   * logged but never thrown — handoff detection must never break the
   * customer-reply pipeline.
   */
  private async tryHandoff(
    conversationId: string,
    contactId: string,
    text: string,
    side: 'customer' | 'ai',
  ): Promise<void> {
    try {
      const detection =
        side === 'customer'
          ? await this.handoffDetector.detectInCustomerMessage(text)
          : await this.handoffDetector.detectInAIReply(text);
      if (!detection.needsHuman) return;

      await this.handoff.escalate({
        conversationId,
        contactId,
        source: detection.source!,
        signals: detection.signals,
        reason: detection.reason ?? 'unknown',
      });
    } catch (err: any) {
      this.logger.error(`Handoff detection failed (non-fatal): ${err.message}`);
    }
  }

  /**
   * Run mayorista detection on an inbound customer message and return the
   * outcome so the caller can gate the AI reply. Marcos's policy: the
   * agent does NOT cotize for mayoristas — those go to Franco for manual
   * pricing. Errors are logged but never thrown — lead detection must
   * never break the customer-reply pipeline. When detection fails, we
   * return a "not_mayorista" outcome so retail still gets a normal reply.
   */
  private async tryAutoAssignLead(
    contactId: string,
    conversationId: string,
    channel: Channel,
    text: string,
  ): Promise<{ isMayorista: boolean; result: any }> {
    try {
      const result = await this.leadAutoAssignment.processInboundMessage({
        contactId,
        conversationId,
        channel,
        text,
      });
      if (result.created) {
        this.logger.log(
          `🎯 Lead ${result.leadId} auto-created from ${channel} (assigned: ${result.assignedTo ?? 'NONE'})`,
        );
      }
      const isMayorista = result.reason !== 'not_mayorista';
      return { isMayorista, result };
    } catch (err: any) {
      this.logger.error(`Lead auto-assignment failed (non-fatal): ${err.message}`);
      return { isMayorista: false, result: null };
    }
  }

  /**
   * Mayorista gate. Detected MAYORISTA messages skip Claude entirely,
   * flag the conversation for human handoff (Franco gets the lead +
   * sees "Pendiente humano" on the inbox card), and return a canned
   * Spanish acknowledgment so the customer knows their consulta was
   * received. Per Marcos: "para mayoristas el agente NO cotiza".
   */
  private async escalateMayoristaIfDetected(params: {
    conversationId: string;
    contactId: string;
    text: string;
    channel: Channel;
    /** When true (set by ML pre-venta caller), runs detection + lead
     *  creation for analytics but skips the handoff.escalate call so
     *  the conversation never flips to needsHumanAttention=true and
     *  the canned reply does NOT mention an asesor (since on ML the
     *  buyer may not see any follow-up). */
    suppressEscalation?: boolean;
  }): Promise<{ shouldStopAi: boolean; cannedReply: string | null }> {
    const { isMayorista } = await this.tryAutoAssignLead(
      params.contactId,
      params.conversationId,
      params.channel,
      params.text,
    );
    if (!isMayorista) {
      return { shouldStopAi: false, cannedReply: null };
    }
    if (!params.suppressEscalation) {
      try {
        await this.handoff.escalate({
          conversationId: params.conversationId,
          contactId: params.contactId,
          source: 'customer',
          signals: ['mayorista'],
          reason: 'mayorista_pricing_human_only',
        });
      } catch (err: any) {
        this.logger.error(`Mayorista handoff escalation failed (non-fatal): ${err.message}`);
      }
    }
    // ML pre-venta uses an alt template that does not reference an
    // asesor (no second turn on ML). All other channels keep the
    // legacy "te derivo con un asesor" line.
    const mlTemplate =
      process.env.MAYORISTA_CANNED_REPLY_ML ||
      'Para cotización por volumen mayorista te conviene contactar al vendedor desde la publicación específica de Servifibras en MercadoLibre — ahí te pasamos la lista con descuentos por cantidad.';
    const defaultTemplate =
      process.env.MAYORISTA_CANNED_REPLY ||
      'Recibí tu consulta. Te derivo con un asesor para que te pase la cotización mayorista a medida.';
    const template = params.suppressEscalation ? mlTemplate : defaultTemplate;
    return { shouldStopAi: true, cannedReply: template };
  }

  /**
   * Persist an inbound WhatsApp attachment (voice note / image / video /
   * document) so the operator panel renders the bubble. The webhook
   * controller is responsible for downloading the binary from Meta and
   * storing it via UploadStorageService before calling this — the
   * StoredFile metadata is what we save on the Message row.
   *
   * Marcos 2026-06-06 (Fase 1 cierre): before this method existed, the
   * inbound handler dropped non-text messages on the floor — a customer
   * voice note or photo never reached /conversations. Now it lands as a
   * CUSTOMER message with the attachment fields populated; AI is skipped
   * for media-only turns (no text intent to answer), text + media turns
   * still go through `handleWhatsAppMessage` for the caption.
   */
  async persistInboundWhatsAppAttachment(args: {
    from: string;
    timestamp: Date;
    caption: string | null;
    attachment: {
      url: string;
      name: string;
      mime: string;
      size: number;
      contentType: ContentType;
    };
  }): Promise<ConversationHandleResult> {
    try {
      const contact = await this.findOrCreateContact(args.from);
      const conversation = await this.findOrCreateConversation(contact.id, Channel.WHATSAPP);
      const caption = (args.caption ?? '').trim();
      await this.saveMessage(
        conversation.id,
        MessageSender.CUSTOMER,
        caption,
        false,
        null,
        args.attachment,
      );
      // Reflect the last-message indicator so the operator inbox shows
      // a sensible preview ("📎 photo.jpg" when no caption).
      const preview = caption.length > 0
        ? caption
        : `📎 ${args.attachment.name}`;
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessage: getMessageCipher().encrypt(preview) },
      });
      this.summary?.scheduleRegenerate(conversation.id);
      return { success: true, response: null, error: null };
    } catch (err: any) {
      this.logger.error(`Failed to persist WA inbound attachment: ${err.message}`);
      return { success: false, response: null, error: err.message };
    }
  }

  async handleWhatsAppMessage(
    message: WhatsAppIncomingMessage,
  ): Promise<ConversationHandleResult> {
    try {
      this.logger.log(`Processing message from ${message.from}`);

      // Only handle text messages for now
      if (!message.isTextMessage() || !message.text) {
        this.logger.debug('Non-text message or empty text, skipping AI processing');
        return {
          success: true,
          response: null,
          error: null,
        };
      }

      // Marcos 2026-08-03: dedup por waMessageId. Ahora que también
      // procesamos type='append' (history sync post-reconnect) para no
      // perder inbounds durante disconnects, un mismo mensaje podría
      // llegar dos veces (una vez como notify real-time + otra en el
      // append sync si el timing coincide). Sin este check
      // insertaríamos el customer message duplicado.
      if (message.messageId) {
        const existing = await this.prisma.message.findFirst({
          where: { metadata: { path: ['waMessageId'], equals: message.messageId } },
          select: { id: true },
        });
        if (existing) {
          return { success: true, response: null, error: null };
        }
      }

      // Find or create contact — pass the full JID so we can route
      // outbound to the same scheme (@lid vs @s.whatsapp.net).
      // Marcos 2026-07-06: fallbackLookup permite migrar contactos
      // legacy que quedaron guardados con LID digits como phone.
      const contact = await this.findOrCreateContact(
        message.from,
        message.jid,
        message.fallbackLookup,
        message.pushName,
        message.avatarUrl,
      );

      // Find or create conversation
      const conversation = await this.findOrCreateConversation(contact.id, Channel.WHATSAPP);

      // Load recent conversation history (extended window so Bloque E
      // item 5 history compression has enough material to collapse).
      const recentMessages = await this.getConversationHistory(message.from, this.historyFetchLimit());

      // Build AI conversation context — with possible compression.
      const { aiConversation, compressedHistorySummary } = await this.buildAIContextWithCompression({
        conversationId: conversation.id,
        channel: Channel.WHATSAPP,
        rawHistory: recentMessages,
      });

      // Save customer message to database. Marcos 2026-08-03: stampear
      // el waMessageId como metadata habilita el dedup del bloque de
      // arriba y también deja el mensaje asociable a su origen Baileys
      // para trace / support.
      await this.saveMessage(
        conversation.id,
        MessageSender.CUSTOMER,
        message.text,
        false, // isFromAI
        message.messageId ? { waMessageId: message.messageId, source: 'wa-inbound' } : undefined,
      );

      // Marcos 2026-07-20: si el cliente cierra con "👍 / gracias / ok /
      // dale" DESPUÉS de que el staff/AI ya le dio una respuesta
      // sustantiva (no una pregunta), la conversación se cierra sola
      // — el agente responde una despedida corta, marca CLOSED y no
      // escalamos. Antes cada ack quedaba como "pendiente humano"
      // porque técnicamente el cliente escribió después del staff.
      // Marcos pidió textual: "Si el cliente no preguntó nada más y
      // su consulta fue resuelta y antes ya se lo había saludado se
      // tiene que dar por finalizada la conversación".
      if (await this.maybeAutoCloseOnAck(conversation.id, message.text, recentMessages)) {
        return { success: true, response: 'Bárbaro, cualquier cosa avisame.', error: null };
      }

      // Detect explicit human-handoff request from the customer.
      void this.tryHandoff(conversation.id, contact.id, message.text, 'customer');
      void this.contactDimensions.classifyOnInbound(contact.id, message.text);
      this.summary?.scheduleRegenerate(conversation.id);
      this.metrics.emitTick('inbound_message');

      // Marcos 2026-07-06: la comprobación de aiPaused tiene que correr
      // ANTES que cualquier canned reply o cadena de detección — sino,
      // mayorista + product lookup + FAQ + order-status siguen mandando
      // texto al cliente aunque el operador haya apagado la IA en el
      // detalle. Marcos reportó "algunos mensajes se están respondiendo
      // con IA automáticamente" en WA con la IA por default pausada;
      // trace mostró que el detector mayorista disparaba un canned
      // reply en 4 convs marcadas aiPaused=true. Movido acá arriba del
      // mayorista para que aiPaused corte todo el fan-out.
      if (await this.isAiPaused(conversation.id)) {
        // Marcos 2026-08-18 (replay-harness): con WA por default en
        // aiPaused=true toda pregunta postventa cae en la cola humana
        // aunque la respuesta sea 100% determinística. Antes de
        // escalar, corremos los 3 shortcuts pre-canned
        // (product-lookup / FAQ / order-status) — ninguno usa LLM ni
        // puede alucinar. Si alguno matchea, respondemos directo y
        // evitamos la escalación. Kill-switch:
        // PAUSED_CONV_AUTO_REPLIES_ENABLED=false.
        const pausedAutoReplies =
          (process.env.PAUSED_CONV_AUTO_REPLIES_ENABLED ?? 'true')
            .toLowerCase() === 'true';
        if (pausedAutoReplies) {
          const pProductCanned = await this.tryProductLookupReply({
            channel: conversation.channel,
            text: message.text,
          });
          const pFaqCanned = pProductCanned
            ? null
            : await this.tryFaqPreAiReply(conversation.channel, message.text);
          const pCanned =
            pProductCanned ??
            pFaqCanned ??
            (await this.tryOrderStatusReply(contact.id, message.text));
          if (pCanned) {
            await this.saveMessage(
              conversation.id,
              MessageSender.AI,
              pCanned,
              true,
            );
            this.logger.log(
              `⏸️→📦 aiPaused pero auto-reply determinístico matcheó: "${pCanned.substring(0, 60)}..."`,
            );
            return { success: true, response: pCanned, error: null };
          }
        }
        await this.handoff.escalate({
          conversationId: conversation.id,
          contactId: contact.id,
          source: 'customer',
          signals: ['ai_paused'],
          reason: 'ai_paused_by_operator',
        });
        this.logger.log(`⏸️  AI paused on ${conversation.id} — routed to human queue`);
        return { success: true, response: null, error: null };
      }

      // Mayorista gate — if detected, lead goes to Franco, conversation
      // is flagged for human, AND the AI does NOT cotize (per Marcos's
      // policy: mayorista pricing is manual). The customer gets a short
      // canned acknowledgment so they know the consulta was received.
      const mayorista = await this.escalateMayoristaIfDetected({
        conversationId: conversation.id,
        contactId: contact.id,
        text: message.text,
        channel: Channel.WHATSAPP,
      });
      if (mayorista.shouldStopAi) {
        if (mayorista.cannedReply) {
          await this.saveMessage(conversation.id, MessageSender.AI, mayorista.cannedReply, true);
        }
        this.logger.log(`💼 Mayorista detected on ${conversation.id} — Claude skipped, routed to Ventas`);
        return { success: true, response: mayorista.cannedReply, error: null };
      }

      // Marcos's 3-level routing — L3 (sensitive / complaint) skips the AI
      // entirely so an automated reply doesn't make a delicate situation
      // worse. L2 still gets an AI reply but flags the conversation for
      // Brenda. L1 is the default routine path.
      const route = await this.classifyAndMaybeEscalate(conversation.id, contact.id, message.text);
      if (!route.aiShouldRespond) {
        this.logger.log(`L3 routing — AI skipped, conversation escalated to human queue`);
        return { success: true, response: null, error: null };
      }

      // Deterministic shortcut: if the customer is asking about a previous
      // order ("estado de mi pedido", "tracking"), reply from the DB instead
      // of asking Claude — order numbers and tracking codes are exactly the
      // kind of structured data we don't want hallucinated.
      // Pre-AI FAQ shortcut first (horarios / dirección / envíos) —
      // cheapest possible reply. Order-status check stays second
      // because it needs a DB hit even when intent matches.
      // Bloque E item 1 — Marcos 2026-06-06: product lookup shortcut
      // for "precio?" / "stock?" against an unambiguous catalog
      // match. Runs before the FAQ shortcut because product hits are
      // more specific. Falls through to AI on no-match / ambiguous.
      const productCanned = await this.tryProductLookupReply({
        channel: conversation.channel,
        text: message.text,
      });
      const faqCanned = productCanned
        ? null
        : await this.tryFaqPreAiReply(conversation.channel, message.text);
      const canned =
        productCanned ??
        faqCanned ??
        (await this.tryOrderStatusReply(contact.id, message.text));
      let aiResponse: string;
      if (canned) {
        this.logger.log(`📦 Order-status auto-reply: "${canned.substring(0, 60)}..."`);
        aiResponse = canned;
      } else {
        this.logger.debug(`Sending to AI: "${message.text.substring(0, 50)}..."`);
        aiResponse = await this.claudeService.continueConversation(
          aiConversation,
          message.text,
          {
            channel: conversation.channel,
            isTestTraffic: this.isTestTrafficConv({ isSandbox: conversation.isSandbox, contact }),
            contactId: contact.id,
            level: route.level,
            modelOverride: this.resolveLevelModel(route.level),
            compressedHistorySummary,
          },
        );
      }

      if (!aiResponse || aiResponse.length === 0) {
        throw new Error('AI returned empty response');
      }

      this.logger.log(`AI response: "${aiResponse.substring(0, 50)}..."`);

      // Marcos 2026-07-13 (A3 del documento): en WhatsApp también hay
      // "modo revisión" — gated por WHATSAPP_AUTO_SEND_DISABLED. Cuando
      // está prendido, la respuesta de la IA se guarda con
      // metadata.pendingReview=true y el caller (whatsapp-qr.service)
      // NO la envía automático. El operador la aprueba desde el CRM
      // (mismo criterio que ML). Default OFF — WhatsApp responde
      // automático como venía, salvo que se prenda explícito.
      const waReviewMode =
        (process.env.WHATSAPP_AUTO_SEND_DISABLED ?? 'false').toLowerCase() === 'true';
      const aiMetadata: Record<string, boolean | string> = {};
      if (waReviewMode) aiMetadata.pendingReview = true;

      // Save AI response to database
      await this.saveMessage(
        conversation.id,
        MessageSender.AI,
        aiResponse,
        true, // isFromAI
        Object.keys(aiMetadata).length > 0 ? aiMetadata : undefined,
      );

      // Detect AI-side handoff phrase ("te derivo con un asesor"). Same
      // escalation path as the customer-initiated one.
      void this.tryHandoff(conversation.id, contact.id, aiResponse, 'ai');

      // Update conversation last message
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessage: getMessageCipher().encrypt(aiResponse) },
      });

      return {
        success: true,
        response: aiResponse,
        error: null,
      };
    } catch (error: any) {
      this.logger.error(`Error handling WhatsApp message: ${error.message}`);
      return {
        success: false,
        response: null,
        error: error.message,
      };
    }
  }

  async handleSocialMessage(
    message: SocialIncomingMessage,
  ): Promise<ConversationHandleResult> {
    try {
      this.logger.log(`Processing ${message.platform} message from ${message.from}`);

      // Only handle text messages
      if (!message.needsReply() || !message.text) {
        this.logger.debug('No text content, skipping AI processing');
        return {
          success: true,
          response: null,
          error: null,
        };
      }

      // Determine channel
      const channel = message.platform === SocialPlatform.FACEBOOK
        ? Channel.FACEBOOK
        : Channel.INSTAGRAM;

      // Find or create contact (using sender ID as identifier)
      const contact = await this.findOrCreateSocialContact(
        message.senderId,
        message.from,
        channel,
      );

      // Find or create conversation
      const conversation = await this.findOrCreateConversation(contact.id, channel);

      // Load recent conversation history (extended window so Bloque E
      // item 5 history compression has enough material to collapse).
      const recentMessages = await this.getConversationHistoryById(contact.id, channel, this.historyFetchLimit());

      // Build AI conversation context — with possible compression.
      const { aiConversation, compressedHistorySummary } = await this.buildAIContextWithCompression({
        conversationId: conversation.id,
        channel,
        rawHistory: recentMessages,
      });

      // Save customer message to database
      await this.saveMessage(
        conversation.id,
        MessageSender.CUSTOMER,
        message.text,
        false,
      );

      void this.tryHandoff(conversation.id, contact.id, message.text, 'customer');
      void this.contactDimensions.classifyOnInbound(contact.id, message.text);
      this.summary?.scheduleRegenerate(conversation.id);
      this.metrics.emitTick('inbound_message');

      const mayorista = await this.escalateMayoristaIfDetected({
        conversationId: conversation.id,
        contactId: contact.id,
        text: message.text,
        channel,
      });
      if (mayorista.shouldStopAi) {
        if (mayorista.cannedReply) {
          await this.saveMessage(conversation.id, MessageSender.AI, mayorista.cannedReply, true);
        }
        this.logger.log(`💼 Mayorista detected on ${conversation.id} — Claude skipped, routed to Ventas`);
        return { success: true, response: mayorista.cannedReply, error: null };
      }

      // Marcos's 3-level routing — L3 (sensitive / complaint) skips the AI
      // entirely so an automated reply doesn't make a delicate situation
      // worse. L2 still gets an AI reply but flags the conversation for
      // Brenda. L1 is the default routine path.
      const route = await this.classifyAndMaybeEscalate(conversation.id, contact.id, message.text);
      if (!route.aiShouldRespond) {
        this.logger.log(`L3 routing — AI skipped, conversation escalated to human queue`);
        return { success: true, response: null, error: null };
      }

      // Get AI response
      // Per-conversation AI pause — when an operator hit "Pausar IA" on
      // this thread, save the inbound + escalate to the human queue but
      // do NOT let Claude (or the canned auto-reply) respond.
      if (await this.isAiPaused(conversation.id)) {
        await this.handoff.escalate({
          conversationId: conversation.id,
          contactId: contact.id,
          source: 'customer',
          signals: ['ai_paused'],
          reason: 'ai_paused_by_operator',
        });
        this.logger.log(`⏸️  AI paused on ${conversation.id} — routed to human queue`);
        return { success: true, response: null, error: null };
      }

      // Deterministic shortcut: if the customer is asking about a previous
      // order ("estado de mi pedido", "tracking"), reply from the DB instead
      // of asking Claude — order numbers and tracking codes are exactly the
      // kind of structured data we don't want hallucinated.
      // Pre-AI FAQ shortcut first (horarios / dirección / envíos) —
      // cheapest possible reply. Order-status check stays second
      // because it needs a DB hit even when intent matches.
      // Bloque E item 1 — Marcos 2026-06-06: product lookup shortcut
      // for "precio?" / "stock?" against an unambiguous catalog
      // match. Runs before the FAQ shortcut because product hits are
      // more specific. Falls through to AI on no-match / ambiguous.
      const productCanned = await this.tryProductLookupReply({
        channel: conversation.channel,
        text: message.text,
      });
      const faqCanned = productCanned
        ? null
        : await this.tryFaqPreAiReply(conversation.channel, message.text);
      const canned =
        productCanned ??
        faqCanned ??
        (await this.tryOrderStatusReply(contact.id, message.text));
      let aiResponse: string;
      if (canned) {
        this.logger.log(`📦 Order-status auto-reply: "${canned.substring(0, 60)}..."`);
        aiResponse = canned;
      } else {
        this.logger.debug(`Sending to AI: "${message.text.substring(0, 50)}..."`);
        aiResponse = await this.claudeService.continueConversation(
          aiConversation,
          message.text,
          {
            channel: conversation.channel,
            isTestTraffic: this.isTestTrafficConv({ isSandbox: conversation.isSandbox, contact }),
            contactId: contact.id,
            level: route.level,
            modelOverride: this.resolveLevelModel(route.level),
            compressedHistorySummary,
          },
        );
      }

      if (!aiResponse || aiResponse.length === 0) {
        throw new Error('AI returned empty response');
      }

      this.logger.log(`AI response: "${aiResponse.substring(0, 50)}..."`);

      // Save AI response to database
      await this.saveMessage(
        conversation.id,
        MessageSender.AI,
        aiResponse,
        true,
      );
      void this.tryHandoff(conversation.id, contact.id, aiResponse, 'ai');

      // Update conversation last message
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessage: getMessageCipher().encrypt(aiResponse) },
      });

      return {
        success: true,
        response: aiResponse,
        error: null,
      };
    } catch (error: any) {
      this.logger.error(`Error handling social message: ${error.message}`);
      return {
        success: false,
        response: null,
        error: error.message,
      };
    }
  }

  async handleMercadoLibreMessage(
    message: MercadoLibreIncomingMessage,
  ): Promise<ConversationHandleResult> {
    try {
      this.logger.log(`Processing MercadoLibre ${message.type} from ${message.from}`);

      // Reviews and claims are legally sensitive — they auto-escalate to
      // a human and never get an AI reply. We persist a placeholder so
      // operators see the notification in the inbox; the actual review
      // body is fetched separately via the ML claims/feedback API once
      // OAuth is wired (today: stub kept empty). Marcos's req §6 lists
      // "respuesta a reviews negativos en MercadoLibre" — but until the
      // operator-vs-auto-reply policy is decided in writing, default is
      // ALWAYS escalate, never auto-reply.
      const isReviewOrClaim =
        message.type === MercadoLibreMessageType.REVIEW ||
        message.type === MercadoLibreMessageType.CLAIM;
      if (isReviewOrClaim) {
        const contact = await this.findOrCreateMercadoLibreContact(
          message.fromId,
          message.from,
        );
        const conversation = await this.findOrCreateConversation(
          contact.id,
          Channel.MERCADOLIBRE,
        );
        if (
          message.mlAccountKey &&
          conversation.mlAccountKey !== message.mlAccountKey
        ) {
          try {
            await this.prisma.conversation.update({
              where: { id: conversation.id },
              data: { mlAccountKey: message.mlAccountKey },
            });
            conversation.mlAccountKey = message.mlAccountKey;
          } catch (err: any) {
            this.logger.warn(
              `Failed to stamp mlAccountKey on review/claim ${conversation.id}: ${err.message}`,
            );
          }
        }
        // Bloque A item 2 — Marcos 2026-06-08: prefer the enriched
        // claim text (claim type / status / reason) the post-purchase
        // claims API gave us. Falls back to the legacy placeholder
        // when the message arrived without a body (REVIEW today,
        // CLAIM in older code paths).
        const enriched = (message.text || '').trim();
        const fallback =
          message.type === MercadoLibreMessageType.REVIEW
            ? `[Reseña recibida en MercadoLibre — id ${message.id}]`
            : `[Reclamo recibido en MercadoLibre — id ${message.id}]`;
        const content = enriched.length > 0 ? enriched : fallback;
        // Marcos 2026-06-24 (caso 5529086122 — 6 bubbles idénticas
        // "[Reclamo ML 5529086122] Tipo: mediations · Estado: opened ·
        // Etapa: dispute · Motivo: Llegó bien (PDD9955)"): cada webhook
        // de ML (status change, etapa change, mediación añadiendo step)
        // creaba un Message row nuevo, llenando el panel de duplicados.
        // Ahora upsert por mlResourceId: si ya existe el row para este
        // claim/review, actualizamos contenido + pendingFor + timestamp
        // en lugar de crear otro. Si el contenido es idéntico solo se
        // mueve el updatedAt (el operador igual ve que llegó actividad
        // nueva por el orden de la conversación) pero no se duplica.
        const existing = await this.prisma.message.findFirst({
          where: {
            conversationId: conversation.id,
            metadata: { path: ['mlResourceId'], equals: message.id } as any,
          },
          select: { id: true, content: true },
        });
        const newCipher = getMessageCipher().encrypt(content);
        const newMeta = {
          kind: message.type === MercadoLibreMessageType.REVIEW ? 'ml_review' : 'ml_claim',
          mlResourceId: message.id,
          mlAccountKey: message.mlAccountKey ?? null,
          // Marcos 2026-06-22: 'seller' | 'buyer' | 'ml' — quién tiene
          // el próximo turno según players[].available_actions. El panel
          // de Reclamos segmenta por este campo y prioriza 'seller'.
          pendingFor: (message as any).pendingFor ?? null,
        };
        if (existing) {
          await this.prisma.message.update({
            where: { id: existing.id },
            data: {
              content: newCipher,
              metadata: newMeta as any,
              timestamp: new Date(),
            },
          });
        } else {
          await this.prisma.message.create({
            data: {
              conversationId: conversation.id,
              sender: MessageSender.CUSTOMER,
              content: newCipher,
              isFromAI: false,
              metadata: newMeta as any,
            },
          });
        }
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastMessage: newCipher, lastMessageAt: new Date() },
        }).catch((err) =>
          this.logger.warn(
            `lastMessageAt bump failed on ML review/claim ${conversation.id}: ${err?.message ?? err}`,
          ),
        );
        await this.handoff.escalate({
          conversationId: conversation.id,
          contactId: contact.id,
          source: 'customer',
          signals: [message.type === MercadoLibreMessageType.REVIEW ? 'ml_review' : 'ml_claim'],
          reason:
            message.type === MercadoLibreMessageType.REVIEW
              ? 'mercadolibre_review_needs_human'
              : 'mercadolibre_claim_needs_human',
        });
        this.metrics.emitTick('inbound_message');
        return { success: true, response: null, error: null };
      }

      // Only handle messages that need answers
      if (!message.needsAnswer() || !message.text) {
        this.logger.debug('Message does not need answer, skipping AI processing');
        return {
          success: true,
          response: null,
          error: null,
        };
      }

      // Find or create contact (using MercadoLibre user ID)
      const contact = await this.findOrCreateMercadoLibreContact(
        message.fromId,
        message.from,
      );

      // Find or create conversation
      let conversation = await this.findOrCreateConversation(
        contact.id,
        Channel.MERCADOLIBRE,
      );

      // Bloque B item 1 — stamp the mlAccountKey resolved by the
      // controller. Update when missing OR different from current
      // (handles the rare case where a contact reappears on a
      // different cuenta). Best-effort: a DB hiccup just leaves
      // metrics untagged for this turn.
      if (
        message.mlAccountKey &&
        conversation.mlAccountKey !== message.mlAccountKey
      ) {
        try {
          conversation = await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { mlAccountKey: message.mlAccountKey },
          });
        } catch (err: any) {
          this.logger.warn(
            `Failed to stamp mlAccountKey on ${conversation.id}: ${err.message}`,
          );
        }
      }

      // Load recent conversation history
      // Marcos 2026-07-13 (B2): filtramos por publicación (mlItemId)
      // así el agente sólo ve preguntas de ESTA publicación. Cuando
      // llega inbound sin itemId (raro en pre-venta ML), pasamos null
      // y el historial completo queda como antes para no cortar el
      // hilo. El itemId ya está resuelto arriba como inboundItemId.
      const inboundItemIdForHistory: string | null = message.itemId ? String(message.itemId) : null;
      const recentMessages = await this.getConversationHistoryById(
        contact.id,
        Channel.MERCADOLIBRE,
        10,
        { mlItemId: inboundItemIdForHistory },
      );

      // Build AI conversation context
      const aiConversation = this.buildAIContext(recentMessages);

      // Save customer message to database. Stash the itemId on the
      // message metadata so the /mercadolibre Q&A panel can pivot each
      // question to its publication (thumbnail / title / permalink) —
      // resolved on render via Product.mlPermalink mapping.
      // Marcos 2026-07-06: también stampeamos mlQuestionId — el botón
      // "Regenerar" / "Mejorar con IA" del panel busca la pregunta
      // original por ese path en metadata. Sin mlQuestionId el lookup
      // devolvía "Pregunta original no encontrada" y ni el mejorar ni
      // el regenerar funcionaban.
      const inboundItemId = message.itemId ? String(message.itemId) : null;
      const inboundMeta: Record<string, string> = {};
      if (inboundItemId) inboundMeta.mlItemId = inboundItemId;
      if (message.id) inboundMeta.mlQuestionId = message.id;
      await this.saveMessage(
        conversation.id,
        MessageSender.CUSTOMER,
        message.text,
        false,
        Object.keys(inboundMeta).length > 0 ? inboundMeta : null,
      );

      // ML pre-venta (a QUESTION on a publication) is a one-shot Q&A:
      // the buyer often never re-opens the conversation, so whatever the
      // agent emits in THIS reply is everything they'll read. Marcos's
      // 2026-06-01 clarification: agent must always answer in ONE
      // self-contained message — never escalate to human, never set
      // `needsHumanAttention`, never say "te paso con un asesor". Below
      // we run the SAME signal detectors (mayorista classifier, complexity
      // levels, AI-paused flag) so analytics still see the signals, but
      // we DO NOT trigger `handoff.escalate` (which flips needsHumanAttention
      // and surfaces "pendiente humano" in the panel) and we DO NOT
      // silence the AI. Reviews and claims are POST-purchase and were
      // already gated above — those rightly escalate.
      //
      // tryHandoff is INTENTIONALLY skipped for ML pre-venta — the
      // handoff detector escalates on phrases like "necesito hablar con
      // alguien" / "me pasás con un humano". On ML those trigger
      // needsHumanAttention=true, which violates the one-shot rule.
      void this.contactDimensions.classifyOnInbound(contact.id, message.text);
      this.summary?.scheduleRegenerate(conversation.id);
      this.metrics.emitTick('inbound_message');

      // Fetch publication context FIRST so the laminados detector can
      // see the listing title. Marcos 2026-06-02 surfaced a buyer who
      // asked "10 metros x el ancho de 2,60mtrs. El total es el valor
      // x 10?" on a "Lámina Prfv Revestimiento" listing — the text-only
      // detector missed it because the buyer never wrote "lámina". With
      // the publication title in hand, the path-(b) detector catches
      // these cases.
      let mlListing: import('../../use-cases/ai/ai.interface').AITurnContext['mercadolibreListing'];
      const itemId = message.itemId ? String(message.itemId) : '';
      if (itemId.startsWith('sandbox-sku-')) {
        const sku = itemId.slice('sandbox-sku-'.length).trim();
        if (sku) {
          const product = await this.prisma.product.findFirst({
            where: { sku: { equals: sku, mode: 'insensitive' } },
            select: {
              sku: true, name: true, description: true, basePriceArs: true,
              stockQuantity: true, url: true, category: true, baseUnit: true,
              attributes: true,
            },
          });
          if (product) {
            const attrs: Array<{ id: string; name: string; value: string }> = [];
            if (product.category) attrs.push({ id: 'CATEGORY', name: 'Categoría', value: product.category });
            if (product.baseUnit) attrs.push({ id: 'UNIT', name: 'Unidad', value: product.baseUnit });
            attrs.push({ id: 'SKU', name: 'SKU', value: product.sku });
            mlListing = {
              itemId: `sandbox-sku-${product.sku}`,
              title: product.name,
              subtitle: null,
              price: product.basePriceArs != null ? Number(product.basePriceArs) : null,
              currencyId: 'ARS',
              availableQuantity: product.stockQuantity ?? null,
              condition: 'new',
              permalink: product.url,
              descriptionPlain: product.description?.slice(0, 1000) ?? null,
              attributes: attrs,
              status: 'active',
            };
            this.logger.debug(`ML sandbox listing synthesized from SKU ${product.sku}: ${product.name.slice(0, 50)}`);
          } else {
            this.logger.warn(`ML sandbox synthesis: no Product with SKU "${sku}"`);
          }
        }
      } else if (this.mercadolibre && itemId && !itemId.startsWith('sandbox-')) {
        const fetched = await this.mercadolibre.fetchListingDetails(itemId);
        if (fetched) {
          mlListing = fetched;
          this.logger.debug(
            `ML listing context loaded for turn: ${fetched.itemId} (${fetched.title.slice(0, 50)})`,
          );
        }
      }

      // Laminados PRFV: 2026-06-01 first rule was silence + human handoff.
      // 2026-06-03 pivot (Marcos): give the agent the pricing table and
      // let it cotize directly using the `cotizar_laminado` tool. The
      // detector here stays as a SIGNAL — when fired it flags the
      // conversation for human attention as a safety net (in case the
      // tool can't price the request, or in case the agent's reply
      // mis-quotes), but it no longer silences the AI. The AI replies
      // via the cotizador tool; the operator can intervene in the panel
      // if the quote needs to be revised.
      if (this.isLaminadoPrfvCotizationQuestion(message.text, mlListing?.title ?? null)) {
        try {
          await this.handoff.escalate({
            conversationId: conversation.id,
            contactId: contact.id,
            source: 'customer',
            signals: ['laminado_prfv_cotization'],
            reason: 'laminado_prfv_review_recommended',
          });
        } catch (err: any) {
          this.logger.warn(`Handoff flag for laminado PRFV failed (non-fatal): ${err.message}`);
        }
        this.logger.log(
          `📐 Laminado PRFV cotization detected on ${conversation.id} (ML, title="${mlListing?.title?.slice(0, 50) ?? '-'}") — flagged for review; AI proceeds with cotizar_laminado tool`,
        );
        // Fall through — AI continues to reply via the cotizador tool.
      }

      // Marcos 2026-06-25 (MLA860890755 — "20mt2 de fibra de vidrio + resina
      // para reparar cono de silo"): el detector de mayorista venía
      // disparando el canned "te conviene contactar al vendedor" sobre
      // preguntas técnicas legítimas que mencionaban volumen (20m², 12 tn).
      // En ML el comprador YA está hablando con nosotros — no hay otro
      // canal donde "derivarlo". Skipeamos el canned reply en ML y
      // dejamos que Claude responda la consulta técnica. La clasificación
      // de mayorista sigue corriendo para analytics (taggea el lead).
      void this.tryAutoAssignLead(contact.id, conversation.id, Channel.MERCADOLIBRE, message.text)
        .catch((err: any) => this.logger.warn(`mayorista tagging failed (non-fatal): ${err.message}`));

      // Complexity classifier: on ML we log it AND use the level to pick
      // a cheaper model for L1. L3 does NOT silence the AI here (unlike
      // WhatsApp / webchat) — the buyer gets an AI reply regardless
      // because there's no guaranteed second turn on ML. On classify
      // failure we default to L1, same as the WA/webchat path.
      let mlLevel: 1 | 2 | 3 = 1;
      try {
        const cls = await this.complexity.classify(message.text);
        mlLevel = cls.level;
        this.logger.log(`🎚️ ML complexity classified: L${cls.level} (${cls.reason}) — AI replies regardless on ML pre-venta`);
      } catch (err: any) {
        this.logger.debug(`Complexity classify failed (non-fatal): ${err.message}`);
      }

      // AI pause: on ML we log it but the AI still replies. Pausing AI
      // mid-question on ML would leave the buyer with silence (no
      // guaranteed second turn), which is worse than an automated reply.
      if (await this.isAiPaused(conversation.id)) {
        this.logger.log(`⏸️ AI paused on ${conversation.id} but channel is MERCADOLIBRE — replying anyway (one-shot Q&A)`);
      }

      // (Publication fetch already happened above before the laminados
      // check; mlListing is in scope for the AI call below.)

      // Deterministic shortcut: if the customer is asking about a previous
      // order ("estado de mi pedido", "tracking"), reply from the DB instead
      // of asking Claude — order numbers and tracking codes are exactly the
      // kind of structured data we don't want hallucinated.
      // Pre-AI FAQ shortcut first (horarios / dirección / envíos) —
      // cheapest possible reply. Order-status check stays second
      // because it needs a DB hit even when intent matches.
      // Per-publication FAQ (Bloque E item 3) runs FIRST — operator-
      // curated canned answers are the most specific signal we have on
      // ML, so they outrank the generic product-lookup shortcut.
      // Marcos 2026-06-24 (Phase C — modo cerrado). FIRST shortcut
      // antes que todo: si la publicación tiene Q&A curadas suficientes
      // (>= ML_CONSTRAINED_MIN_CURATED, default 3), corremos Haiku con
      // prompt cerrado que SOLO lee de la ficha + Q&A validadas.
      // Si el modelo declina (devuelve "le paso al equipo") o no hay
      // base suficiente, devuelve null y cae al pipeline regular —
      // FAQ por publicación → product lookup → FAQ pre-AI → agente.
      // Marcos 2026-06-24 (Phase C/D). Modo cerrado retorna ahora un
      // objeto con reply + autoSendAllowed + selfEvalScore. La flag
      // autoSendAllowed la usa el handler downstream para decidir si
      // se envía a ML automaticamente o se deja como pendingReview.
      const constrainedResult =
        conversation.channel === Channel.MERCADOLIBRE && message.itemId && this.mlKnowledge
          ? await this.tryConstrainedReply({
              itemId: String(message.itemId),
              buyerQuestion: message.text,
              buyerNickname: message.from || null,
              listing: mlListing,
              // Marcos 2026-08-04: cuenta 2 firmaba doble ("Tamara" +
              // "Lucas") porque el recall traía Q&A de ambas cuentas
              // para el mismo itemId. Pasar accountKey al recall
              // aísla la cuenta correcta.
              accountKey: (message.mlAccountKey as 'mercadolibre' | 'mercadolibre_cuenta2' | null) ?? null,
            })
          : null;
      const constrainedCanned = constrainedResult?.reply ?? null;
      const publicationFaqCanned = constrainedCanned
        ? null
        : await this.tryPublicationFaqReply({
            channel: conversation.channel,
            itemId: message.itemId ? String(message.itemId) : null,
            text: message.text,
          });
      // Product lookup (Bloque E item 1) runs second — a "precio?"
      // question on a known publication resolves straight from the
      // listing context without a Claude call.
      const productCanned = publicationFaqCanned
        ? null
        : await this.tryProductLookupReply({
            channel: conversation.channel,
            text: message.text,
            mlListing,
          });
      const faqCanned = publicationFaqCanned || productCanned
        ? null
        : await this.tryFaqPreAiReply(conversation.channel, message.text);
      // Marcos 2026-06-24 (MLA859949317 — "Hola, quería saber si hacen
      // envíos a ameghino, Buenos Aires (CP 6064), qué costo tiene y
      // cuándo llegaría"): el detector de intent matcheaba "cuándo
      // llega" como substring de "cuándo llegaría" y disparaba el auto-
      // reply de orden inexistente, leakeando el formato CRM-interno
      // "ORD-AAAA-NNNN" a un comprador de ML pre-venta. El servicio
      // de OrderStatusReply existe para WhatsApp post-venta, no para
      // ML — el comprador de ML rastrea su pedido en ML directamente.
      // Lo skipeamos en este canal entero.
      const orderStatusCanned =
        conversation.channel === Channel.MERCADOLIBRE
          ? null
          : await this.tryOrderStatusReply(contact.id, message.text);
      const canned =
        constrainedCanned ??
        publicationFaqCanned ??
        productCanned ??
        faqCanned ??
        orderStatusCanned;
      let aiResponse: string;
      if (canned) {
        this.logger.log(`📦 Order-status auto-reply: "${canned.substring(0, 60)}..."`);
        aiResponse = canned;
      } else {
        // Bloque E item 4 — Marcos 2026-06-06: batch mode. When the
        // env flag is on AND this is a real ML question (not sandbox,
        // has a question id, not a laminado cotization that needs
        // the tool loop), enqueue it. The dispatcher cron will batch
        // it with peers and post the answer to ML when ready.
        let enqueued = false;
        if (
          this.mlBatchQueue &&
          MlBatchQueueService.modeEnabled() &&
          message.id &&
          !conversation.isSandbox &&
          !this.isLaminadoPrfvCotizationQuestion(message.text, mlListing?.title ?? null)
        ) {
          try {
            await this.mlBatchQueue.enqueue({
              conversationId: conversation.id,
              contactId: contact.id,
              questionId: message.id,
              itemId: message.itemId ? String(message.itemId) : null,
              buyerNickname: message.from || null,
              questionText: message.text,
              conversationContext: aiConversation.messages,
            });
            this.logger.log(
              `📥 ML batch queue: enqueued question ${message.id} (item=${message.itemId ?? '-'}) — no inline Claude call`,
            );
            enqueued = true;
          } catch (err: any) {
            this.logger.error(
              `ML batch enqueue failed (falling back to sync): ${err.message}`,
            );
          }
        }
        if (enqueued) {
          return { success: true, response: null, error: null };
        }

        this.logger.debug(`Sending to AI: "${message.text.substring(0, 50)}..."`);
        // Continuation flag — Marcos 2026-06-06: on ML pre-venta the
        // buyer can ask multiple Qs in a row on the same publication;
        // the FIRST reply opens with "Hola X," and closes with "Un
        // saludo, Lucas...", but subsequent replies should drop the
        // greeting and use a follow-up closer. Heuristic: any prior
        // assistant message in this conversation = continuation.
        const isContinuation = aiConversation.messages.some((m) => m.role === 'assistant');
        aiResponse = await this.claudeService.continueConversation(
          aiConversation,
          message.text,
          {
            channel: conversation.channel,
            mercadolibreListing: mlListing,
            // ML provides the buyer apodo on each question (message.from).
            // Pass it through so ClaudeService can personalise the
            // mandatory ML greeting "Hola {apodo}," + signoff.
            customerName: message.from || null,
            isTestTraffic: this.isTestTrafficConv({ isSandbox: conversation.isSandbox, contact }),
            isContinuation,
            contactId: contact.id,
            level: mlLevel,
            modelOverride: this.resolveLevelModel(mlLevel),
          },
        );
      }

      if (!aiResponse || aiResponse.length === 0) {
        throw new Error('AI returned empty response');
      }

      this.logger.log(`AI response: "${aiResponse.substring(0, 50)}..."`);

      // Save AI response to database
      await this.saveMessage(
        conversation.id,
        MessageSender.AI,
        aiResponse,
        true,
      );
      // tryHandoff INTENTIONALLY skipped on the ML AI-side too — it
      // would re-escalate based on AI phrases ("te paso con un asesor")
      // even when the human-side flag isn't set. The whole ML pre-venta
      // path is no-escalation by design (Marcos 2026-06-01 one-shot
      // rule). The server-side `stripStallingPhrases` already scrubs
      // any "asesor" defer phrase out of the reply before save, so the
      // detector would be acting on a string that's already neutralised.

      // Update conversation last message
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessage: getMessageCipher().encrypt(aiResponse) },
      });

      return {
        success: true,
        response: aiResponse,
        error: null,
        // Marcos 2026-06-24 (Phase D): si la respuesta vino del modo
        // cerrado Y el self-eval pasó el umbral, indicamos al caller
        // (webhook controller) que puede bypass review-mode y enviar
        // a ML directo. Si no, default false → respeta el flag global.
        forceAutoSend: constrainedResult?.autoSendAllowed === true,
        selfEvalScore: constrainedResult?.selfEvalScore,
      };
    } catch (error: any) {
      this.logger.error(`Error handling MercadoLibre message: ${error.message}`);
      return {
        success: false,
        response: null,
        error: error.message,
      };
    }
  }

  async handleWebchatMessage(
    message: WebchatIncomingMessage,
  ): Promise<ConversationHandleResult> {
    try {
      this.logger.log(`Processing Webchat message from ${message.customerName}`);

      if (!message.needsReply() || !message.text) {
        this.logger.debug('Message does not need reply, skipping AI processing');
        return {
          success: true,
          response: null,
          error: null,
        };
      }

      const contact = await this.findOrCreateWebchatContact(
        message.customerId,
        message.customerName,
        message.customerEmail,
      );

      const conversation = await this.findOrCreateConversation(
        contact.id,
        Channel.TIENDANUBE_WEBCHAT,
      );

      const recentMessages = await this.getConversationHistoryById(
        contact.id,
        Channel.TIENDANUBE_WEBCHAT,
        this.historyFetchLimit(),
      );

      const { aiConversation, compressedHistorySummary } = await this.buildAIContextWithCompression({
        conversationId: conversation.id,
        channel: Channel.TIENDANUBE_WEBCHAT,
        rawHistory: recentMessages,
      });

      await this.saveMessage(
        conversation.id,
        MessageSender.CUSTOMER,
        message.text,
        false,
      );

      // Marcos 2026-07-20 (mismo criterio que WhatsApp): auto-cerrar
      // en acknowledgment del cliente cuando el turno previo del
      // staff/AI fue una respuesta sustantiva (no una pregunta).
      if (await this.maybeAutoCloseOnAck(conversation.id, message.text, recentMessages)) {
        return { success: true, response: 'Bárbaro, cualquier cosa avisame.', error: null };
      }

      void this.tryHandoff(conversation.id, contact.id, message.text, 'customer');
      void this.contactDimensions.classifyOnInbound(contact.id, message.text);
      this.summary?.scheduleRegenerate(conversation.id);
      this.metrics.emitTick('inbound_message');

      const mayorista = await this.escalateMayoristaIfDetected({
        conversationId: conversation.id,
        contactId: contact.id,
        text: message.text,
        channel: Channel.TIENDANUBE_WEBCHAT,
      });
      if (mayorista.shouldStopAi) {
        if (mayorista.cannedReply) {
          await this.saveMessage(conversation.id, MessageSender.AI, mayorista.cannedReply, true);
        }
        this.logger.log(`💼 Mayorista detected on ${conversation.id} — Claude skipped, routed to Ventas`);
        return { success: true, response: mayorista.cannedReply, error: null };
      }

      // Marcos's 3-level routing — L3 (sensitive / complaint) skips the AI
      // entirely; L2 lets AI reply but flags Brenda; L1 is routine.
      const route = await this.classifyAndMaybeEscalate(conversation.id, contact.id, message.text);
      if (!route.aiShouldRespond) {
        this.logger.log(`L3 routing — AI skipped, conversation escalated to human queue`);
        return { success: true, response: null, error: null };
      }

      // Per-conversation AI pause — when an operator hit "Pausar IA" on
      // this thread, save the inbound + escalate to the human queue but
      // do NOT let Claude (or the canned auto-reply) respond.
      if (await this.isAiPaused(conversation.id)) {
        await this.handoff.escalate({
          conversationId: conversation.id,
          contactId: contact.id,
          source: 'customer',
          signals: ['ai_paused'],
          reason: 'ai_paused_by_operator',
        });
        this.logger.log(`⏸️  AI paused on ${conversation.id} — routed to human queue`);
        return { success: true, response: null, error: null };
      }

      // Deterministic shortcut: if the customer is asking about a previous
      // order ("estado de mi pedido", "tracking"), reply from the DB instead
      // of asking Claude — order numbers and tracking codes are exactly the
      // kind of structured data we don't want hallucinated.
      // Pre-AI FAQ shortcut first (horarios / dirección / envíos) —
      // cheapest possible reply. Order-status check stays second
      // because it needs a DB hit even when intent matches.
      // Bloque E item 1 — Marcos 2026-06-06: product lookup shortcut
      // for "precio?" / "stock?" against an unambiguous catalog
      // match. Runs before the FAQ shortcut because product hits are
      // more specific. Falls through to AI on no-match / ambiguous.
      const productCanned = await this.tryProductLookupReply({
        channel: conversation.channel,
        text: message.text,
      });
      const faqCanned = productCanned
        ? null
        : await this.tryFaqPreAiReply(conversation.channel, message.text);
      const canned =
        productCanned ??
        faqCanned ??
        (await this.tryOrderStatusReply(contact.id, message.text));
      let aiResponse: string;
      if (canned) {
        this.logger.log(`📦 Order-status auto-reply: "${canned.substring(0, 60)}..."`);
        aiResponse = canned;
      } else {
        this.logger.debug(`Sending to AI: "${message.text.substring(0, 50)}..."`);
        aiResponse = await this.claudeService.continueConversation(
          aiConversation,
          message.text,
          {
            channel: conversation.channel,
            isTestTraffic: this.isTestTrafficConv({ isSandbox: conversation.isSandbox, contact }),
            contactId: contact.id,
            level: route.level,
            modelOverride: this.resolveLevelModel(route.level),
            compressedHistorySummary,
          },
        );
      }

      if (!aiResponse || aiResponse.length === 0) {
        throw new Error('AI returned empty response');
      }

      this.logger.log(`AI response: "${aiResponse.substring(0, 50)}..."`);

      await this.saveMessage(
        conversation.id,
        MessageSender.AI,
        aiResponse,
        true,
      );
      void this.tryHandoff(conversation.id, contact.id, aiResponse, 'ai');

      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessage: getMessageCipher().encrypt(aiResponse) },
      });

      return {
        success: true,
        response: aiResponse,
        error: null,
      };
    } catch (error: any) {
      this.logger.error(`Error handling Webchat message: ${error.message}`);
      return {
        success: false,
        response: null,
        error: error.message,
      };
    }
  }

  async getConversationHistory(phoneNumber: string, limit: number = 10): Promise<any[]> {
    try {
      const contact = await this.prisma.contact.findUnique({
        where: { phone: phoneNumber },
      });

      if (!contact) {
        return [];
      }

      const conversation = await this.prisma.conversation.findFirst({
        where: {
          contactId: contact.id,
          channel: Channel.WHATSAPP,
        },
        include: {
          messages: {
            orderBy: { timestamp: 'desc' },
            take: limit,
          },
        },
      });

      if (!conversation) {
        return [];
      }

      // Return messages in chronological order (oldest first)
      return conversation.messages.reverse();
    } catch (error: any) {
      this.logger.error(`Error loading conversation history: ${error.message}`);
      return [];
    }
  }

  private async findOrCreateContact(
    phoneNumber: string,
    waJid?: string | null,
    fallbackLookup?: string | null,
    // Marcos 2026-07-31: pushName y avatarUrl viajan desde Baileys hasta
    // acá para reemplazar el placeholder "54" del avatar por el nombre
    // real y foto del cliente. Sólo pisan si el name actual sigue siendo
    // el phone (placeholder) o el fallbackLookup — respetan renombres
    // manuales del operador.
    pushName?: string | null,
    avatarUrl?: string | null,
  ) {
    let contact = await this.prisma.contact.findUnique({
      where: { phone: phoneNumber },
    });

    // Marcos 2026-07-06: cuando un cliente arrancó antes de que
    // pudiéramos resolver el phone real (WhatsApp LID), el contacto
    // quedó guardado con los dígitos del LID como phone y como name.
    // Ahora que tenemos el phone real (via remoteJidAlt / senderPn), el
    // findUnique de arriba no encuentra el contacto y podríamos crear
    // uno duplicado. Fallback: buscamos por el identificador previo
    // (LID digits). Si aparece, migramos su phone al real. Esto evita
    // duplicados y muestra el número correcto en el CRM de acá en más.
    if (!contact && fallbackLookup && fallbackLookup !== phoneNumber) {
      const legacy = await this.prisma.contact.findUnique({
        where: { phone: fallbackLookup },
      });
      if (legacy) {
        const existingMeta =
          legacy.metadata && typeof legacy.metadata === 'object' && !Array.isArray(legacy.metadata)
            ? (legacy.metadata as Record<string, string | number | boolean | null>)
            : {};
        const existingWaJid = typeof existingMeta.waJid === 'string' ? existingMeta.waJid : null;
        contact = await this.prisma.contact.update({
          where: { id: legacy.id },
          data: {
            phone: phoneNumber,
            // Si el name era el LID digits (default en el create), lo
            // renombramos al phone real para que no siga apareciendo
            // el string opaco en el listado. Si el operador ya le puso
            // un nombre real ("Juan Pérez"), lo respetamos.
            name: legacy.name === fallbackLookup ? phoneNumber : legacy.name,
            metadata: { ...existingMeta, waJid: waJid ?? existingWaJid ?? null },
          },
        });
        this.logger.log(
          `LID→phone migration: contact ${legacy.id.slice(0, 8)} moved ${fallbackLookup} → ${phoneNumber}`,
        );
      }
    }

    if (!contact) {
      this.logger.log(`Creating new contact: ${phoneNumber} (waJid=${waJid ?? 'n/a'})`);
      const initialName = pushName && pushName.trim().length > 0 ? pushName.trim() : phoneNumber;
      contact = await this.prisma.contact.create({
        data: {
          phone: phoneNumber,
          name: initialName,
          type: ContactType.MINORISTA, // Default, can be updated based on conversation
          channel: Channel.WHATSAPP,
          avatarUrl: avatarUrl ?? null,
          // Marcos 2026-07-03: stash el JID completo (`<num>@<scheme>`) para
          // que WhatsAppService.sendMessage rutee de vuelta con el mismo
          // esquema. Los contactos LID no tienen phone real y sólo se
          // pueden alcanzar por su `<lid>@lid`.
          metadata: waJid ? { waJid } : undefined,
        },
      });
    } else {
      // Marcos 2026-07-31: refrescamos name / avatarUrl / waJid en un
      // solo update para evitar N round-trips. Sólo pisamos name cuando
      // el actual es un placeholder (phone crudo o fallbackLookup) —
      // nunca sobre un rename manual del operador.
      const existingMeta =
        contact.metadata && typeof contact.metadata === 'object' && !Array.isArray(contact.metadata)
          ? (contact.metadata as Record<string, string | number | boolean | null>)
          : {};
      const patch: Record<string, unknown> = {};
      const nameIsPlaceholder =
        !contact.name ||
        contact.name === contact.phone ||
        (!!fallbackLookup && contact.name === fallbackLookup);
      if (pushName && pushName.trim().length > 0 && nameIsPlaceholder) {
        patch.name = pushName.trim();
      }
      if (avatarUrl && contact.avatarUrl !== avatarUrl) {
        patch.avatarUrl = avatarUrl;
      }
      if (waJid && existingMeta.waJid !== waJid) {
        patch.metadata = { ...existingMeta, waJid };
      }
      if (Object.keys(patch).length > 0) {
        contact = await this.prisma.contact.update({
          where: { id: contact.id },
          data: patch,
        });
      }
    }

    return contact;
  }

  private async findOrCreateSocialContact(
    socialId: string,
    name: string,
    channel: Channel,
  ) {
    // Try to find by metadata containing social ID
    let contact = await this.prisma.contact.findFirst({
      where: {
        metadata: {
          path: ['socialId'],
          equals: socialId,
        },
      },
    });

    if (!contact) {
      this.logger.log(`Creating new ${channel} contact: ${name} (${socialId})`);
      contact = await this.prisma.contact.create({
        data: {
          name: name,
          type: ContactType.MINORISTA,
          channel: channel,
          metadata: {
            socialId: socialId,
            platform: channel,
          },
        },
      });
      // Best-effort avatar pull from Graph API (FB Messenger PSID or
      // IG-scoped ID). Runs detached so it never delays the customer
      // reply path; failure is silent and the UI falls back to initials.
      if (this.socialMedia) {
        void (async () => {
          try {
            const profile = await this.socialMedia!.fetchUserProfile(socialId);
            if (profile?.avatarUrl) {
              await this.prisma.contact.update({
                where: { id: contact!.id },
                data: { avatarUrl: profile.avatarUrl },
              });
            }
          } catch {
            // swallow — avatar is decoration
          }
        })();
      }
    }

    return contact;
  }

  private async findOrCreateMercadoLibreContact(
    mlUserId: string,
    nickname: string,
  ) {
    // Try to find by metadata containing MercadoLibre user ID
    let contact = await this.prisma.contact.findFirst({
      where: {
        metadata: {
          path: ['mercadolibreUserId'],
          equals: mlUserId,
        },
      },
    });

    if (!contact) {
      this.logger.log(`Creating new MercadoLibre contact: ${nickname} (${mlUserId})`);
      contact = await this.prisma.contact.create({
        data: {
          name: nickname,
          type: ContactType.MINORISTA,
          channel: Channel.MERCADOLIBRE,
          metadata: {
            mercadolibreUserId: mlUserId,
            platform: 'mercadolibre',
          },
        },
      });
    }

    return contact;
  }

  private async findOrCreateWebchatContact(
    customerId: string,
    customerName: string,
    customerEmail: string | null,
  ) {
    // Try to find by metadata containing webchat customer ID
    let contact = await this.prisma.contact.findFirst({
      where: {
        metadata: {
          path: ['webchatCustomerId'],
          equals: customerId,
        },
      },
    });

    if (!contact) {
      // Marcos 2026-07-20: los tests E2E entran por el mismo endpoint
      // de webchat con nombres tipo "Cliente Handoff" / "Cliente Test
      // 1780..." — antes creábamos el contacto con isSandbox=false y
      // esas rows aparecían para siempre en la cola de Atención. El
      // patrón centralizado en test-contact-patterns.ts es la misma
      // señal que usan claude-budget, conversation-scorer y el
      // conversation-handler para stampear isTestTraffic; ahora
      // también estampa isSandbox en el contact que se crea.
      const isTest = looksLikeTestContactName(customerName);
      if (isTest) {
        this.logger.log(`Creating SANDBOX Webchat contact (test pattern): ${customerName}`);
      } else {
        this.logger.log(`Creating new Webchat contact: ${customerName} (${customerId})`);
      }
      contact = await this.prisma.contact.create({
        data: {
          name: customerName,
          email: customerEmail,
          type: ContactType.MINORISTA,
          channel: Channel.TIENDANUBE_WEBCHAT,
          isSandbox: isTest,
          metadata: {
            webchatCustomerId: customerId,
            platform: 'tiendanube',
          },
        },
      });
    }

    return contact;
  }

  private async getConversationHistoryById(
    contactId: string,
    channel: Channel,
    limit: number = 10,
    opts: { mlItemId?: string | null } = {},
  ): Promise<any[]> {
    try {
      const conversation = await this.prisma.conversation.findFirst({
        where: {
          contactId: contactId,
          channel: channel,
        },
        include: {
          messages: {
            // Marcos 2026-07-13 (B2 del documento): en MercadoLibre, si
            // vino el itemId de la publicación en curso, filtramos el
            // historial a mensajes de ESA publicación. Antes se pasaba
            // el historial completo del comprador mezclando preguntas
            // de publicaciones distintas — el agente cruzaba datos.
            // Los mensajes viejos sin mlItemId en metadata no
            // aparecen; se acepta como trade-off (mejor menos contexto
            // que contexto cruzado).
            ...(opts.mlItemId
              ? {
                  where: {
                    metadata: {
                      path: ['mlItemId'],
                      equals: opts.mlItemId,
                    },
                  },
                }
              : {}),
            orderBy: { timestamp: 'desc' },
            take: limit,
          },
        },
      });

      if (!conversation) {
        return [];
      }

      return conversation.messages.reverse();
    } catch (error: any) {
      this.logger.error(`Error loading conversation history: ${error.message}`);
      return [];
    }
  }

  private async findOrCreateConversation(contactId: string, channel: Channel) {
    let conversation = await this.prisma.conversation.findFirst({
      where: {
        contactId,
        channel,
        status: { in: [ConversationStatus.ACTIVE, ConversationStatus.WAITING] },
      },
    });

    if (!conversation) {
      // Marcos 2026-07-03: WhatsApp arranca en modo CRM puro — cada
      // conversación nueva llega con la IA pausada por default.
      // El operador la reactiva desde el botón "Reactivar IA" del
      // detalle cuando decide dejar que el agente responda ese chat.
      // Otros canales (ML / TN webchat / FB / IG) mantienen la IA
      // activa por default como venía.
      const defaultPausedForChannel =
        channel === Channel.WHATSAPP &&
        (process.env.WHATSAPP_DEFAULT_AI_PAUSED ?? 'false').toLowerCase() === 'true';
      this.logger.log(
        `Creating new conversation for contact ${contactId} (channel=${channel}, aiPaused=${defaultPausedForChannel})`,
      );
      conversation = await this.prisma.conversation.create({
        data: {
          contactId,
          channel,
          status: ConversationStatus.ACTIVE,
          aiPaused: defaultPausedForChannel,
          aiPausedAt: defaultPausedForChannel ? new Date() : null,
        },
      });
    }

    return conversation;
  }

  /**
   * Detect whether a conversation is REALLY test/dev traffic even when
   * `conversation.isSandbox === false`. The E2E suite creates real
   * non-sandbox conversations on the webchat channel with telltale
   * contact names ("Cmplx cmplx-l1-…", "2D Test 2d-generic-…",
   * "Cliente UI Handoff", "Cliente Test …"). Without this fallback
   * those calls land in the "real customer" bucket on the dashboard
   * and inflate the cost-per-question that Marcos reads.
   *
   * Pattern is conservative: anchored prefixes + a unix-ms timestamp
   * tail. Real customers don't have these names.
   */
  private looksLikeTestContact(name: string | null | undefined): boolean {
    return looksLikeTestContactName(name);
  }

  /** True when a conversation should be treated as test traffic for
   *  cost-attribution purposes. Wraps `isSandbox` + the contact-name
   *  heuristic above. */
  private isTestTrafficConv(conv: { isSandbox: boolean; contact?: { name: string | null } | null }): boolean {
    if (conv.isSandbox === true) return true;
    return this.looksLikeTestContact(conv.contact?.name);
  }

  /**
   * Pick the cheapest model that still handles the classified complexity.
   * Marcos's 2026-06-04 cost target: route L1 ("precio?", "stock?",
   * "horarios?") through Haiku, keep Sonnet for L2 (careful reasoning).
   * Returns `undefined` to mean "use ClaudeService's configured default"
   * — that's the L2 path. L3 never reaches here (it's already escalated).
   *
   * Env knobs live in .env (CLAUDE_L1_MODEL, CLAUDE_L2_MODEL); when unset
   * the Haiku/Sonnet IDs we already use elsewhere are the in-code default.
   */
  private resolveLevelModel(level: 1 | 2 | 3): string | undefined {
    if (level === 1) {
      return process.env.CLAUDE_L1_MODEL || 'claude-haiku-4-5-20251001';
    }
    // L2 / L3 fall through to ClaudeService's default (Sonnet).
    const l2 = process.env.CLAUDE_L2_MODEL;
    return l2 && l2.length > 0 ? l2 : undefined;
  }

  /**
   * Marcos 2026-07-06: mirror phone-side outbound al CRM. Cuando
   * alguien del equipo contesta el WhatsApp desde el celular (no
   * desde el CRM), la sesión Baileys ve el evento como `fromMe=true`
   * en messages.upsert. Antes lo tirábamos como "own outgoing echo",
   * pero Marcos quiere ver esas respuestas también en la conversación
   * del CRM para tener el hilo completo en un lugar.
   *
   * Guardamos como sender=ADMIN + isFromAI=false + metadata.source='phone'
   * y stampeamos el messageId de WA en la metadata para poder deduplicar
   * si Baileys re-emite el mismo mensaje después de un reconnect.
   */
  async recordPhoneSideOutbound(args: {
    to: string;          // teléfono real cuando lo tenemos (via remoteJidAlt/senderPn); sino LID
    text: string;
    jid: string;         // full JID (@s.whatsapp.net o @lid)
    waMessageId: string;
    timestamp: Date;
    fallbackLookup?: string | null;  // LID digits legacy (para migrar contactos viejos)
    // Marcos 2026-07-31: pushName + avatarUrl del OTRO extremo (no del
    // que responde desde el celular) para que la fila del inbox tenga
    // identificador aunque el hilo se haya iniciado desde ese lado.
    pushName?: string | null;
    avatarUrl?: string | null;
    attachment?: {
      url: string;
      name: string;
      mime: string;
      size: number;
      contentType: ContentType;
    } | null;
  }) {
    try {
      // Dedup: si ya guardamos este waMessageId, saltamos.
      const existing = await this.prisma.message.findFirst({
        where: {
          metadata: { path: ['waMessageId'], equals: args.waMessageId },
        },
        select: { id: true },
      });
      if (existing) return;

      const contact = await this.findOrCreateContact(
        args.to,
        args.jid,
        args.fallbackLookup ?? null,
        args.pushName ?? null,
        args.avatarUrl ?? null,
      );
      const conversation = await this.findOrCreateConversation(contact.id, Channel.WHATSAPP);
      // Marcos 2026-07-06: si el mensaje del celular es una foto /
      // audio / video / documento, lo pasamos como attachment. El
      // saveMessage cifra el content (caption o vacío) y persiste los
      // metadata del archivo. Si `content` queda vacío el CRM muestra
      // solo la miniatura.
      const contentForRow = args.text || (args.attachment ? '' : '');
      await this.saveMessage(
        conversation.id,
        MessageSender.ADMIN,
        contentForRow,
        false,
        { source: 'phone', waMessageId: args.waMessageId },
        args.attachment ?? null,
      );
      // lastMessage preview: si hay caption la usamos, sino un placeholder
      // por tipo para que la fila del inbox no quede en blanco.
      const preview = args.text
        || (args.attachment
            ? this.previewForAttachment(args.attachment.contentType)
            : '');
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessage: getMessageCipher().encrypt(preview),
          lastMessageAt: args.timestamp,
          // Marcos 2026-07-10: cuando el equipo responde desde el celular
          // (no desde el CRM), la conversación sigue estando "atendida"
          // igual — el cliente recibió su respuesta. Antes sólo el path
          // por CRM (sendManualReply) clareaba needsHumanAttention, y las
          // respuestas por celular dejaban el chat marcado "Pendiente
          // humano" para siempre. Consecuencia: el inbox mostraba arriba
          // conversaciones que Marcos ya había respondido "en la vuelta"
          // como si estuvieran esperando. Ahora una respuesta phone-side
          // también limpia el flag y baja el status a ACTIVE.
          needsHumanAttention: false,
          status: ConversationStatus.ACTIVE,
        },
      });
    } catch (err: any) {
      this.logger.warn(`recordPhoneSideOutbound failed for jid=${args.jid}: ${err?.message ?? err}`);
    }
  }

  /**
   * Marcos 2026-07-06: media inbound del cliente por WhatsApp. Se guarda
   * como mensaje con attachment y NO se llama al agente (foto / audio /
   * documento requiere visión humana). El operador ve la miniatura en
   * el hilo y decide.
   */
  async recordWhatsAppMediaInbound(args: {
    from: string;
    jid: string;
    caption: string;
    waMessageId: string;
    timestamp: Date;
    fallbackLookup?: string | null;
    pushName?: string | null;
    avatarUrl?: string | null;
    attachment: {
      url: string;
      name: string;
      mime: string;
      size: number;
      contentType: ContentType;
    };
  }) {
    try {
      const existing = await this.prisma.message.findFirst({
        where: {
          metadata: { path: ['waMessageId'], equals: args.waMessageId },
        },
        select: { id: true },
      });
      if (existing) return;

      const contact = await this.findOrCreateContact(
        args.from,
        args.jid,
        args.fallbackLookup ?? null,
        args.pushName ?? null,
        args.avatarUrl ?? null,
      );
      const conversation = await this.findOrCreateConversation(contact.id, Channel.WHATSAPP);
      await this.saveMessage(
        conversation.id,
        MessageSender.CUSTOMER,
        args.caption,
        false,
        { source: 'wa-inbound-media', waMessageId: args.waMessageId },
        args.attachment,
      );
      const preview = args.caption || this.previewForAttachment(args.attachment.contentType);
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessage: getMessageCipher().encrypt(preview),
          lastMessageAt: args.timestamp,
          needsHumanAttention: true,
        },
      });
    } catch (err: any) {
      this.logger.warn(`recordWhatsAppMediaInbound failed for jid=${args.jid}: ${err?.message ?? err}`);
    }
  }

  /**
   * Marcos 2026-07-21: helper compartido para el auto-cierre en
   * acknowledgment. Se usa desde handleWhatsAppMessage y
   * handleWebchatMessage. Pipeline en 3 pasos:
   *   1) Detector determinístico (isAcknowledgment) — descarta
   *      preguntas, requests, mensajes largos.
   *   2) Guarda "el turno previo del staff no fue pregunta abierta"
   *      (?, terminación con :) — barata, ataja el 90% de OPENs.
   *   3) Second-opinion con Claude — pasa las últimas ~4 turnos + el
   *      ack. Si Claude dice OPEN o no responde, NO cerramos.
   * Marcos textual: "Lo mejor es que el agente tome contexto o
   * resumen de la conversación para filtrarla como finalizada".
   * Devuelve true si cerró la conversación, false si dejó fluir al
   * pipeline normal (el llamador continua con handoff/AI reply).
   */
  private async maybeAutoCloseOnAck(
    conversationId: string,
    customerText: string,
    recentMessages: Array<{ sender: MessageSender; content: string | null; isFromAI?: boolean }>,
  ): Promise<boolean> {
    if (!isAcknowledgment(customerText)) return false;
    if (recentMessages.length === 0) return false;

    // Marcos 2026-07-22: si el operador pausó la IA en esta conversación
    // (aiPaused=true) NUNCA disparamos el auto-close. El farewell del
    // agente "Bárbaro, cualquier cosa avisame" es UNA respuesta del
    // agente y viola el kill-switch. Marcos: "la IA se está activando
    // sola de forma aleatoria en conversaciones de whatsapp". Esta era
    // una de las fuentes.
    if (await this.isAiPaused(conversationId)) {
      this.logger.log(
        `Ack fast-match but AI is paused on conv ${conversationId.slice(0, 8)} — not closing (operator handles it)`,
      );
      return false;
    }

    // getConversationHistoryById devuelve desc — recentMessages[0] es el
    // más nuevo (el mensaje anterior al que estamos procesando ahora).
    const prev = recentMessages[0];
    if (!prev || prev.sender === MessageSender.CUSTOMER) return false;
    const cipher = getMessageCipher();
    const prevPlain = cipher.decrypt(prev.content ?? '');
    if (looksLikeUnresolvedFromStaff(prevPlain)) return false;

    // Second opinion con Claude — construimos contexto desc→asc.
    const contextTurns = recentMessages
      .slice(0, 6)
      .reverse()
      .map((m) => ({
        role: (m.sender === MessageSender.CUSTOMER
          ? 'customer'
          : m.isFromAI
            ? 'ai'
            : 'staff') as 'customer' | 'ai' | 'staff',
        text: cipher.decrypt(m.content ?? ''),
      }));
    const verdict = await claudeConfirmAckCloses(this.claudeService, customerText, contextTurns);
    if (verdict !== true) {
      // OPEN o null (indeterminado) → NO cerramos. Marcos: "ante duda
      // dejar abierto es mejor que cerrar mal".
      this.logger.log(
        `Ack fast-match but Claude verdict=${verdict === false ? 'OPEN' : 'null'} on conv ${conversationId.slice(0, 8)} — not closing`,
      );
      return false;
    }

    const farewell = 'Bárbaro, cualquier cosa avisame.';
    await this.saveMessage(conversationId, MessageSender.AI, farewell, true);
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        status: ConversationStatus.CLOSED,
        needsHumanAttention: false,
      },
    }).catch((e) => {
      this.logger.warn(`Ack auto-close: could not update conversation ${conversationId}: ${e?.message ?? e}`);
    });
    this.metrics.emitTick('conversation_auto_closed_on_ack');
    this.logger.log(
      `Auto-closed conversation ${conversationId.slice(0, 8)} on customer ack (Claude confirmed) — text="${customerText.slice(0, 60)}"`,
    );
    return true;
  }

  private previewForAttachment(ct: ContentType): string {
    switch (ct) {
      case ContentType.IMAGE:    return '📷 Foto';
      case ContentType.VIDEO:    return '🎥 Video';
      case ContentType.VOICE:    return '🎤 Audio';
      case ContentType.DOCUMENT: return '📎 Documento';
      default:                   return '📎 Adjunto';
    }
  }

  private async saveMessage(
    conversationId: string,
    sender: MessageSender,
    content: string,
    isFromAI: boolean,
    metadata?: Record<string, unknown> | null,
    attachment?: {
      url: string;
      name: string;
      mime: string;
      size: number;
      contentType: ContentType;
    } | null,
  ) {
    // Encrypt before persisting. With no key configured, the cipher
    // passes plaintext through — production turns it on via .env, dev
    // and tests run plaintext for ergonomics. Reads decrypt by sentinel
    // so legacy plaintext rows keep working alongside ciphertext rows.
    const now = new Date();
    await this.prisma.message.create({
      data: {
        conversationId,
        sender,
        content: getMessageCipher().encrypt(content),
        isFromAI,
        metadata: metadata as any,
        contentType: attachment ? attachment.contentType : undefined,
        attachmentUrl: attachment?.url ?? null,
        attachmentName: attachment?.name ?? null,
        attachmentMime: attachment?.mime ?? null,
        attachmentSize: attachment?.size ?? null,
      },
    });
    // Marcos 2026-07-14: mantener Conversation.lastMessageAt sincronizado
    // con el mensaje insertado. Antes: el CUSTOMER inbound en WhatsApp
    // y en TN/webchat NO bumpeaba el campo — nuevas conversaciones
    // quedaban con lastMessageAt=null y aparecían al final del inbox
    // (por el `nulls last`). El fix del 8/7 sólo cubría la actualización
    // post-envío manual (`sendManualReply`) y phone-side outbound; el
    // path central de guardado ahora garantiza que TODO mensaje bumpea
    // el timestamp — regla única para todos los canales.
    //
    // Marcos 2026-07-20: además del timestamp, bumpeamos lastMessage
    // (preview del inbox). Antes 11 de 14 callers no lo escribían y el
    // inbox mostraba la respuesta previa del Admin en la fila mientras
    // el cliente ya había vuelto a escribir (Marcos lo reportó con un
    // "👍" del cliente que no se veía en la fila pero sí al abrir).
    // El preview usa el content del mensaje o, si es adjunto sin caption,
    // el ícono del tipo — misma regla que teníamos en el path de media
    // inbound antes.
    const preview = content && content.trim().length > 0
      ? content
      : attachment
        ? this.previewForAttachment(attachment.contentType)
        : '';
    // Marcos 2026-08-10 (WhatsApp 14:57 AR): la primera versión escribía
    // `hasUnreadCustomer: senderIsCustomer`, o sea la respuesta automática
    // de la IA que llega segundos después del inbound apagaba el flag
    // antes de que Marcos siquiera lo viera → los chats "no entraban"
    // en No leídas. Semántica correcta símil WhatsApp: el flag lo prende
    // SÓLO el cliente al escribir; lo apaga una acción de lectura real:
    // (a) reply manual desde el CRM (sendManualMessage/Attachment),
    // (b) apertura del detalle en el CRM (mark-read endpoint),
    // (c) `chats.update` de Baileys cuando Marcos lee desde el celular.
    // Un auto-reply de IA nunca cuenta como "leído por un humano".
    const senderIsCustomer = sender === MessageSender.CUSTOMER;
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: senderIsCustomer
        ? {
            lastMessageAt: now,
            lastMessage: getMessageCipher().encrypt(preview),
            hasUnreadCustomer: true,
          }
        : {
            lastMessageAt: now,
            lastMessage: getMessageCipher().encrypt(preview),
          },
    }).catch((e) => {
      this.logger.warn(`Could not bump lastMessage/At on ${conversationId}: ${e?.message ?? e}`);
    });
    // Marcos 2026-08-04 (WhatsApp 17:19 AR): "no es módulo nuevo. Ya
    // lo tuvimos armado y no avanzó… recuerdas que estaba a la derecha
    // de la conversación en la fase de pruebas?" — el panel de calidad
    // + la analítica per-operator EXISTE (ConversationScorePanel en el
    // detail, QualityPersonalCard + QualityTeamOverlay en analytics),
    // pero los scores dejaron de generarse el 2026-07-06 porque el
    // trigger sólo disparaba en `isFromAI=true`. En prod las
    // respuestas hoy son casi enteramente manuales (staff desde el
    // CRM o desde el celular), así que el scorer nunca corría.
    //
    // Fix: disparar rescore sobre TODO mensaje del equipo — AI,
    // manual desde el CRM (sender=ADMIN sin isFromAI) y phone-side
    // outbound (metadata.source='phone'). El debounce interno del
    // scorer (QUALITY_SCORING_LIVE_DEBOUNCE_MS default 60s) evita
    // ráfagas de Claude calls cuando el equipo escribe rápido. El
    // scorer atribuye el score al último authorId staff, así la
    // analítica per-operador refleja quién respondió.
    const isStaffMessage =
      isFromAI ||
      sender === MessageSender.ADMIN ||
      sender === MessageSender.BRENDA ||
      sender === MessageSender.FRANCO ||
      sender === MessageSender.ALDO;
    if (isStaffMessage) {
      this.scorer?.scheduleLiveRescore(conversationId);
    }
  }

  /**
   * Bloque E item 5 — Marcos 2026-06-06: history fetch limit. Pulled
   * up from the legacy 10 so the compression service has enough
   * material to collapse into a system block. Env-tunable for Marcos
   * to dial without a deploy.
   */
  private historyFetchLimit(): number {
    const raw = process.env.HISTORY_COMPRESSION_FETCH_LIMIT;
    const n = raw != null ? Number(raw) : 30;
    return Number.isFinite(n) && n > 0 ? n : 30;
  }

  /**
   * Apply history compression to a raw message list and return both
   * the AIConversation the caller should hand to Claude AND the
   * Spanish summary block to push into the turn context. When the
   * compressor short-circuits (channel disabled, no summary yet,
   * below threshold) the full history goes through verbatim.
   */
  private async buildAIContextWithCompression(args: {
    conversationId: string;
    channel: Channel;
    rawHistory: any[];
  }): Promise<{ aiConversation: AIConversation; compressedHistorySummary: string | null }> {
    if (!this.historyCompression) {
      return {
        aiConversation: this.buildAIContext(args.rawHistory),
        compressedHistorySummary: null,
      };
    }
    const r = await this.historyCompression.maybeCompress({
      conversationId: args.conversationId,
      channel: args.channel,
      fullHistory: args.rawHistory,
    });
    return {
      aiConversation: this.buildAIContext(r.recentMessages),
      compressedHistorySummary: r.systemBlock,
    };
  }

  private buildAIContext(recentMessages: any[]): AIConversation {
    // Marcos 2026-08-07 (WhatsApp 09:59 AR): "no sigue el hilo, no
    // retiene lo que el cliente dijo dos mensajes antes". Root cause:
    // este método tag-eaba TODO msg no-AI como `user`. Con
    // WHATSAPP_QR_AUTO_REPLY apagado en la práctica (97.8% de las
    // conversaciones de WA tienen aiPaused=true), la mayoría de los
    // hilos están dominados por respuestas MANUALES del equipo
    // (sender=ADMIN/BRENDA/FRANCO/ALDO, isFromAI=false). Claude
    // recibía esos mensajes con role=user y creía que el cliente
    // decía cada línea del hilo — incluyendo las respuestas del
    // propio equipo. De ahí la incoherencia. Fix: tag por LADO de la
    // conversación (cliente vs equipo/AI), no por origen técnico.
    //   - sender=CUSTOMER               → 'user'
    //   - isFromAI                       → 'assistant'
    //   - sender ∈ {ADMIN,BRENDA,FRANCO,ALDO} → 'assistant' (equipo)
    //
    // Segundo pase: mergeamos consecutivos del mismo rol para
    // preservar la alternancia que Anthropic prefiere (multiple
    // consecutive same-role acepta pero puede degradar la calidad).
    // Mensajes vacíos (media sin caption) se skip — no aportan texto
    // al contexto y sólo diluyen la ventana.
    const cipher = getMessageCipher();
    const STAFF_SENDERS = new Set<MessageSender>([
      MessageSender.ADMIN,
      MessageSender.BRENDA,
      MessageSender.FRANCO,
      MessageSender.ALDO,
    ]);

    const raw: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of recentMessages) {
      const content = cipher.decrypt(msg.content ?? '').trim();
      if (content.length === 0) continue;
      let role: 'user' | 'assistant';
      if (msg.isFromAI) role = 'assistant';
      else if (STAFF_SENDERS.has(msg.sender as MessageSender)) role = 'assistant';
      else role = 'user'; // CUSTOMER (o cualquier sender externo desconocido)
      raw.push({ role, content });
    }

    const merged: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const m of raw) {
      const last = merged[merged.length - 1];
      if (last && last.role === m.role) {
        last.content = `${last.content}\n\n${m.content}`;
      } else {
        merged.push({ role: m.role, content: m.content });
      }
    }

    return new AIConversation(merged.map((m) => new AIMessage(m.role, m.content)));
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
