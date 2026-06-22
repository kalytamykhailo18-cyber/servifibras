/**
 * ADAPTERS LAYER — MercadoLibre Q&A list service.
 *
 * Marcos 2026-06-03 PM ask: "panel limpio, solo preguntas de
 * mercadolibre, historial en orden por fecha de respuesta. Que tengas
 * la miniatura del producto, la pregunta, la respuesta del agente y el
 * tiempo de respuesta — y al lado el botón para corregir." Mirrors the
 * dedicated ML monitoring view he uses in his other CRM.
 *
 * Each row is one Q&A pair: the customer's question + the agent reply
 * that followed. We pair them by walking each ML conversation in
 * timestamp order — every CUSTOMER message is followed by the next
 * non-CUSTOMER message (typically AI, sometimes ADMIN if the operator
 * stepped in).
 *
 * Publication context: the inbound handler stamps `mlItemId` on the
 * CUSTOMER message metadata (new from 2026-06-03). For historical
 * messages without the stamp we fall back to "publicación desconocida"
 * — those rows still let Marcos open the conversation and correct it.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Channel, MessageSender, PrismaClient } from '@prisma/client';
import { getMessageCipher } from '../security/message-cipher';
import type { MercadoLibreService } from '../mercadolibre/mercadolibre.service';
import { MERCADOLIBRE_SERVICE } from '../../use-cases/mercadolibre/mercadolibre.token';

export interface MlQaRow {
  conversationId: string;
  buyer: { name: string | null; mlUserId: string | null };
  question: { id: string; text: string; at: string };
  reply: { id: string; text: string; at: string; bySender: 'AI' | 'ADMIN' | 'OTHER' } | null;
  responseTimeMs: number | null;
  publication: {
    itemId: string | null;
    title: string | null;
    permalink: string | null;
    thumbnail: string | null;
  };
  /** Quality scoring summary so Marcos can see at-a-glance which rows
   *  the evaluator already flagged. */
  quality: {
    score: number | null;
    severeFlag: string;
    severeReason: string | null;
    /** When set, the admin already triaged this row — either by
     *  applying a correction or by marking it OK. Used to drop the
     *  row from the Marcadas filter so the queue empties as Marcos
     *  works through it. */
    reviewedAt: string | null;
  };
}

@Injectable()
export class MercadolibreQaService {
  private readonly logger = new Logger(MercadolibreQaService.name);
  private readonly prisma = new PrismaClient();

  constructor(
    // Optional — only the runtime where MercadolibreModule is loaded
    // wires it; standalone scripts that exercise this service may not
    // have OAuth credentials. When absent, missing-publication rows
    // just fall back to the "sin contexto" placeholder as before.
    @Optional()
    @Inject(MERCADOLIBRE_SERVICE)
    private readonly mercadolibre?: MercadoLibreService,
  ) {}

