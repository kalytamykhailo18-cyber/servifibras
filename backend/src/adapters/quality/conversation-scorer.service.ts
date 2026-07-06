/**
 * ADAPTERS LAYER — Quality scoring of closed conversations.
 *
 * Marcos's brainstorm 2026-05-08: when a conversation closes, Claude
 * evaluates the operator's handling and returns a structured score
 * (1–10) plus 3 strengths, 1 improvement with a concrete alternative
 * version of the reply, missed-opportunity flag, and severe-flag
 * (wrong price / impossible promise / bad treatment). The "alternative
 * rewrite" piece is what makes this measurement also act as
 * in-the-moment training.
 *
 * Triggered fire-and-forget from `ConversationManagementService` on
 * status → CLOSED. Re-runnable via the admin rescore endpoint.
 *
 * Failure mode: when Claude is unreachable / over-budget / returns
 * malformed JSON, we persist a row with `score: null` + `rawError`
 * so the panel can distinguish "not yet scored" from "scored 0".
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  Channel,
  ConversationSeverity,
  PrismaClient,
} from '@prisma/client';
import { ClaudeService } from '../ai/claude.service';
import { looksLikeTestContactName } from '../conversations/test-contact-patterns';
import { NotificationsGateway } from '../../infrastructure/notifications/notifications.gateway';
import { getMessageCipher } from '../security/message-cipher';

// Internal-marker messages that the E2E suite + sandbox channel-gate
// fire as plain-text messages (the channel-toggle probe uses
// "MARKER-ON-..." / "MARKER-BACK-..." strings; the prompt-editor probe
// historically leaked "E2E-MARKER-..."). They look like customer
// messages to the scorer but are infrastructure events — the AI is
// gated and intentionally does not reply, so scoring those produces
// false-positive "silencio total" grave alerts (2026-05-28 audit:
// 9 of 65 grave rows were marker-only conversations).
const INTERNAL_MARKER_RE =
  /\b(?:E2E-MARKER|MARKER-(?:ON|OFF|BACK|STILL-OFF))[- ]?[A-Za-z0-9_-]*/i;

// 2026-06-15: E2E probes (PERSIST-PROBE, CHANNEL-SCOPE-PROBE, etc.)
// were being saved as priority-120 few-shot examples and crowding out
// real operator corrections. Anything matching these tokens at either
// turn is rejected from the training pool at write time, and the
// loader filters the same patterns at read time as defense in depth.
const PROBE_CONTENT_RE =
  /\b(?:PERSIST-PROBE|CHANNEL-SCOPE-PROBE|CONFIG-PROBE|SCOPE-PROBE|PROBE\s+auto-mark-reviewed|PROBE\s+\d{10,})\b/i;

export function isProbeContent(text: string | null | undefined): boolean {
  if (!text) return false;
  return PROBE_CONTENT_RE.test(text);
}

interface ScorePayload {
  score: number | null;
  strengths: string[];
  improvement: {
    reason: string;
    originalSnippet: string;
    suggestedRewrite: string;
  } | null;
  missedOpportunity: { detected: boolean; reason: string | null };
  severeFlag: ConversationSeverity;
  severeReason: string | null;
}

const SEVERE_VALUES: Record<string, ConversationSeverity> = {
  NONE: ConversationSeverity.NONE,
  WRONG_PRICE: ConversationSeverity.WRONG_PRICE,
  IMPOSSIBLE_PROMISE: ConversationSeverity.IMPOSSIBLE_PROMISE,
  BAD_TREATMENT: ConversationSeverity.BAD_TREATMENT,
  OTHER: ConversationSeverity.OTHER,
};

@Injectable()
export class ConversationScorerService {
  private readonly logger = new Logger(ConversationScorerService.name);
  private readonly prisma = new PrismaClient();
  // In-memory debounce: maps conversationId → last-scheduled timestamp.
  // Prevents back-to-back operator replies from each spawning a Claude
  // call. Reset on process restart, which is fine — the close-trigger
  // is still authoritative for final scoring.
  private readonly lastLiveScore = new Map<string, number>();

  constructor(
    private readonly claude: ClaudeService,
    private readonly notifications: NotificationsGateway,
  ) {}

  /**
   * Fire-and-forget rescore for live mid-conversation scoring (Marcos's
   * #3 ask: see calidad en vivo en el panel derecho). Same evaluator
   * the close-trigger uses, but debounced so operator typing storms
   * don't burn Claude budget.
   *
   * `force=true` ignores the debounce so an explicit "refrescar
   * puntaje" click always runs.
   */
  scheduleLiveRescore(conversationId: string, force = false): void {
    // Marcos 2026-06-05 cost ask: live-rescore was running after
    // every operator reply (debounced 60s). At ~2,000 inbound msgs/day
    // that's hundreds of evaluator calls/day with little signal —
    // operators don't refresh the panel often enough to notice the
    // delta. Default OFF; the close-trigger still runs on every
    // conversation close, and the nightly cron (off-peak rescore)
    // covers any drift. Set QUALITY_SCORING_LIVE_RESCORE=true to
    // re-enable mid-conversation scoring without redeploy.
    const liveEnabled =
      (process.env.QUALITY_SCORING_LIVE_RESCORE || 'false').toLowerCase() === 'true';
    if (!liveEnabled && !force) {
      this.logger.debug(`Live rescore skipped ${conversationId}: disabled (env)`);
      return;
    }
    const debounceMs = parseInt(
      process.env.QUALITY_SCORING_LIVE_DEBOUNCE_MS || '60000',
      10,
    );
    const now = Date.now();
    const last = this.lastLiveScore.get(conversationId) ?? 0;
    if (!force && now - last < debounceMs) {
      this.logger.debug(
        `Live rescore skipped ${conversationId}: debounced (${Math.round((now - last) / 1000)}s ago)`,
      );
      return;
    }
    this.lastLiveScore.set(conversationId, now);
    void this.evaluateAndPersist(conversationId).catch((err) => {
      this.logger.debug(
        `Live rescore failed for ${conversationId}: ${err?.message || err}`,
      );
    });
  }