  /**
   * List the most-recent N ML Q&A pairs (defaults to 50). Optional:
   *   - `since`         — filter to questions answered after an ISO timestamp.
   *   - `flaggedOnly`   — only rows the quality scorer flagged as severe.
   *   - `maxScore`      — only rows with quality.score ≤ this value.
   *   - `search`        — case-insensitive substring match on the question OR reply text.
   *
   * Marcos 2026-06-04: filter chips on the panel let him jump straight
   * to the low-quality / flagged replies he wants to review and
   * correct, instead of scrolling through everything chronologically.
   */
  async listQaPairs(opts?: {
    limit?: number;
    since?: Date | null;
    flaggedOnly?: boolean;
    maxScore?: number | null;
    search?: string | null;
  }): Promise<MlQaRow[]> {
    const limit = Math.max(1, Math.min(200, opts?.limit ?? 50));
    const cipher = getMessageCipher();
    const flaggedOnly = opts?.flaggedOnly === true;
    const maxScore =
      typeof opts?.maxScore === 'number' && Number.isFinite(opts.maxScore)
        ? opts.maxScore
        : null;
    const searchTerm = (opts?.search ?? '').trim().toLowerCase();

    // Pre-filter at the DB layer when possible: flagged-only +
    // maxScore are cheap conditions on ConversationScore. `search`
    // runs post-decrypt because messages are encrypted at rest.
    // Marcos 2026-06-04: the Marcadas filter (flaggedOnly) ALSO
    // hides rows the admin has already triaged via mark-reviewed —
    // the queue empties as he works through it.
    const scoreWhere: any = {};
    if (flaggedOnly) {
      scoreWhere.severeFlag = { not: 'NONE' };
      scoreWhere.reviewedAt = null;
    }
    if (maxScore !== null) scoreWhere.score = { lte: maxScore };
    const convWhere: any = { channel: Channel.MERCADOLIBRE, isSandbox: false };
    if (Object.keys(scoreWhere).length > 0) {
      convWhere.score = scoreWhere;
    }

    // Walk recent ML conversations, picking up to 5 most recent
    // messages each. 5 is enough to find the most recent Q + paired A;
    // most ML threads are one-shot so this is overkill but safe.
    // Search bumps the overfetch since post-decrypt filtering may
    // drop most candidates.
    const overfetch = searchTerm ? Math.min(500, limit * 8) : limit * 2;
    const convs = await this.prisma.conversation.findMany({
      where: convWhere,
      orderBy: { lastMessageAt: 'desc' },
      take: overfetch,
      include: {
        contact: {
          select: { name: true, metadata: true },
        },
        score: {
          select: { score: true, severeFlag: true, severeReason: true, reviewedAt: true },
        },
        messages: {
          orderBy: { timestamp: 'desc' },
          take: 8,
          select: {
            id: true,
            sender: true,
            isFromAI: true,
            content: true,
            metadata: true,
            timestamp: true,
          },
        },
      },
    });

    // Resolve publication thumbnails via the Product.mlPermalink map.
    // We collect itemIds first, then bulk-query so the per-row render
    // is cheap.
    const itemIds = new Set<string>();
    for (const c of convs) {
      for (const m of c.messages) {
        const meta = (m.metadata as any) || {};
        if (meta?.mlItemId) itemIds.add(String(meta.mlItemId));
      }
    }
    // Product.mlPermalink stores the FULL URL with slug, so an exact
    // `in:` match would miss every row. Load the Product rows that
    // have ANY mlPermalink set once, key them by the extracted MLA id
    // (the digits after "MLA-"), and look up per row.
    const products =
      itemIds.size > 0
        ? await this.prisma.product.findMany({
            where: { mlPermalink: { not: null } },
            select: { name: true, url: true, mlPermalink: true, attributes: true },
          })
        : [];
    const productByItemId = new Map<string, typeof products[number]>();
    for (const p of products) {
      const id = extractMlaId(p.mlPermalink);
      if (id) productByItemId.set(id, p);
    }

    // For item IDs not in the local Product table (e.g. ML-only
    // listings that never lived in TiendaNube), fall through to the
    // MercadoLibre items endpoint to fetch title + thumbnail + permalink
    // directly. Marcos 2026-06-06: the panel was rendering "Publicación
    // sin contexto" + the bare MLA id for those rows because the
    // product map didn't have them. We bulk-resolve here in parallel;
    // MercadoLibreService caches each lookup for 5 min so subsequent
    // panel loads don't re-hit the ML API for the same listing.
    const mlListingByItemId = new Map<string, {
      title: string | null;
      permalink: string | null;
      thumbnail: string | null;
    }>();
    if (this.mercadolibre) {
      const missingItemIds: string[] = [];
      for (const itemId of itemIds) {
        const numericId = itemId.replace(/^MLA/i, '').trim();
        if (!productByItemId.has(numericId)) missingItemIds.push(itemId);
      }
      if (missingItemIds.length > 0) {
        await Promise.all(
          missingItemIds.map(async (itemId) => {
            try {
              const listing = await this.mercadolibre!.fetchListingDetails(itemId);
              if (listing) {
                mlListingByItemId.set(itemId, {
                  title: listing.title || null,
                  permalink: listing.permalink,
                  thumbnail: listing.thumbnailUrl,
                });
              }
            } catch {
              /* non-fatal — row falls back to placeholder */
            }
          }),
        );
      }
    }

    const rows: MlQaRow[] = [];
    for (const c of convs) {
      // Messages came back desc; reverse to walk in chronological order.
      const ordered = [...c.messages].reverse();
      // Find pairs: each CUSTOMER message followed by the next non-CUSTOMER message.
      for (let i = 0; i < ordered.length; i++) {
        const m = ordered[i];
        if (m.sender !== MessageSender.CUSTOMER) continue;
        const next = ordered.slice(i + 1).find((x) => x.sender !== MessageSender.CUSTOMER) ?? null;
        const meta = (m.metadata as any) || {};
        const itemId = meta?.mlItemId ? String(meta.mlItemId) : null;
        const itemIdNum = itemId ? itemId.replace(/^MLA/i, '').trim() : null;
        const product = itemIdNum ? productByItemId.get(itemIdNum) : undefined;
        const productAttrs = (product?.attributes as any[]) || [];
        const thumbAttr = productAttrs.find?.((a) => a?.id === 'THUMBNAIL' || a?.name === 'Imagen');
        rows.push({
          conversationId: c.id,
          buyer: {
            name: c.contact?.name ?? null,
            mlUserId: (c.contact?.metadata as any)?.mercadolibreUserId ?? null,
          },
          question: {
            id: m.id,
            text: cipher.decrypt(m.content ?? ''),
            at: m.timestamp.toISOString(),
          },
          reply: next
            ? {
                id: next.id,
                text: cipher.decrypt(next.content ?? ''),
                at: next.timestamp.toISOString(),
                bySender: next.isFromAI ? 'AI' : next.sender === MessageSender.ADMIN ? 'ADMIN' : 'OTHER',
              }
            : null,
          responseTimeMs: next ? next.timestamp.getTime() - m.timestamp.getTime() : null,
          publication: this.buildPublication({
            itemId,
            itemIdNum,
            product,
            thumbAttr,
            mlFallback: itemId ? mlListingByItemId.get(itemId) ?? null : null,
          }),
          quality: {
            score: c.score?.score ?? null,
            severeFlag: c.score?.severeFlag ?? 'NONE',
            severeReason: c.score?.severeReason ?? null,
            reviewedAt: c.score?.reviewedAt?.toISOString() ?? null,
          },
        });
        // One question per conversation is enough for the panel — the
        // operator can drill into the conversation detail for the full
        // back-and-forth. Older Q&A pairs are also visible there.
        break;
      }
      // Early break only when NOT searching — search post-filters the
      // assembled rows, so we need to keep collecting from the larger
      // candidate set until we've walked them all.
      if (!searchTerm && rows.length >= limit) break;
    }

    // Post-decrypt search filter — runs against question + reply text.
    let filtered = rows;
    if (searchTerm) {
      filtered = rows.filter((r) => {
        const q = (r.question?.text ?? '').toLowerCase();
        const a = (r.reply?.text ?? '').toLowerCase();
        const buyer = (r.buyer?.name ?? '').toLowerCase();
        const pub = (r.publication?.title ?? '').toLowerCase();
        return (
          q.includes(searchTerm) ||
          a.includes(searchTerm) ||
          buyer.includes(searchTerm) ||
          pub.includes(searchTerm)
        );
      });
    }

    // Sort by reply-at desc (Marcos: "historial en orden por fecha de
    // respuesta"). Fall back to question-at when reply is null.
    filtered.sort((a, b) => {
      const aTs = a.reply ? Date.parse(a.reply.at) : Date.parse(a.question.at);
      const bTs = b.reply ? Date.parse(b.reply.at) : Date.parse(b.question.at);
      return bTs - aTs;
    });

    if (opts?.since) {
      const sinceMs = opts.since.getTime();
      filtered = filtered.filter((r) => {
        const ts = r.reply ? Date.parse(r.reply.at) : Date.parse(r.question.at);
        return ts >= sinceMs;
      });
    }

    return filtered.slice(0, limit);
  }

  /**
   * Compose the publication card for a Q&A row. Order of precedence:
   *   1) local Product row (synced from TiendaNube — has name + slug url
   *      and per-product attributes like THUMBNAIL),
   *   2) MercadoLibre items API (covers ML-only listings that never
   *      lived in TiendaNube — the gap Marcos spotted 2026-06-06),
   *   3) synthetic permalink built from the MLA id as a last resort so
   *      "Ver publicación" still goes somewhere clickable.
   * Extracted into a method so TS can infer each chained `??` operand
   * cleanly without the "always nullish" warning the inline form
   * triggered with optional-chain + nullish-coalescing nesting.
   */
  private buildPublication(args: {
    itemId: string | null;
    itemIdNum: string | null;
    product?: { name: string | null; mlPermalink: string | null } | null;
    thumbAttr?: { value?: string } | undefined;
    mlFallback: { title: string | null; permalink: string | null; thumbnail: string | null } | null;
  }): { itemId: string | null; title: string | null; permalink: string | null; thumbnail: string | null } {
    const { itemId, itemIdNum, product, thumbAttr, mlFallback } = args;

    const productName = product?.name ?? null;
    const productPermalink = product?.mlPermalink ?? null;
    const productThumb = (thumbAttr && typeof thumbAttr.value === 'string') ? thumbAttr.value : null;
    const synthPermalink = itemIdNum
      ? `https://articulo.mercadolibre.com.ar/MLA-${itemIdNum}`
      : null;

    return {
      itemId,
      title: productName ?? mlFallback?.title ?? null,
      permalink: productPermalink ?? mlFallback?.permalink ?? synthPermalink,
      thumbnail: productThumb ?? mlFallback?.thumbnail ?? null,
    };
  }

  /**
   * Lightweight counts per filter chip so the ML panel can show
   * "Marcadas (32)" on the chips and Marcos sees the queue shrink as
   * he marks rows OK. Each count is a single COUNT query against the
   * Conversation + ConversationScore relation — cheap.
   */
  async qaFilterCounts(): Promise<{
    all: number;
    flagged: number;
    scoreLe7: number;
    scoreLe5: number;
  }> {
    const baseWhere = { channel: Channel.MERCADOLIBRE, isSandbox: false } as const;
    const [all, flagged, scoreLe7, scoreLe5] = await Promise.all([
      this.prisma.conversation.count({ where: baseWhere }),
      this.prisma.conversation.count({
        where: {
          ...baseWhere,
          score: { severeFlag: { not: 'NONE' }, reviewedAt: null },
        },
      }),
      this.prisma.conversation.count({
        where: { ...baseWhere, score: { score: { lte: 7 } } },
      }),
      this.prisma.conversation.count({
        where: { ...baseWhere, score: { score: { lte: 5 } } },
      }),
    ]);
    return { all, flagged, scoreLe7, scoreLe5 };
  }