  /** Run + persist a score for one conversation. Called both from the
   *  close hook (fire-and-forget) and the admin rescore endpoint. */
  async evaluateAndPersist(conversationId: string): Promise<{
    success: boolean;
    score: number | null;
    severeFlag: ConversationSeverity;
  }> {
    const enabled = (process.env.QUALITY_SCORING_ENABLED ?? 'true') !== 'false';
    if (!enabled) {
      return { success: false, score: null, severeFlag: ConversationSeverity.NONE };
    }

    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        contact: { select: { id: true, name: true, customerType: true, funnelStage: true } },
        assigned: { select: { id: true, name: true, role: true } },
        messages: { orderBy: { timestamp: 'asc' }, take: 200 },
      },
    });
    if (!conv) {
      return { success: false, score: null, severeFlag: ConversationSeverity.NONE };
    }

    // Look for outcome signals (open lead / order won) to give Claude
    // context. A "missed opportunity" is more meaningful when a lead
    // was created and then lost vs. never.
    const [lastLead, lastOrder] = await Promise.all([
      this.prisma.lead.findFirst({
        where: { contactId: conv.contactId },
        orderBy: { updatedAt: 'desc' },
        select: { status: true, productInterest: true, estimatedValue: true },
      }),
      this.prisma.order.findFirst({
        where: { contactId: conv.contactId },
        orderBy: { createdAt: 'desc' },
        select: { status: true, amount: true },
      }),
    ]);

    // Marcos 2026-06-05 cost ask: skip the evaluator on conversations
    // with low signal (very short AND no commercial trace). Cuts
    // ~30-40% of scorer calls without dropping anything actionable —
    // 2-msg threads are usually "¿está disponible?" / "Sí" exchanges,
    // not worth USD 0,01 per evaluation.
    const minMsgs = Number(process.env.QUALITY_SCORING_MIN_MESSAGES) || 5;
    const hasPurchaseSignal =
      lastOrder != null ||
      (lastLead?.estimatedValue != null && Number(lastLead.estimatedValue) > 0) ||
      lastLead?.status === 'QUOTE_SENT' ||
      lastLead?.status === 'WON' ||
      lastLead?.status === 'LOST';
    if (conv.messages.length < minMsgs && !hasPurchaseSignal) {
      this.logger.debug(
        `Scoring skipped ${conversationId}: ${conv.messages.length} msgs < ${minMsgs} and no purchase signal`,
      );
      return { success: false, score: null, severeFlag: ConversationSeverity.NONE };
    }

    // Message bodies are stored encrypted on disk; decrypt before
    // handing the transcript to Claude. Without this, the evaluator
    // sees `enc:v1:...` opaque blobs and returns severeFlag=OTHER for
    // every conversation.
    const cipher = getMessageCipher();
    const decoded = conv.messages.map((m) => ({
      sender: m.sender,
      isFromAI: m.isFromAI,
      timestamp: m.timestamp,
      plain: cipher.decrypt(m.content ?? ''),
    }));

    // Drop internal-marker events from the transcript. Channel-gate
    // probes and E2E test runs inject MARKER-ON/MARKER-BACK strings as
    // customer messages to drive sandbox state; the AI gate sees them
    // and intentionally produces no reply. Scoring those returns
    // "silencio total" / grave-OTHER false positives. Once filtered, if
    // no real customer message remains, skip scoring entirely.
    const realMessages = decoded.filter(
      (m) =>
        !(m.sender === 'CUSTOMER' && INTERNAL_MARKER_RE.test(m.plain)) &&
        !INTERNAL_MARKER_RE.test(m.plain),
    );
    const hasCustomerMessage = realMessages.some((m) => m.sender === 'CUSTOMER');
    if (!hasCustomerMessage) {
      this.logger.debug(
        `Scoring skipped ${conversationId}: only internal-marker traffic, no real customer message`,
      );
      // Persist a sentinel row so the panel can show "not applicable"
      // instead of leaving stale grave alerts visible. Reuse the
      // `rawError` channel to communicate the skip reason.
      await this.prisma.conversationScore.upsert({
        where: { conversationId },
        create: {
          conversationId,
          assignedToId: conv.assignedTo,
          score: null,
          strengths: [] as any,
          improvement: null as any,
          missedOpportunity: { detected: false, reason: null } as any,
          severeFlag: ConversationSeverity.NONE,
          severeReason: null,
          model: null,
          rawError: 'skipped_internal_marker_only',
        },
        update: {
          assignedToId: conv.assignedTo,
          score: null,
          strengths: [] as any,
          improvement: null as any,
          missedOpportunity: { detected: false, reason: null } as any,
          severeFlag: ConversationSeverity.NONE,
          severeReason: null,
          rawError: 'skipped_internal_marker_only',
        },
      });
      return { success: true, score: null, severeFlag: ConversationSeverity.NONE };
    }

    const transcript = realMessages
      .map((m) => {
        const who =
          m.sender === 'CUSTOMER' ? 'CLIENTE' :
          m.isFromAI ? 'AGENTE_IA' :
          conv.assigned?.name ? `OPERADOR ${conv.assigned.name}` : 'OPERADOR';
        const time = m.timestamp.toISOString();
        return `[${time} · ${who}] ${m.plain.slice(0, 1500)}`;
      })
      .join('\n');

    // Catalog snapshot — gives the scorer the list of products
    // Servifibras actually sells. Without it, the scorer false-flagged
    // a real almohadilla calefactora sale (2026-05-27 audit) as
    // "producto fuera de catálogo / IMPOSSIBLE_PROMISE" because the
    // model didn't know the storefront stocks it.
    const catalogSnapshot = await this.buildCatalogSnapshot();
    const channelGuide = buildChannelGuide(conv.channel);

    const userPrompt = buildPrompt({
      contactName: conv.contact?.name ?? 'desconocido',
      customerType: conv.contact?.customerType ?? 'sin clasificar',
      funnelStage: conv.contact?.funnelStage ?? 'sin etapa',
      operatorName: conv.assigned?.name ?? 'sin asignar',
      operatorRole: conv.assigned?.role ?? '—',
      channel: conv.channel,
      channelGuide,
      catalog: catalogSnapshot,
      transcript,
      leadStatus: lastLead?.status ?? null,
      orderStatus: lastOrder?.status ?? null,
    });

    const maxTokens = Number(process.env.QUALITY_SCORING_MAX_TOKENS) || 1024;
    // QUALITY_SCORING_MODEL routes the scorer to a cheaper Haiku-class
    // model when set. Marcos 2026-06-03: scoring was ~3× the cost of
    // customer replies because it shared the Sonnet model — Haiku
    // handles structured JSON evaluation at a fraction of the price.
    const scoringModel = process.env.QUALITY_SCORING_MODEL || undefined;
    const json = await this.claude.askJson({
      callSite: 'quality',
      system: SCORE_SYSTEM_PROMPT,
      user: userPrompt,
      maxTokens,
      model: scoringModel,
      // Inherit the conversation's sandbox flag — plus the test-contact
      // name pattern (E2E webchat tests use real non-sandbox convs but
      // synthetic contact names like "Cmplx cmplx-l1-…"). Without this
      // those scoring calls land in the "real customer" bucket and
      // inflate the dashboard cost for Marcos.
      isTestTraffic:
        conv.isSandbox === true || looksLikeTestContactName(conv.contact?.name),
    });

    let payload: ScorePayload;
    let rawError: string | null = null;
    if (!json) {
      payload = emptyPayload();
      rawError = 'claude_returned_null';
    } else {
      const parsed = parsePayload(json);
      if (parsed.ok === false) {
        payload = emptyPayload();
        rawError = `parse_failed:${parsed.reason}`;
      } else {
        payload = parsed.value;
      }
    }

    // Persist (upsert by conversationId).
    //
    // On Claude-side failures (budget exhausted, transient API error,
    // parse failure) the payload is empty — applying it as the update
    // would WIPE the previous severity / strengths / improvement, which
    // is destructive. Real incident 2026-05-29: monthly budget cap
    // pushed 108 prior-grave conversations to NONE because the rescore
    // pass blanket-overwrote rows. Behaviour now: on failure, only
    // touch `rawError` (so we can see the failure in audit) and leave
    // the prior scoring fields intact. On a successful evaluation we
    // overwrite as before.
    let row;
    if (rawError !== null) {
      row = await this.prisma.conversationScore.upsert({
        where: { conversationId },
        create: {
          conversationId,
          assignedToId: conv.assignedTo,
          score: payload.score,
          strengths: payload.strengths as any,
          improvement: payload.improvement as any,
          missedOpportunity: payload.missedOpportunity as any,
          severeFlag: payload.severeFlag,
          severeReason: payload.severeReason,
          model: scoringModel || process.env.CLAUDE_MODEL || null,
          rawError,
        },
        update: {
          rawError,
        },
      });
    } else {
      row = await this.prisma.conversationScore.upsert({
        where: { conversationId },
        create: {
          conversationId,
          assignedToId: conv.assignedTo,
          score: payload.score,
          strengths: payload.strengths as any,
          improvement: payload.improvement as any,
          missedOpportunity: payload.missedOpportunity as any,
          severeFlag: payload.severeFlag,
          severeReason: payload.severeReason,
          model: scoringModel || process.env.CLAUDE_MODEL || null,
          rawError: null,
        },
        update: {
          assignedToId: conv.assignedTo,
          score: payload.score,
          strengths: payload.strengths as any,
          improvement: payload.improvement as any,
          missedOpportunity: payload.missedOpportunity as any,
          severeFlag: payload.severeFlag,
          severeReason: payload.severeReason,
          model: scoringModel || process.env.CLAUDE_MODEL || null,
          rawError: null,
        },
      });
    }
    this.logger.log(
      `score:${conversationId} → ${row.score ?? 'null'} · severe=${row.severeFlag}` +
        (rawError ? ` · err=${rawError}` : ''),
    );

    // Severity alert — push immediately to ADMIN sessions.
    if (payload.severeFlag !== ConversationSeverity.NONE) {
      try {
        this.notifications.emitToRole('ADMIN', 'quality:severe_flag', {
          scoreId: row.id,
          conversationId,
          assignedToId: conv.assignedTo,
          severeFlag: payload.severeFlag,
          severeReason: payload.severeReason,
          at: new Date().toISOString(),
        });
      } catch (err: any) {
        this.logger.warn(`severe alert emit failed (non-fatal): ${err.message}`);
      }
    }

    // New-score tick. Two emits:
    //  - per-user: operator gets their own conversation's score (silent
    //    when assignedTo is null — that's fine, conversation has no
    //    operator yet).
    //  - broadcast: the live right-rail panel filters by conversationId
    //    so anyone with that conversation open sees the score refresh
    //    in real time without polling.
    try {
      if (conv.assignedTo) {
        this.notifications.emitToUser?.(conv.assignedTo, 'quality:score_ready', {
          scoreId: row.id,
          conversationId,
          score: payload.score,
        });
      }
      this.notifications.broadcast?.('quality:score_ready', {
        scoreId: row.id,
        conversationId,
        score: payload.score,
      });
    } catch { /* ignore */ }

    return {
      success: rawError === null,
      score: payload.score,
      severeFlag: payload.severeFlag,
    };
  }

  /**
   * Promote the scorer's suggested rewrite into a few-shot training
   * example. The flow:
   *
   *   - Look up the persisted score for the conversation
   *   - Resolve the customer message that immediately preceded
   *     originalSnippet (Claude's `originalSnippet` quotes the agent's
   *     reply; we need the customer turn that triggered it to make a
   *     useful (user, assistant) pair)
   *   - Create or update a ConversationExample with title carrying the
   *     scoreId — re-promoting upserts the same row, never duplicates
   *   - Scenario heuristic: derive from severeFlag (wrong_price,
   *     impossible_promise, bad_treatment) or fall back to 'general'
   *
   * Used by POST /admin/quality/:conversationId/apply-correction —
   * Marcos's 2026-05-27 "que pueda corregirse a sí misma a futuro" ask.
   */
  async promoteRewriteAsExample(
    conversationId: string,
    overrideAssistantTurn?: string,
  ): Promise<{
    success: boolean;
    exampleId?: string;
    reason?: string;
    scenario?: string;
  }> {
    // Marcos 2026-06-03 (afternoon): "podríamos incorporar corrección a
    // cualquier respuesta… a veces la IA no encuentra la gravedad o el
    // error en la respuesta". The original flow required a
    // ConversationScore row (with the evaluator's suggestedRewrite) to
    // anchor the promotion. That meant the panel was dark on
    // conversations the scorer didn't flag — exactly the cases Marcos
    // wants to be able to correct manually. We now allow promoting an
    // override even when no score exists: we fall back to the latest
    // CUSTOMER turn from the transcript as the user side of the
    // example, and the admin's override is the assistant side.
    const score = await this.prisma.conversationScore.findUnique({
      where: { conversationId },
      include: {
        conversation: {
          include: {
            messages: { orderBy: { timestamp: 'asc' }, take: 200 },
          },
        },
      },
    });
    const cleanedOverride =
      typeof overrideAssistantTurn === 'string' && overrideAssistantTurn.trim().length > 0
        ? overrideAssistantTurn.trim()
        : null;

    let conversation: { id: string; messages: any[]; channel: any } | null = score?.conversation
      ? { id: score.conversation.id, messages: score.conversation.messages, channel: score.conversation.channel }
      : null;
    if (!conversation) {
      // Score absent → load the conversation directly. Manual corrections
      // need an override turn (otherwise nothing to promote).
      if (!cleanedOverride) {
        return { success: false, reason: 'missing_assistant_turn' };
      }
      const conv = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { messages: { orderBy: { timestamp: 'asc' }, take: 200 } },
      });
      if (!conv) return { success: false, reason: 'conversation_not_found' };
      conversation = { id: conv.id, messages: conv.messages, channel: conv.channel };
    }

    const improvement = (score?.improvement as any) || null;
    const userTurn = await this.findCustomerTurnForRewrite(conversation.messages, improvement);
    const evaluatorRewrite =
      typeof improvement?.suggestedRewrite === 'string' && improvement.suggestedRewrite.trim().length > 0
        ? improvement.suggestedRewrite.trim()
        : null;
    const assistantTurn = cleanedOverride ?? evaluatorRewrite;
    if (!userTurn || !assistantTurn) {
      return { success: false, reason: 'missing_user_or_assistant_turn' };
    }

    const scenario = pickExampleScenario(score?.severeFlag ?? 'NONE' as any);
    // Title key: anchor by scoreId when available so re-promoting from
    // the scored panel upserts the same row; otherwise anchor by the
    // conversationId so manual re-corrects on the same conv also dedupe.
    const title = score
      ? `auto-correction:${score.id}`
      : `manual-correction:${conversationId}`;
    const turns = [
      { role: 'user', content: userTurn },
      { role: 'assistant', content: assistantTurn },
    ];
    // Marcos 2026-06-03: corrections promoted from a specific channel
    // (e.g. an ML conversation with an article URL) must NOT load as
    // few-shot examples on other channels (WhatsApp / Instagram /
    // webchat use different URL conventions). We tag every auto-
    // promoted example with the source channel so the style loader
    // can filter.
    const sourceChannel = conversation.channel;

    const existing = await this.prisma.conversationExample.findFirst({
      where: { title },
      select: { id: true },
    });
    let exampleId: string;
    if (existing) {
      const updated = await this.prisma.conversationExample.update({
        where: { id: existing.id },
        data: {
          scenario,
          turns: turns as any,
          active: true,
          channel: sourceChannel,
          // Auto-corrections outrank manually-seeded gold examples
          // slightly so the fix lands in-prompt fast, but not so
          // hard that a single bad rewrite overwhelms style guidance.
          priority: 120,
        },
      });
      exampleId = updated.id;
    } else {
      const created = await this.prisma.conversationExample.create({
        data: {
          scenario,
          title,
          turns: turns as any,
          active: true,
          channel: sourceChannel,
          priority: 120,
        },
      });
      exampleId = created.id;
    }
    // Persist the override back into the score's improvement.suggestedRewrite
    // so a panel reload shows the edited version (Marcos 2026-06-03: "cuando
    // salgo y vuelvo a entrar, el sistema no guarda la pregunta que edité").
    // Previously the ConversationExample row stored the override but the
    // panel re-seeded its textarea from the score's untouched field. Writing
    // through here makes the edit durable across reloads.
    if (score && cleanedOverride && improvement && cleanedOverride !== evaluatorRewrite) {
      const updatedImprovement = {
        ...improvement,
        suggestedRewrite: cleanedOverride,
      };
      try {
        await this.prisma.conversationScore.update({
          where: { id: score.id },
          data: { improvement: updatedImprovement as any },
        });
      } catch (err: any) {
        // Non-fatal — the ConversationExample row already has the
        // correct turn, the UI re-load is the only thing affected.
        this.logger.warn(
          `Score improvement update after override failed (non-fatal): ${err?.message}`,
        );
      }
    }
    this.logger.log(
      `auto-correction promoted: convId=${conversationId.slice(0, 8)} scenario=${scenario} exampleId=${exampleId.slice(0, 8)}${cleanedOverride ? ' (edited)' : ''}`,
    );
    return { success: true, exampleId, scenario };
  }

  /**
   * Per-turn correction. Marcos 2026-06-06: he needs to correct ANY
   * assistant turn in a long conversation, not just the last one. The
   * existing `promoteRewriteAsExample` keys the few-shot example by
   * conversationId, so successive corrections in the same conversation
   * would overwrite each other. This method keys by the assistant
   * `messageId`, so each per-turn correction lands as its own example
   * row and the agent can pattern-match the fix against the specific
   * customer turn that triggered the broken reply.
   *
   * Pair-pick rule: walk back from the target assistant message and
   * find the most recent CUSTOMER message — that's the user side of
   * the pair. Pairs with no preceding customer turn are rejected.
   *
   * Idempotent: re-applying on the same messageId upserts the row
   * (no duplicates). Returns `messageId` echoed back for UI
   * confirmation.
   */
  async promoteMessageAsExample(
    messageId: string,
    correctedText: string,
  ): Promise<{
    success: boolean;
    exampleId?: string;
    reason?: string;
    scenario?: string;
    messageId: string;
  }> {
    const cleaned = (correctedText ?? '').trim();
    if (cleaned.length === 0) {
      return { success: false, reason: 'empty_corrected_text', messageId };
    }
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        conversationId: true,
        timestamp: true,
        sender: true,
        isFromAI: true,
      },
    });
    if (!message) {
      return { success: false, reason: 'message_not_found', messageId };
    }
    // The target must be an assistant-side turn: either an AI reply or
    // a manual operator reply. A CUSTOMER message isn't something we
    // can "correct" — that's the buyer's words.
    if (message.sender === 'CUSTOMER') {
      return { success: false, reason: 'cannot_correct_customer_turn', messageId };
    }

    // Pull the conversation transcript up to (and including) the
    // target so we can find the customer turn that triggered it.
    const transcript = await this.prisma.message.findMany({
      where: {
        conversationId: message.conversationId,
        timestamp: { lte: message.timestamp },
      },
      orderBy: { timestamp: 'asc' },
      take: 200,
      select: { id: true, sender: true, content: true, timestamp: true },
    });
    const cipher = getMessageCipher();
    let userTurn: string | null = null;
    for (let i = transcript.length - 1; i >= 0; i--) {
      const m = transcript[i];
      if (m.id === messageId) continue;
      if (m.sender === 'CUSTOMER') {
        userTurn = cipher.decrypt(m.content ?? '').trim();
        break;
      }
    }
    if (!userTurn) {
      return { success: false, reason: 'no_preceding_customer_turn', messageId };
    }

    // Resolve channel for the source-channel tag — same rule as the
    // conversation-wide promotion: an ML-channel correction shouldn't
    // pollute the WhatsApp/IG/webchat few-shot pool.
    const conv = await this.prisma.conversation.findUnique({
      where: { id: message.conversationId },
      select: { channel: true, isSandbox: true, score: { select: { severeFlag: true } } },
    });
    // 2026-06-15 Marcos: the few-shot pool was being poisoned by E2E
    // probes (PERSIST-PROBE, CHANNEL-SCOPE-PROBE) that wrote real-
    // priority rows. Two backstops:
    //   1) sandbox-originated corrections never train the agent
    //   2) probe-token content is rejected at write time
    if (conv?.isSandbox) {
      return { success: false, reason: 'source_conversation_is_sandbox', messageId };
    }
    if (isProbeContent(cleaned) || isProbeContent(userTurn)) {
      return { success: false, reason: 'probe_content_blocked', messageId };
    }
    const sourceChannel = conv?.channel ?? null;
    const scenario = pickExampleScenario(conv?.score?.severeFlag ?? 'NONE' as any);

    const title = `manual-message-correction:${messageId}`;
    const turns = [
      { role: 'user', content: userTurn },
      { role: 'assistant', content: cleaned },
    ];

    const existing = await this.prisma.conversationExample.findFirst({
      where: { title },
      select: { id: true },
    });
    let exampleId: string;
    if (existing) {
      const updated = await this.prisma.conversationExample.update({
        where: { id: existing.id },
        data: {
          scenario,
          turns: turns as any,
          active: true,
          channel: sourceChannel,
          priority: 120,
        },
      });
      exampleId = updated.id;
    } else {
      const created = await this.prisma.conversationExample.create({
        data: {
          scenario,
          title,
          turns: turns as any,
          active: true,
          channel: sourceChannel,
          priority: 120,
        },
      });
      exampleId = created.id;
    }

    this.logger.log(
      `per-turn correction promoted: msgId=${messageId.slice(0, 8)} convId=${message.conversationId.slice(0, 8)} scenario=${scenario} exampleId=${exampleId.slice(0, 8)}`,
    );

    // Marcos 2026-07-06: hasta hoy la corrección solo aterrizaba en
    // ConversationExample (few-shot del pipeline general de Claude). En
    // ML el pipeline pasa PRIMERO por tryConstrainedReply que lee de
    // MlPublicationKnowledge.curatedAnswer (min 3 curadas por publicación)
    // — si Marcos corregía una respuesta pero nunca actualizaba la
    // knowledge row de la pregunta, la próxima vez que llegaba una
    // pregunta parecida el modo constrained no leía la corrección y
    // volvía a contestar mal. Ahora, cuando la corrección viene de un
    // mensaje ML con itemId conocido, TAMBIÉN upserteamos la knowledge
    // row para esa (itemId, questionText) marcándola como 'edited' con
    // curatedAnswer=<texto corregido>. Así la corrección impacta tanto
    // en el few-shot como en el modo constrained.
    if (sourceChannel === 'MERCADOLIBRE') {
      try {
        // El texto del cliente (userTurn) es el questionText. Buscamos la
        // knowledge row más reciente que matchee el itemId del mensaje
        // ML y el mismo questionText. Si existe la actualizamos; si no
        // la creamos con lo que ya sabemos.
        const custMsg = await this.prisma.message.findFirst({
          where: {
            conversationId: message.conversationId,
            sender: 'CUSTOMER' as any,
            timestamp: { lt: message.timestamp },
          },
          orderBy: { timestamp: 'desc' },
          select: { metadata: true },
        });
        const meta = (custMsg?.metadata ?? {}) as Record<string, any>;
        const itemId = typeof meta.mlItemId === 'string' ? meta.mlItemId : null;
        if (itemId) {
          const existing = await this.prisma.mlPublicationKnowledge.findFirst({
            where: { itemId, questionText: userTurn },
            select: { id: true },
          });
          const now = new Date();
          if (existing) {
            await this.prisma.mlPublicationKnowledge.update({
              where: { id: existing.id },
              data: {
                curationStatus: 'edited',
                curatedAnswer: cleaned,
                curatedAt: now,
              },
            });
            this.logger.log(
              `ML curatedAnswer updated for ${itemId} (existing row ${existing.id.slice(0, 8)})`,
            );
          } else {
            // Synthetic row: la pregunta y el itemId son reales (los
            // sacamos del mensaje). accountKey y mlQuestionId son
            // sintéticos porque no vinieron del ingest ML normal —
            // usamos un prefijo 'correction-' para que quede claro en
            // audit que este row fue sembrado por la corrección, no
            // por el sync.
            await this.prisma.mlPublicationKnowledge.create({
              data: {
                itemId,
                accountKey: 'mercadolibre',
                mlQuestionId: `correction-${messageId}`,
                questionText: userTurn,
                answerText: cleaned,
                curationStatus: 'edited',
                curatedAnswer: cleaned,
                curatedAt: now,
                questionAt: now,
                answeredAt: now,
              },
            });
            this.logger.log(`ML curatedAnswer seeded for ${itemId} (new knowledge row)`);
          }
        }
      } catch (err: any) {
        this.logger.warn(
          `Failed to propagate correction to MlPublicationKnowledge: ${err?.message ?? err}`,
        );
      }
    }

    return { success: true, exampleId, scenario, messageId };
  }

  /**
   * Find the customer message that triggered the response Claude
   * critiqued. Walks the transcript looking for the AI/operator message
   * whose decrypted content contains the originalSnippet; the
   * preceding CUSTOMER message becomes the user turn. Falls back to
   * the last CUSTOMER message if no exact match is found.
   */
  private async findCustomerTurnForRewrite(
    messages: Array<{ sender: string; isFromAI: boolean; content: string | null; timestamp: Date }>,
    improvement: { originalSnippet?: string } | null,
  ): Promise<string | null> {
    const cipher = getMessageCipher();
    const decoded = messages.map((m) => ({
      sender: m.sender,
      isFromAI: m.isFromAI,
      plain: cipher.decrypt(m.content ?? ''),
    }));

    const snippet = improvement?.originalSnippet?.trim() ?? '';
    if (snippet.length > 0) {
      for (let i = 0; i < decoded.length; i++) {
        const m = decoded[i];
        if (m.sender === 'CUSTOMER') continue;
        if (m.plain.includes(snippet) || snippet.includes(m.plain.slice(0, 60))) {
          for (let j = i - 1; j >= 0; j--) {
            if (decoded[j].sender === 'CUSTOMER') return decoded[j].plain.trim();
          }
        }
      }
    }
    // Fallback: last customer message overall
    for (let i = decoded.length - 1; i >= 0; i--) {
      if (decoded[i].sender === 'CUSTOMER') return decoded[i].plain.trim();
    }
    return null;
  }

  /**
   * Compact list of active products for the scorer. Keeps it under the
   * QUALITY_SCORING_CATALOG_CAP entries (env-tunable) so the scoring
   * prompt stays bounded.
   *
   * 2026-05-29: prices were not included in the snapshot, so every
   * agent reply that quoted a price (which comes from the live
   * buscar_producto tool — i.e. always accurate) was flagged as
   * WRONG_PRICE by the scorer with "no puede contrastarse con el
   * catálogo provisto". Real audit: 25 of 67 grave alerts were that
   * exact false positive. Including basePriceArs / basePriceUsd in
   * the snapshot lets the scorer cross-check a quoted price against
   * the catalog and only flag a real mismatch.
   */
  private async buildCatalogSnapshot(): Promise<string> {
    const cap = Number(process.env.QUALITY_SCORING_CATALOG_CAP) || 400;
    const rows = await this.prisma.product.findMany({
      where: { active: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: {
        sku: true,
        name: true,
        category: true,
        baseUnit: true,
        basePriceArs: true,
        basePriceUsd: true,
      },
      take: cap,
    });
    if (rows.length === 0) return '(catálogo vacío)';
    return rows.map((r) => {
      const priceParts: string[] = [];
      if (r.basePriceArs != null) priceParts.push(`ARS ${r.basePriceArs}`);
      if (r.basePriceUsd != null) priceParts.push(`USD ${r.basePriceUsd}`);
      const price = priceParts.length > 0 ? priceParts.join(' / ') : 'sin precio';
      const unit = r.baseUnit && r.baseUnit !== 'unidad' ? ` por ${r.baseUnit}` : '';
      return `- ${r.sku} · ${r.name} (${r.category}) — ${price}${unit}`;
    }).join('\n');
  }

  /**
   * Mark a flagged conversation as reviewed — once the admin has
   * confirmed the agent reply was fine (or applied a correction), the
   * row should stop appearing in the Marcadas filter of the ML Q&A
   * panel. Idempotent — re-calling refreshes the timestamp/user.
   * Marcos 2026-06-04: button on the ML panel calls this so the
   * Marcadas queue acts as a work-list that empties as he goes.
   */
  async markReviewed(
    conversationId: string,
    userId: string | null,
  ): Promise<{ success: boolean; reason?: string; reviewedAt?: string }> {
    try {
      const updated = await this.prisma.conversationScore.update({
        where: { conversationId },
        data: { reviewedAt: new Date(), reviewedById: userId ?? null },
        select: { reviewedAt: true },
      });
      this.logger.log(
        `score marked reviewed: convId=${conversationId.slice(0, 8)} by=${userId?.slice(0, 8) ?? 'system'}`,
      );
      return {
        success: true,
        reviewedAt: updated.reviewedAt?.toISOString(),
      };
    } catch (err: any) {
      if (err?.code === 'P2025') {
        // No score row — nothing to mark. Treat as success so the UI
        // doesn't blow up on un-scored conversations (the panel only
        // exposes the button on scored rows anyway).
        return { success: false, reason: 'no_score_row' };
      }
      this.logger.warn(`markReviewed failed: ${err?.message ?? err}`);
      return { success: false, reason: 'db_error' };
    }
  }

  /**
   * Undo a previous mark-reviewed. Used by the panel when an operator
   * wants to put the row back in the Marcadas queue.
   */
  async unmarkReviewed(
    conversationId: string,
  ): Promise<{ success: boolean; reason?: string }> {
    try {
      await this.prisma.conversationScore.update({
        where: { conversationId },
        data: { reviewedAt: null, reviewedById: null },
      });
      this.logger.log(`score reviewed-flag cleared: convId=${conversationId.slice(0, 8)}`);
      return { success: true };
    } catch (err: any) {
      if (err?.code === 'P2025') return { success: false, reason: 'no_score_row' };
      this.logger.warn(`unmarkReviewed failed: ${err?.message ?? err}`);
      return { success: false, reason: 'db_error' };
    }
  }
}

// ---------------- helpers ----------------

const SCORE_SYSTEM_PROMPT = `Sos un evaluador de calidad de atención al cliente para Servifibras (distribuidora argentina de resinas, fibras y materiales compuestos). Recibís el transcript completo de una conversación cerrada y devolvés UN ÚNICO objeto JSON con esta estructura exacta, sin texto adicional:

{
  "score": <número entero del 1 al 10, donde 10 = atención perfecta>,
  "strengths": ["fortaleza 1", "fortaleza 2", "fortaleza 3"],
  "improvement": {
    "reason": "razón principal por la que la conversación no llegó a 10",
    "originalSnippet": "fragmento concreto del operador o IA que ilustra el problema, copiado tal cual del transcript",
    "suggestedRewrite": "cómo hubiera quedado mejor escrita esa misma respuesta — una sola alternativa concreta, en español, lista para copiar y pegar"
  },
  "missedOpportunity": {
    "detected": <true|false — true si hubo una señal clara de compra que no se aprovechó>,
    "reason": "<descripción si detected=true, null si no>"
  },
  "severeFlag": "<NONE|WRONG_PRICE|IMPOSSIBLE_PROMISE|BAD_TREATMENT|OTHER>",
  "severeReason": "<descripción del problema grave si severeFlag != NONE, null si no>"
}

Reglas:
- Si la conversación es muy corta (< 3 mensajes intercambiados) o no hay respuesta del operador/IA, devolvé score null y completá los demás campos describiendo eso en improvement.reason.
- Las 3 fortalezas siempre son exactamente 3, descriptivas, en español, no genéricas.
- improvement.suggestedRewrite es la herramienta de entrenamiento más importante: tiene que ser una alternativa concreta y aplicable, no un consejo abstracto.
- severeFlag SOLO se activa con: precio incorrecto vs. catálogo (WRONG_PRICE), promesa de algo que el sistema no puede cumplir (IMPOSSIBLE_PROMISE), trato irrespetuoso o falta grave (BAD_TREATMENT), o cualquier otro problema grave (OTHER).
- ANTES de marcar IMPOSSIBLE_PROMISE o "producto fuera de catálogo", verificá el listado de catálogo que se entrega con la conversación. Si el producto figura en el catálogo activo, NO es promesa imposible.
- ANTES de marcar una respuesta como "irrelevante" o "no respondió la pregunta", verificá las reglas de canal que se entregan en el prompt. La respuesta canónica del canal NO es irrelevante aunque a primera vista parezca desviar el tema.
- missedOpportunity.detected = true cuando el cliente expresó intención de compra (cantidad, urgencia, comparación de precios) y la respuesta no avanzó hacia el cierre.
- Devolvé SOLO el JSON, sin markdown ni explicación.`;