  /**
   * Marcos 2026-06-11: mark the latest AI message in the conversation
   * belonging to this ML buyer as a draft pending review. Stamped
   * with the question id + account key so the QA panel can release
   * it back to ML once the operator approves / edits it. The AI
   * message itself was already persisted by `handleMercadoLibreMessage`
   * a few millis earlier — we just patch metadata onto the most
   * recent isFromAI row.
   */
  async markLatestDraftPending(
    questionId: string,
    mlBuyerId: string,
    mlAccountKeyOnMessage: string | null,
    mlAccountKeyResolved: string | null,
  ): Promise<void> {
    // Resolve the contact via the ML buyer id stored in
    // contact.metadata.mercadolibreUserId (the convention used by
    // `findOrCreateMercadoLibreContact`).
    const contact = await this.prisma.contact.findFirst({
      where: {
        metadata: { path: ['mercadolibreUserId'], equals: mlBuyerId } as any,
      },
      select: { id: true },
    });
    if (!contact) return;
    const conversation = await this.prisma.conversation.findFirst({
      where: { contactId: contact.id, channel: Channel.MERCADOLIBRE },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (!conversation) return;
    const message = await this.prisma.message.findFirst({
      where: { conversationId: conversation.id, isFromAI: true },
      orderBy: { timestamp: 'desc' },
      select: { id: true, metadata: true },
    });
    if (!message) return;
    const prev = (message.metadata as Record<string, unknown> | null) ?? {};
    await this.prisma.message.update({
      where: { id: message.id },
      data: {
        metadata: {
          ...prev,
          pendingReview: true,
          mlQuestionId: questionId,
          mlAccountKey: mlAccountKeyOnMessage ?? mlAccountKeyResolved ?? null,
          markedPendingAt: new Date().toISOString(),
        },
      },
    });
  }

  /**
   * Marcos 2026-06-12: bulk-discard pending drafts older than a
   * cutoff. The QA panel surfaces this as a "Limpiar" dropdown so
   * operators can sweep stale drafts (the AI piled up 47 of them
   * during the credit outage and Marcos doesn't want to click
   * Descartar 47 times). `olderThanHours = 0` means "every pending
   * draft regardless of age". Returns the number actually cleared.
   */
  async bulkDiscardPendingReview(olderThanHours: number): Promise<number> {
    const cutoffMs = Number.isFinite(olderThanHours) && olderThanHours > 0
      ? Date.now() - olderThanHours * 3_600_000
      : Date.now() + 60_000; // "all" → cutoff slightly in the future
    const cutoff = new Date(cutoffMs);
    const rows = await this.prisma.message.findMany({
      where: {
        isFromAI: true,
        metadata: { path: ['pendingReview'], equals: true } as any,
        timestamp: { lt: cutoff },
      },
      select: { id: true },
    });
    for (const r of rows) {
      await this.clearPendingReview(r.id);
    }
    return rows.length;
  }

  /**
   * Marcos 2026-06-12: read the live AI-auto-reply override stored
   * in the Configuration table. When true, the webhook flow sends
   * the AI reply straight to ML; when false (default) the reply
   * stays as a draft in the review panel. Overrides
   * ML_QA_REVIEW_MODE so Marcos can toggle from the UI without
   * redeploys.
   */
  async getAiAutoReplyEnabled(): Promise<boolean> {
    const row = await this.prisma.configuration.findUnique({
      where: { key: 'ml_qa_auto_reply_enabled' },
      select: { value: true, isActive: true },
    });
    if (!row || !row.isActive) {
      // Fall back to env so the flag-flip yesterday still wins until
      // an admin has touched the toggle.
      return (process.env.ML_QA_REVIEW_MODE ?? 'true').toLowerCase() !== 'true';
    }
    const v = row.value as any;
    return v === true || v === 'true';
  }
  async setAiAutoReplyEnabled(enabled: boolean): Promise<void> {
    await this.prisma.configuration.upsert({
      where: { key: 'ml_qa_auto_reply_enabled' },
      create: {
        key: 'ml_qa_auto_reply_enabled',
        type: 'AI',
        value: enabled as any,
        description: 'When true, ML QA auto-sends AI replies. When false (default), replies stay as drafts for operator review.',
        isActive: true,
      },
      update: { value: enabled as any, isActive: true },
    });
  }

  /**
   * Marcos 2026-06-12: list ML questions on the seller side that are
   * still `UNANSWERED` and don't yet have a draft pending review in
   * our DB. These are the candidates the backfill endpoint will hand
   * to the AI pipeline once Anthropic credits are restored.
   *
   * `dryRun: true` skips any side-effect — just returns the queue so
   * Marcos can eyeball it. The actual processing is done by the
   * controller after this returns, since the pipeline depends on the
   * webhook controller's handler.
   */
  async findBackfillCandidates(args: {
    cuenta: 'cuenta1' | 'cuenta2' | 'both';
  }): Promise<Array<{
    accountKey: 'mercadolibre' | 'mercadolibre_cuenta2';
    questionId: string;
    itemId: string;
    fromId: string;
    text: string;
    dateCreated: string | null;
    alreadyProcessed: boolean;
  }>> {
    const accounts: Array<'mercadolibre' | 'mercadolibre_cuenta2'> = [];
    if (args.cuenta === 'both' || args.cuenta === 'cuenta1') accounts.push('mercadolibre');
    if (args.cuenta === 'both' || args.cuenta === 'cuenta2') accounts.push('mercadolibre_cuenta2');
    const out: Array<{
      accountKey: 'mercadolibre' | 'mercadolibre_cuenta2';
      questionId: string;
      itemId: string;
      fromId: string;
      text: string;
      dateCreated: string | null;
      alreadyProcessed: boolean;
    }> = [];
    // Pull each cuenta's unanswered set + check which of those
    // already have an AI draft in our DB (so re-running the
    // backfill is idempotent).
    for (const accountKey of accounts) {
      if (!this.mercadolibre) continue;
      const questions = await this.mercadolibre.getUnansweredQuestionsFor(accountKey);
      for (const q of questions) {
        // metadata.mlQuestionId === q.id means we already routed
        // this through the AI pipeline once. Counts as processed
        // even if it's still pendingReview — the operator just
        // hasn't released yet.
        const existing = await this.prisma.message.findFirst({
          where: {
            isFromAI: true,
            metadata: { path: ['mlQuestionId'], equals: q.id } as any,
          },
          select: { id: true },
        });
        out.push({
          accountKey,
          questionId: q.id,
          itemId: q.itemId ?? '',
          fromId: q.fromId ?? '',
          text: q.text ?? '',
          dateCreated: q.dateCreated ? q.dateCreated.toISOString() : null,
          alreadyProcessed: existing != null,
        });
      }
    }
    return out;
  }

  /**
   * Marcos 2026-06-11: list every AI message currently flagged as
   * pendingReview, newest first. The operator opens these in the QA
   * panel, edits if needed, then hits "Enviar a ML".
   */
  async listPendingDrafts(limit = 50): Promise<Array<{
    messageId: string;
    conversationId: string;
    contactName: string | null;
    contactId: string;
    mlQuestionId: string | null;
    mlAccountKey: string | null;
    content: string;
    createdAt: Date;
    // Marcos 2026-06-12: publication context so the operator can
    // validate the AI draft against the listing the buyer is asking
    // about, instead of staring at a bare question id.
    questionText: string | null;
    itemId: string | null;
    itemTitle: string | null;
    itemPermalink: string | null;
  }>> {
    const rows = await this.prisma.message.findMany({
      where: {
        isFromAI: true,
        // Postgres JSON containment: metadata @> '{"pendingReview": true}'
        metadata: { path: ['pendingReview'], equals: true } as any,
      },
      orderBy: { timestamp: 'desc' },
      take: Math.max(1, Math.min(200, limit)),
      select: {
        id: true,
        content: true,
        timestamp: true,
        metadata: true,
        conversationId: true,
        conversation: {
          select: {
            contactId: true,
            contact: { select: { name: true } },
          },
        },
      },
    });
    // Messages are stored encrypted-at-rest (`enc:v1:...`) — decrypt
    // before handing to the UI or the operator gets ciphertext in the
    // review panel. Marcos 2026-06-11.
    const cipher = getMessageCipher();
    // Marcos 2026-06-12: enrich each draft with the buyer's question
    // text + publication context. The CUSTOMER message that
    // triggered the draft is the most recent non-AI message in the
    // same conversation older than the draft. Done in a single batch
    // query so 47 drafts don't fan out to 47 round-trips.
    const conversationIds = Array.from(new Set(rows.map((r) => r.conversationId)));
    const customerMessages = conversationIds.length
      ? await this.prisma.message.findMany({
          where: {
            conversationId: { in: conversationIds },
            isFromAI: false,
          },
          orderBy: { timestamp: 'desc' },
          select: { id: true, conversationId: true, content: true, metadata: true, timestamp: true },
        })
      : [];
    const byConv = new Map<string, typeof customerMessages>();
    for (const cm of customerMessages) {
      const list = byConv.get(cm.conversationId) ?? [];
      list.push(cm);
      byConv.set(cm.conversationId, list);
    }
    const result: Array<{
      messageId: string;
      conversationId: string;
      contactName: string | null;
      contactId: string;
      mlQuestionId: string | null;
      mlPackId: string | null;
      mlAccountKey: string | null;
      // Marcos 2026-06-17: draft kind for the segmentation UI.
      // 'question' = ML pre-venta Q&A; 'message' = post-venta DM.
      // Claims escalate without a draft so they don't appear here —
      // /admin/mercadolibre/qa/open-claims surfaces those.
      kind: 'question' | 'message';
      content: string;
      createdAt: Date;
      questionText: string | null;
      itemId: string | null;
      itemTitle: string | null;
      itemPermalink: string | null;
    }> = [];
    for (const m of rows) {
      const meta = (m.metadata as Record<string, unknown> | null) ?? {};
      // Find the most recent CUSTOMER message just before the draft.
      const candidates = byConv.get(m.conversationId) ?? [];
      const question = candidates.find((cm) => cm.timestamp.getTime() <= m.timestamp.getTime());
      const qMeta = (question?.metadata as Record<string, unknown> | null) ?? {};
      const itemId = (typeof qMeta.mlItemId === 'string' && qMeta.mlItemId) || null;
      // Best-effort title from the in-process listing cache. Never
      // round-trips ML on a UI render — if the cache is cold we just
      // return null and the UI shows the bare id + permalink.
      let itemTitle: string | null = null;
      if (itemId && this.mercadolibre && typeof (this.mercadolibre as any).peekCachedListingTitle === 'function') {
        itemTitle = (this.mercadolibre as any).peekCachedListingTitle(itemId) ?? null;
      }
      // Canonical permalink. The bare `MLA{digits}` 404s; the
      // article host expects `MLA-{digits}-_JM`.
      const itemPermalink = itemId
        ? `https://articulo.mercadolibre.com.ar/${itemId.replace(/^([A-Z]{3})(\d+)$/, '$1-$2')}-_JM`
        : null;
      const mlQuestionId = typeof meta.mlQuestionId === 'string' ? meta.mlQuestionId : null;
      const mlPackId = typeof meta.mlPackId === 'string' ? meta.mlPackId : null;
      const rawKind = typeof meta.mlDraftKind === 'string' ? meta.mlDraftKind : null;
      // Fallback when the metadata predates the kind tag: question by
      // default; pack-id presence implies post-venta message.
      const kind: 'question' | 'message' =
        rawKind === 'message' ? 'message'
        : rawKind === 'question' ? 'question'
        : mlPackId ? 'message'
        : 'question';
      result.push({
        messageId: m.id,
        conversationId: m.conversationId,
        contactName: m.conversation?.contact?.name ?? null,
        contactId: m.conversation?.contactId ?? '',
        mlQuestionId,
        mlPackId,
        mlAccountKey: typeof meta.mlAccountKey === 'string' ? meta.mlAccountKey : null,
        kind,
        content: cipher.decrypt(m.content),
        createdAt: m.timestamp,
        questionText: question ? cipher.decrypt(question.content) : null,
        itemId,
        itemTitle,
        itemPermalink,
      });
    }
    return result;
  }

  /**
   * Marcos 2026-06-17: list open reclamos (escalated to human handoff
   * via the post_purchase webhook). Claims don't get an AI draft —
   * the claim handler saves the customer message with kind='ml_claim'
   * and escalates. The QA panel's Reclamos section queries this
   * endpoint to surface them next to questions + messages.
   */
  async listOpenClaims(limit = 50): Promise<Array<{
    conversationId: string;
    messageId: string;
    contactId: string;
    contactName: string | null;
    content: string;
    mlAccountKey: string | null;
    mlResourceId: string | null;
    createdAt: Date;
    /** Marcos 2026-06-18: extra claim messages on the same
     *  conversation (ML often sends 3-5 webhooks for one reclamo).
     *  Surfaced as a count so the operator knows there's a thread. */
    messageCount: number;
  }>> {
    // Marcos 2026-06-18: only the last 30 days of claims surface in
    // the Reclamos panel — older ones that ML already closed but
    // we never cleared just clutter the queue. Operator can still
    // clear stale rows manually with "Marcar como resuelto".
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.message.findMany({
      where: {
        isFromAI: false,
        timestamp: { gte: since },
        metadata: { path: ['kind'], equals: 'ml_claim' } as any,
        conversation: {
          channel: Channel.MERCADOLIBRE,
          needsHumanAttention: true,
        },
      },
      orderBy: { timestamp: 'desc' },
      take: Math.max(1, Math.min(500, limit * 6)),
      select: {
        id: true,
        content: true,
        timestamp: true,
        metadata: true,
        conversationId: true,
        conversation: {
          select: {
            contactId: true,
            contact: { select: { name: true } },
          },
        },
      },
    });
    // Marcos 2026-06-18: dedupe by conversation. ML fires multiple
    // post_purchase webhooks per claim (created → message added →
    // status change) and each one saved a row. Operator only needs
    // ONE card per reclamo — the freshest message, with the rest
    // collapsed into a messageCount.
    const cipher = getMessageCipher();
    const byConv = new Map<string, { latest: typeof rows[number]; count: number }>();
    for (const m of rows) {
      const prev = byConv.get(m.conversationId);
      if (!prev) {
        byConv.set(m.conversationId, { latest: m, count: 1 });
      } else {
        prev.count++;
      }
    }
    return Array.from(byConv.values())
      .sort((a, b) => b.latest.timestamp.getTime() - a.latest.timestamp.getTime())
      .slice(0, Math.max(1, Math.min(200, limit)))
      .map(({ latest: m, count }) => {
        const meta = (m.metadata as Record<string, unknown> | null) ?? {};
        return {
          conversationId: m.conversationId,
          messageId: m.id,
          contactId: m.conversation?.contactId ?? '',
          contactName: m.conversation?.contact?.name ?? null,
          content: cipher.decrypt(m.content),
          mlAccountKey: typeof meta.mlAccountKey === 'string' ? meta.mlAccountKey : null,
          mlResourceId: typeof meta.mlResourceId === 'string' ? meta.mlResourceId : null,
          createdAt: m.timestamp,
          messageCount: count,
        };
      });
  }

  /**
   * Marcos 2026-06-22: re-pull el contenido real de los reclamos
   * abiertos. Diseñado para correrse una vez después del deploy que
   * cambia el formato de fetchClaimDetails — las 425 filas viejas
   * tienen el summary metadata stub, este refresh las actualiza con
   * el texto del comprador. Idempotente: si volves a correrlo no
   * rompe nada, sólo trae mensajes más recientes si los hubo.
   *
   * Usa fetchClaimDetails per row (que internamente hace 2 calls a
   * la API de ML por reclamo). ~200ms cada uno × N rows. Devuelve
   * counts de updated/skipped/errored para que el caller sepa el
   * resultado.
   */
  async refreshOpenClaims(opts?: { limit?: number }): Promise<{
    scanned: number;
    updated: number;
    skipped: number;
    errored: number;
    notes: string[];
  }> {
    const result = { scanned: 0, updated: 0, skipped: 0, errored: 0, notes: [] as string[] };
    if (!this.mercadolibre) {
      result.notes.push('MercadoLibreService no conectado — no se puede refrescar.');
      return result;
    }
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.message.findMany({
      where: {
        timestamp: { gte: since },
        metadata: { path: ['kind'], equals: 'ml_claim' } as any,
      },
      orderBy: { timestamp: 'desc' },
      take: Math.max(1, Math.min(1000, opts?.limit ?? 500)),
      select: { id: true, content: true, metadata: true },
    });
    const cipher = getMessageCipher();
    for (const m of rows) {
      result.scanned++;
      const meta = (m.metadata as Record<string, unknown> | null) ?? {};
      const claimId = typeof meta.mlResourceId === 'string' ? meta.mlResourceId : null;
      const accountKey = typeof meta.mlAccountKey === 'string' ? meta.mlAccountKey : 'mercadolibre';
      if (!claimId) { result.skipped++; continue; }
      try {
        const fresh = await this.mercadolibre.fetchClaimDetails(
          claimId,
          accountKey === 'mercadolibre_cuenta2' ? 'mercadolibre_cuenta2' : 'mercadolibre',
        );
        if (!fresh) { result.skipped++; continue; }
        const newCipher = cipher.encrypt(fresh.text);
        if (newCipher === m.content) { result.skipped++; continue; }
        await this.prisma.message.update({
          where: { id: m.id },
          data: { content: newCipher },
        });
        result.updated++;
      } catch (err: any) {
        result.errored++;
        if (result.notes.length < 5) {
          result.notes.push(`claim ${claimId}: ${err?.message ?? err}`);
        }
      }
    }
    return result;
  }

  /**
   * Marcos 2026-06-22: reconcile nuestra DB contra la lista canónica
   * de reclamos abiertos de ML. El webhook tiene gaps — reclamos que
   * se cerraron en ML sin notificarnos quedan con
   * needsHumanAttention=true en nuestra base, inflando el panel
   * 'Reclamos abiertos'. Smoke real 2026-06-22: nuestra base mostraba
   * 58 abiertos, ML tiene 11. 47 stale.
   *
   * Flujo:
   *   1. fetchOpenClaimIds() en cuenta 1 + cuenta 2 → set canónico
   *   2. Para cada conversación con needsHumanAttention=true cuyo
   *      último ml_claim.mlResourceId NO está en el set, limpiar el
   *      flag (mark resolved).
   *   3. Loggear mismatches: claims en ML pero no en DB (= webhook
   *      perdido — los reportamos sin auto-ingestar; el operador o
   *      el próximo webhook los traerá).
   *
   * Idempotente.
   */
  async syncOpenClaimsWithMl(): Promise<{
    mlOpen: number;
    dbOpen: number;
    resolved: number;
    missingInDb: string[];
    notes: string[];
  }> {
    const result = {
      mlOpen: 0,
      dbOpen: 0,
      resolved: 0,
      missingInDb: [] as string[],
      notes: [] as string[],
    };
    if (!this.mercadolibre) {
      result.notes.push('MercadoLibreService no conectado — no se puede sync.');
      return result;
    }
    // 1. set canónico (cuenta 1 + cuenta 2)
    const mlOpen = new Set<string>();
    for (const cuenta of ['mercadolibre', 'mercadolibre_cuenta2'] as const) {
      try {
        const ids = await this.mercadolibre.fetchOpenClaimIds(cuenta);
        for (const id of ids) mlOpen.add(id);
        result.notes.push(`${cuenta}: ${ids.length} abiertos`);
      } catch (err: any) {
        result.notes.push(`${cuenta}: error ${err?.message ?? err}`);
      }
    }
    result.mlOpen = mlOpen.size;

    // 2. rows abiertos en nuestra DB con su mlResourceId. Filtra al
    //    último ml_claim de cada conversación con needsHumanAttention.
    const openConvs = await this.prisma.conversation.findMany({
      where: {
        needsHumanAttention: true,
        channel: Channel.MERCADOLIBRE,
      },
      select: { id: true },
    });
    result.dbOpen = openConvs.length;

    for (const conv of openConvs) {
      // Último msg con kind=ml_claim para esa conversación
      const last = await this.prisma.message.findFirst({
        where: {
          conversationId: conv.id,
          metadata: { path: ['kind'], equals: 'ml_claim' } as any,
        },
        orderBy: { timestamp: 'desc' },
        select: { metadata: true },
      });
      if (!last) continue;
      const meta = (last.metadata as Record<string, unknown> | null) ?? {};
      const claimId = typeof meta.mlResourceId === 'string' ? meta.mlResourceId : null;
      if (!claimId) continue;
      if (!mlOpen.has(claimId)) {
        // ML lo dio por cerrado — limpiamos el flag.
        try {
          await this.prisma.conversation.update({
            where: { id: conv.id },
            data: { needsHumanAttention: false, escalatedAt: null },
          });
          result.resolved++;
        } catch {
          /* ignore — sigue */
        }
      }
    }

    // 3. detectar claims que ML reporta abiertos pero nosotros no
    //    tenemos. Los listamos para visibilidad sin auto-ingestar.
    const dbClaimIds = new Set<string>();
    const allOurClaims = await this.prisma.message.findMany({
      where: { metadata: { path: ['kind'], equals: 'ml_claim' } as any },
      select: { metadata: true },
    });
    for (const m of allOurClaims) {
      const meta = (m.metadata as Record<string, unknown> | null) ?? {};
      const id = typeof meta.mlResourceId === 'string' ? meta.mlResourceId : null;
      if (id) dbClaimIds.add(id);
    }
    for (const mid of mlOpen) {
      if (!dbClaimIds.has(mid)) result.missingInDb.push(mid);
    }
    if (result.missingInDb.length > 0) {
      this.logger.warn(
        `syncOpenClaimsWithMl: ${result.missingInDb.length} reclamos abiertos en ML que NO están en nuestra DB ` +
        `(probable webhook perdido): ${result.missingInDb.slice(0, 10).join(', ')}${result.missingInDb.length > 10 ? '…' : ''}`,
      );
    }
    return result;
  }

  /**
   * Marcos 2026-06-18: clear the needsHumanAttention flag on a
   * conversation so the Reclamos panel drops it. Used by the
   * "Marcar como resuelto" button on each claim card.
   */
  async resolveClaim(conversationId: string): Promise<boolean> {
    try {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { needsHumanAttention: false, escalatedAt: null },
      });
      return true;
    } catch (err: any) {
      if (err?.code === 'P2025') return false;
      throw err;
    }
  }