function buildPrompt(input: {
  contactName: string;
  customerType: string;
  funnelStage: string;
  operatorName: string;
  operatorRole: string;
  channel: Channel;
  channelGuide: string;
  catalog: string;
  transcript: string;
  leadStatus: string | null;
  orderStatus: string | null;
}): string {
  return `Conversación a evaluar:

Canal: ${input.channel}
Cliente: ${input.contactName} (tipo: ${input.customerType}, etapa: ${input.funnelStage})
Operador asignado: ${input.operatorName} (${input.operatorRole})
Resultado actual: lead=${input.leadStatus ?? 'sin lead'} · orden=${input.orderStatus ?? 'sin orden'}

Reglas del canal (NO marcar como error nada que cumpla estas reglas):
${input.channelGuide}

Catálogo activo de Servifibras (productos reales que SÍ vendemos, con SKU + nombre + categoría + precio actual de catálogo). NO marcar IMPOSSIBLE_PROMISE / fuera-de-catálogo por nombres que aparezcan acá. Para WRONG_PRICE: solo marcalo cuando el precio que dijo el agente difiere significativamente del precio del catálogo de ESTE mismo producto; si el precio mencionado coincide con el del catálogo (o no figura precio en el catálogo para ese SKU), NO es WRONG_PRICE:
${input.catalog}

Transcript:
${input.transcript}`;
}

/**
 * Channel-specific rules the scorer must respect. Without this, the
 * scorer flagged the canonical ML retiro deflection ("El retiro se
 * coordina por la mensajería privada de MercadoLibre...") as
 * "irrelevante / no respondió la pregunta" — when in reality that
 * exact line is the TOS-compliant required answer (sharing the store
 * address pre-purchase is a ban-grade leak).
 *
 * 2026-05-29: Marcos clarified that only the EXACT address (calle +
 * número) is the TOS leak; zone-level disclosure is sales-positive and
 * allowed. Updated ML guide so the scorer stops flagging "Caseros,
 * partido de Tres de Febrero" etc. as a violation.
 */
function buildChannelGuide(channel: Channel): string {
  if (channel === Channel.MERCADOLIBRE) {
    return [
      '- ML prohíbe compartir solamente la DIRECCIÓN EXACTA del local (nombre de calle + número) y datos de contacto fuera de la plataforma (teléfono, email, WhatsApp, URLs externas) en la Q&A previa a la compra. El domicilio exacto se reserva para la mensajería privada post-compra.',
      '- La ZONA / LOCALIDAD / PARTIDO / BARRIO / referencias geográficas generales (ej. "estamos en Caseros", "zona de Caseros", "partido de Tres de Febrero", "zona oeste del GBA", "a 15 cuadras del acceso oeste") están PERMITIDAS y son sales-positivas — ayudan al comprador a evaluar el retiro. NO marques esa información como violación de TOS ni como BAD_TREATMENT.',
      '- La línea canónica "El retiro se coordina por la mensajería privada de MercadoLibre una vez confirmada la compra" ES correcta como complemento a la zona. NO la marques como respuesta irrelevante.',
      '- ML opera en modo Q&A one-shot: cada respuesta debe ser autocontenida y NO debe cerrar con preguntas tipo "¿en qué te puedo ayudar?" o "¿necesitás algo más?". La ausencia de cierre conversacional NO es un defecto.',
      '- En ML no se permiten enlaces externos. "lo encontrás en este perfil de MercadoLibre" reemplaza al link externo y es correcto.',
      '- Cross-publicación: en ML cada Q&A está atada a una publicación específica (un producto). Si el cliente pregunta por OTRO producto distinto al de la publicación, la respuesta canónica correcta es "Para ese producto te conviene la publicación específica. Buscala en nuestro perfil de tienda en MercadoLibre" + opcionalmente una línea volviendo al producto de la publicación actual ("Si tenés alguna duda sobre [producto de la publicación], te ayudo acá"). Esta respuesta NO es confusión de contexto ni producto irrelevante — es la regla TOS de ML. NO la marques como grave.',
    ].join('\n');
  }
  if (channel === Channel.TIENDANUBE_WEBCHAT) {
    return [
      '- En webchat los enlaces a tiendaservifibras.com SÍ están permitidos y son la forma correcta de derivar a la ficha del producto.',
      '- El cierre conversacional ("¿en qué más te puedo ayudar?") SÍ es deseable en webchat.',
    ].join('\n');
  }
  return '- Sin restricciones específicas del canal.';
}