  /**
   * Marcos 2026-06-12: persist an in-flight edit of a pending draft.
   * The operator's textarea changes are debounced into this endpoint
   * so when they leave the panel and come back the edit is still
   * there. Stays pendingReview — only `release` clears the flag.
   * Returns false when the message doesn't exist or isn't actually
   * a pending draft so the caller can show a soft error.
   */
  async updateDraftText(messageId: string, newText: string): Promise<boolean> {
    const cleaned = (newText ?? '').trim();
    if (cleaned.length === 0) return false;
    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, metadata: true, isFromAI: true },
    });
    if (!msg || !msg.isFromAI) return false;
    const meta = (msg.metadata as Record<string, unknown> | null) ?? {};
    if (meta.pendingReview !== true) return false;
    const cipher = getMessageCipher();
    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        content: cipher.encrypt(cleaned),
        metadata: {
          ...meta,
          // Mark the row as operator-edited so the release-time
          // learning hook can detect it even if the controller's
          // body-text compare lost the original (e.g. autosave path
          // wrote the edit before release).
          operatorEdited: true,
          operatorEditedAt: new Date().toISOString(),
        } as any,
      },
    });
    return true;
  }

  /**
   * Marcos 2026-06-11: clear pendingReview from a draft. Used by both
   * release (after send-to-ML succeeds) and discard.
   */
  async clearPendingReview(messageId: string, releasedText?: string): Promise<void> {
    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: { metadata: true },
    });
    if (!msg) return;
    const prev = (msg.metadata as Record<string, unknown> | null) ?? {};
    const next = { ...prev };
    delete next.pendingReview;
    next.releasedAt = new Date().toISOString();
    if (releasedText !== undefined) next.releasedText = releasedText;
    await this.prisma.message.update({
      where: { id: messageId },
      data: {
        metadata: next as any,
        ...(releasedText !== undefined ? { content: releasedText } : {}),
      },
    });
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}

/**
 * Extract the numeric MLA id from a full Product.mlPermalink URL.
 * Permalinks come in two flavours (article + catalog):
 *   https://articulo.mercadolibre.com.ar/MLA-1500591407-...
 *   https://www.mercadolibre.com.ar/MLA-1500591407-_JM
 * Returns the id digits or null if the URL doesn't match.
 */
function extractMlaId(permalink: string | null | undefined): string | null {
  if (!permalink) return null;
  const m = /MLA-?(\d+)/i.exec(permalink);
  return m ? m[1] : null;
}