function pickExampleScenario(severeFlag: ConversationSeverity): string {
  switch (severeFlag) {
    case ConversationSeverity.WRONG_PRICE:        return 'pricing';
    case ConversationSeverity.IMPOSSIBLE_PROMISE: return 'limits';
    case ConversationSeverity.BAD_TREATMENT:      return 'tone';
    default:                                       return 'general';
  }
}

function emptyPayload(): ScorePayload {
  return {
    score: null,
    strengths: [],
    improvement: null,
    missedOpportunity: { detected: false, reason: null },
    severeFlag: ConversationSeverity.NONE,
    severeReason: null,
  };
}

function parsePayload(j: any): { ok: true; value: ScorePayload } | { ok: false; reason: string } {
  if (!j || typeof j !== 'object') return { ok: false, reason: 'not_object' };
  const score = j.score === null ? null : Number(j.score);
  if (score !== null && (!Number.isFinite(score) || score < 0 || score > 10)) {
    return { ok: false, reason: 'score_out_of_range' };
  }
  const strengths = Array.isArray(j.strengths)
    ? j.strengths.filter((s: any) => typeof s === 'string').slice(0, 3)
    : [];
  const improvement = j.improvement && typeof j.improvement === 'object'
    ? {
        reason: String(j.improvement.reason ?? ''),
        originalSnippet: String(j.improvement.originalSnippet ?? ''),
        suggestedRewrite: String(j.improvement.suggestedRewrite ?? ''),
      }
    : null;
  const moRaw = j.missedOpportunity ?? {};
  const missedOpportunity = {
    detected: !!moRaw.detected,
    reason: moRaw.reason ? String(moRaw.reason) : null,
  };
  const severeFlagRaw = String(j.severeFlag ?? 'NONE').toUpperCase();
  const severeFlag = SEVERE_VALUES[severeFlagRaw] ?? ConversationSeverity.NONE;
  const severeReason = j.severeReason ? String(j.severeReason) : null;
  return {
    ok: true,
    value: { score: score ?? null, strengths, improvement, missedOpportunity, severeFlag, severeReason },
  };
}
