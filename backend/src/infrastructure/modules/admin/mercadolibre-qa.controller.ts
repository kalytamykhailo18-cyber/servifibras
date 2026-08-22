/**
 * INFRASTRUCTURE LAYER — MercadoLibre Q&A panel endpoint.
 *
 *   GET /admin/mercadolibre/qa?limit=50&since=ISO
 *
 * Backs the dedicated /mercadolibre page that mirrors Marcos's
 * existing CRM view: one row per ML question + agent reply, ordered
 * by response time. Open to any operator role (ATENCION reads it to
 * monitor what the agent is saying on listings she handles); writes
 * (corrections) still go through the existing /admin/quality flow.
 */

import { BadRequestException, Body, Controller, Get, Logger, Optional, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import {
  MercadolibreQaService,
  MlQaRow,
} from '../../../adapters/admin/mercadolibre-qa.service';
import { MercadoLibreService } from '../../../adapters/mercadolibre/mercadolibre.service';
import { ConversationHandlerService } from '../../../adapters/conversations/conversation-handler.service';
import { ConversationScorerService } from '../../../adapters/quality/conversation-scorer.service';
import { MlPublicationKnowledgeService } from '../../../adapters/admin/ml-publication-knowledge.service';
import {
  MercadoLibreIncomingMessage,
  MercadoLibreMessageType,
  MercadoLibreStatus,
} from '../../../domain/entities/mercadolibre-message.entity';
import { Channel, PrismaClient } from '@prisma/client';

import { PrismaService } from '../../../adapters/repositories/prisma.service';
@Controller('admin/mercadolibre')
@UseGuards(AuthGuard, RolesGuard)
// Marcos 2026-06-23 originalmente sumó ENCARGADO al sub-tab ML del
// frontend para supervisión cross-role (memoria: "ENCARGADO sumado
// al sub-tab ML de Conversaciones — Preguntas / Mensajes / Reclamos").
// El gate a nivel controller acá tenía que matchear: sin ENCARGADO los
// clicks dentro del tab caían 403 silenciosos. Audit 2026-06-27 lo
// detectó. Los handlers que igual quieran restringir más (ej.
// configuración) llevan @Roles propio.
@Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.ENCARGADO)
export class MercadolibreQaController {
  private readonly prisma: PrismaClient;
  private readonly logger = new Logger(MercadolibreQaController.name);
  constructor(
    private readonly svc: MercadolibreQaService,
    private readonly mlService: MercadoLibreService,
    private readonly conversationHandler: ConversationHandlerService,
    private readonly scorer: ConversationScorerService,
    // Marcos 2026-06-29: inyectada para append-on-release —
    // toda Q&A que sale por este endpoint queda registrada como
    // fila kept en MlPublicationKnowledge para que el historial
    // del panel /ml-conocimiento siga vivo.
    private readonly mlKnowledge: MlPublicationKnowledgeService,
    @Optional() prismaShared?: PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  @Get('qa/counts')
  async counts(): Promise<{ success: true; data: Awaited<ReturnType<MercadolibreQaService['qaFilterCounts']>> }> {
    return { success: true, data: await this.svc.qaFilterCounts() };
  }

  /**
   * Marcos 2026-07-24: al lado de una pregunta pendiente, mostrar las
   * preguntas anteriores del mismo comprador sobre la misma publicación.
   * Espejo de lo que hace la propia interfaz de ML.
   *
   * GET /admin/mercadolibre/qa/prior?contactId=xxx&itemId=MLA...&excludeMessageId=xxx&limit=10
   * Devuelve pares (pregunta cliente + respuesta agente) más viejos que
   * la pregunta actual, sobre la MISMA publicación, del MISMO comprador.
   */
  @Get('qa/prior')
  async prior(
    @Query('contactId') contactId?: string,
    @Query('itemId') itemId?: string,
    @Query('excludeMessageId') excludeMessageId?: string,
    @Query('limit') limit?: string,
  ): Promise<{ success: true; data: Array<{ questionAt: string; questionText: string; replyAt: string | null; replyText: string | null }> }> {
    if (!contactId || !itemId) {
      throw new BadRequestException('contactId y itemId son requeridos');
    }
    const limitNum = Math.min(20, Math.max(1, limit != null ? Number(limit) : 10));
    const data = await this.svc.listPriorQaForBuyerOnItem({
      contactId,
      itemId,
      excludeMessageId: excludeMessageId ?? null,
      limit: Number.isFinite(limitNum) ? limitNum : 10,
    });
    return { success: true, data };
  }

  @Get('qa')
  async list(
    @Query('limit') limit?: string,
    @Query('since') since?: string,
    @Query('flagged') flagged?: string,
    @Query('maxScore') maxScore?: string,
    @Query('search') search?: string,
  ): Promise<{ success: true; data: MlQaRow[] }> {
    const limitNum = limit != null ? Number(limit) : undefined;
    const sinceDate = since ? new Date(since) : null;
    const validSince = sinceDate && !isNaN(sinceDate.getTime()) ? sinceDate : null;
    const flaggedOnly = flagged === '1' || flagged === 'true';
    const maxScoreNum = maxScore != null ? Number(maxScore) : null;
    const validMaxScore =
      maxScoreNum !== null && Number.isFinite(maxScoreNum) && maxScoreNum >= 0
        ? maxScoreNum
        : null;
    const data = await this.svc.listQaPairs({
      limit: Number.isFinite(limitNum) && limitNum! > 0 ? limitNum : undefined,
      since: validSince,
      flaggedOnly,
      maxScore: validMaxScore,
      search: search ?? null,
    });
    return { success: true, data };
  }

  /**
   * Marcos 2026-06-11: list every AI message currently flagged as
   * pendingReview (i.e. ML_QA_REVIEW_MODE was on when the AI drafted
   * the answer, and the operator hasn't released it yet). Drives the
   * "Borradores pendientes" panel.
   */
  @Get('qa/pending-drafts')
  async pendingDrafts(@Query('limit') limit?: string) {
    const limitNum = limit != null ? Number(limit) : 50;
    const data = await this.svc.listPendingDrafts(Number.isFinite(limitNum) ? limitNum : 50);
    return { success: true, data };
  }

  /**
   * Marcos 2026-06-18 PM: typeahead "#" del compositor del panel de QA.
   * Devuelve publicaciones ACTIVAS de ML que matchean la query — NO
   * del catálogo TN. Sirve para insertar link directo a otra
   * publicación cuando el operador responde a un comprador y quiere
   * derivarlo a una variante / complemento que tenemos publicada.
   */
  @Get('listings/search')
  async searchListings(@Query('q') q?: string, @Query('limit') limit?: string) {
    const data = await this.mlService.searchActiveListings({
      q: (q ?? '').trim(),
      limit: limit != null ? Number(limit) : undefined,
    });
    return { success: true, data };
  }

  /**
   * Marcos 2026-06-17: list open reclamos for the QA panel's Reclamos
   * section. Claims escalate to human handoff without an AI draft, so
   * they're not in pending-drafts — this endpoint surfaces them.
   */
  /**
   * Marcos 2026-06-22: backfill — re-fetch del contenido de los
   * reclamos abiertos contra la API de ML. Sirve para que las filas
   * existentes (que tienen sólo el summary metadata) levanten el
   * texto real del comprador después del cambio de fetchClaimDetails.
   * ADMIN-only — la operación itera ~400 claims contra ML y puede
   * tardar minutos.
   */
  /**
   * Marcos 2026-06-22: reconcile contra la verdad de ML — el panel
   * de reclamos abiertos se llenaba con stale-positives porque los
   * webhooks no siempre nos avisan cuando ML cierra el reclamo del
   * lado de ellos. Esta ruta cierra los stale + lista los que ML
   * tiene como abiertos pero nos faltan (webhook perdido).
   */
  @Post('qa/sync-claims')
  async syncClaims() {
    const data = await this.svc.syncOpenClaimsWithMl();
    return { success: true, data };
  }

  @Post('qa/refresh-claims')
  async refreshClaims(@Query('limit') limitRaw?: string) {
    const limit = limitRaw != null ? Number(limitRaw) : undefined;
    const data = await this.svc.refreshOpenClaims({
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return { success: true, data };
  }

  @Get('qa/open-claims')
  async openClaims(@Query('limit') limit?: string) {
    const limitNum = limit != null ? Number(limit) : 50;
    const data = await this.svc.listOpenClaims(Number.isFinite(limitNum) ? limitNum : 50);
    return { success: true, data };
  }

  /**
   * Marcos 2026-06-18: "Marcar como resuelto" on a claim card —
   * clears the conversation's needsHumanAttention flag so the
   * Reclamos list drops it on next refresh.
   */
  @Post('qa/claim/:conversationId/resolve')
  async resolveClaim(@Param('conversationId') conversationId: string) {
    const ok = await this.svc.resolveClaim(conversationId);
    if (!ok) throw new BadRequestException('conversation not found');
    return { success: true };
  }

  /**
   * Marcos 2026-06-11: release a pending draft to MercadoLibre.
   * Body: { text?: string } — if omitted, the saved AI text is sent
   * verbatim; if provided, the operator's edited version is sent and
   * also overwrites Message.content so the conversation log shows
   * what actually went out.
   */
  @Post('qa/release/:messageId')
  @Roles(UserRole.ADMIN, UserRole.ATENCION)
  async release(
    @Param('messageId') messageId: string,
    @Body() body: { text?: string },
    @Request() req: any,
  ) {
    const drafts = await this.svc.listPendingDrafts(200);
    const draft = drafts.find((d) => d.messageId === messageId);
    if (!draft) throw new BadRequestException('draft not found or already released');
    if (!draft.mlQuestionId) throw new BadRequestException('draft has no mlQuestionId stamped');
    const finalText = typeof body?.text === 'string' && body.text.trim().length > 0
      ? body.text.trim()
      : draft.content;
    // Marcos 2026-06-12: pass the cuenta key that originated the
    // draft so the answer is sent with the owning seller's token.
    // Without this the cuenta-2 drafts looked sent but never
    // appeared on ML.
    const accountKey =
      draft.mlAccountKey === 'mercadolibre_cuenta2' ? 'mercadolibre_cuenta2' : 'mercadolibre';
    const send = await this.mlService.answerQuestion(draft.mlQuestionId, finalText, accountKey);
    if (!send.success) {
      throw new BadRequestException(`ML rejected the answer: ${send.error ?? 'unknown'}`);
    }
    await this.svc.clearPendingReview(messageId, finalText);
    // Marcos 2026-06-29: appendea la Q&A a MlPublicationKnowledge
    // como fila curated 'kept' — el panel /ml-conocimiento muestra
    // el historial creciendo en vivo en vez de quedar congelado en
    // el último ingest manual. Idempotente vía mlQuestionId único.
    // Best-effort: si falla no rompemos el release (el send a ML
    // ya pasó), sólo logueamos.
    if (draft.itemId && draft.questionText) {
      const ak: 'mercadolibre' | 'mercadolibre_cuenta2' =
        accountKey === 'mercadolibre_cuenta2' ? 'mercadolibre_cuenta2' : 'mercadolibre';
      void this.mlKnowledge.appendAnsweredQuestion({
        itemId: draft.itemId,
        accountKey: ak,
        mlQuestionId: draft.mlQuestionId,
        questionText: draft.questionText,
        answerText: finalText,
      }).catch((err) => {
        this.logger.warn(`appendAnsweredQuestion non-fatal failure for ${draft.mlQuestionId}: ${err?.message ?? err}`);
      });
    }

    // Marcos 2026-06-12: when the operator EDITED the draft before
    // releasing, the edited text is a correction signal — promote it
    // as a training example so future similar questions reproduce
    // Marcos's pattern instead of the AI's original draft. Sent
    // unchanged means the AI's text was good enough; no save needed.
    const operatorEdited =
      typeof body?.text === 'string'
      && body.text.trim().length > 0
      && body.text.trim() !== draft.content.trim();
    if (operatorEdited) {
      void this.scorer.promoteMessageAsExample(messageId, finalText).catch((err) => {
        this.logger.warn(`Could not promote draft ${messageId} as training example: ${err?.message ?? err}`);
      });
    }
    return {
      success: true,
      data: {
        messageId,
        mlQuestionId: draft.mlQuestionId,
        sentBy: req.user?.email ?? null,
      },
    };
  }

  /**
   * Marcos 2026-06-11: drop the pendingReview flag without sending —
   * operator decided to answer manually in ML's panel, or the draft
   * is too far off to salvage. The AI message stays in the
   * conversation log for the QA + correction pipeline; only the
   * "needs operator action" flag clears.
   */
  @Post('qa/discard/:messageId')
  @Roles(UserRole.ADMIN, UserRole.ATENCION)
  async discard(@Param('messageId') messageId: string) {
    await this.svc.clearPendingReview(messageId);
    return { success: true, data: { messageId } };
  }

  /**
   * Marcos 2026-06-25: el operador escribe una respuesta corta y
   * Claude la mejora — agrega saludo, suma info complementaria desde
   * ficha + Q&A curadas, ajusta tono. NO escribe en DB; devuelve el
   * texto mejorado para que el operador apruebe / siga editando antes
   * de "Enviar".
   */
  @Post('qa/improve-draft/:messageId')
  @Roles(UserRole.ADMIN, UserRole.ATENCION)
  async improveDraft(
    @Param('messageId') messageId: string,
    @Body() body: { text?: string },
  ) {
    const text = typeof body?.text === 'string' ? body.text : '';
    if (!text.trim()) throw new BadRequestException('text vacío');
    const r = await this.svc.improveOperatorDraft({ messageId, operatorText: text });
    if (!r.ok) throw new BadRequestException(r.reason ?? 'No se pudo mejorar');
    return { success: true, data: { messageId, improved: r.improvedContent } };
  }

  /**
   * Marcos 2026-06-24: re-correr el agente sobre la misma pregunta
   * usando el prompt actual. Útil cuando ajustamos el prompt + el
   * draft pendiente quedó congelado con la respuesta vieja.
   */
  @Post('qa/regenerate/:messageId')
  @Roles(UserRole.ADMIN, UserRole.ATENCION)
  async regenerate(@Param('messageId') messageId: string) {
    const r = await this.svc.regenerateDraft(messageId);
    if (!r.ok) throw new BadRequestException(r.reason ?? 'No se pudo regenerar');
    return { success: true, data: { messageId, content: r.newContent } };
  }

  /**
   * Marcos 2026-06-12: persist mid-edit changes to a pending draft
   * so leaving + returning to the panel doesn't blow away the
   * operator's work. UI debounces typing into this endpoint
   * (~1.5s of idle). The draft stays pendingReview — release is
   * still a separate action.
   */
  @Post('qa/draft/:messageId')
  @Roles(UserRole.ADMIN, UserRole.ATENCION)
  async updateDraftText(
    @Param('messageId') messageId: string,
    @Body() body: { text?: string },
  ) {
    const text = typeof body?.text === 'string' ? body.text : '';
    const updated = await this.svc.updateDraftText(messageId, text);
    if (!updated) throw new BadRequestException('draft not found or empty text');
    return { success: true, data: { messageId } };
  }

  /**
   * Marcos 2026-06-12: bulk-discard the pending drafts panel. UI
   * exposes three windows — "everything" (?olderThanHours=0),
   * "older than 24h" (24), "older than 7 days" (168). Returns the
   * number actually cleared.
   */
  @Post('qa/discard-bulk')
  @Roles(UserRole.ADMIN, UserRole.ATENCION)
  async discardBulk(@Query('olderThanHours') olderThanHours?: string) {
    const n = Number(olderThanHours ?? '0');
    const cleared = await this.svc.bulkDiscardPendingReview(
      Number.isFinite(n) && n >= 0 ? n : 0,
    );
    return { success: true, data: { discarded: cleared, olderThanHours: Number.isFinite(n) ? n : 0 } };
  }

  /**
   * Marcos 2026-06-12: runtime AI-auto-reply toggle.
   *   GET  /admin/mercadolibre/qa/ai-mode → { autoReplyEnabled }
   *   POST /admin/mercadolibre/qa/ai-mode  body: { enabled }
   * Default is `false` — every AI reply lands as a draft for review.
   * Setting `true` lets the webhook flow send the AI text straight
   * to ML without waiting for an operator click.
   */
  @Get('qa/ai-mode')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS)
  async aiModeGet() {
    return { success: true, data: { autoReplyEnabled: await this.svc.getAiAutoReplyEnabled() } };
  }
  @Post('qa/ai-mode')
  @Roles(UserRole.ADMIN)
  async aiModeSet(@Body() body: { enabled?: boolean }) {
    const enabled = body?.enabled === true;
    await this.svc.setAiAutoReplyEnabled(enabled);
    return { success: true, data: { autoReplyEnabled: enabled } };
  }

  /**
   * Marcos 2026-06-12 (Phase 1 outstanding): when the Anthropic
   * credit runs dry, ML questions pile up on the seller side
   * unanswered. Once the credit is back, this endpoint walks
   * MercadoLibre's UNANSWERED queue per cuenta and routes anything
   * that doesn't already have a draft pending review through the AI
   * pipeline. With `dryRun=1` it returns the queue without
   * processing — useful for "what's actually waiting?" before
   * committing AI spend.
   *
   * POST /admin/mercadolibre/qa/backfill?dryRun=1&cuenta=both
   *
   * Response:
   *   { success: true, data: {
   *       summary: { cuenta1: {...}, cuenta2: {...}, total: {...} },
   *       queue:   [{ accountKey, questionId, itemId, ... }],  // dryRun
   *       processed: [{ questionId, ok, error? }]               // !dryRun
   *   }}
   */
  @Post('qa/backfill')
  @Roles(UserRole.ADMIN)
  async backfill(
    @Query('dryRun') dryRunRaw?: string,
    @Query('cuenta') cuentaRaw?: string,
  ) {
    const dryRun = dryRunRaw === '1' || (dryRunRaw ?? '').toLowerCase() === 'true';
    const cuenta: 'cuenta1' | 'cuenta2' | 'both' =
      cuentaRaw === 'cuenta1' || cuentaRaw === 'cuenta2' ? cuentaRaw : 'both';
    const candidates = await this.svc.findBackfillCandidates({ cuenta });
    const perCuenta: Record<string, { unanswered: number; alreadyProcessed: number; needsAi: number }> = {
      cuenta1: { unanswered: 0, alreadyProcessed: 0, needsAi: 0 },
      cuenta2: { unanswered: 0, alreadyProcessed: 0, needsAi: 0 },
    };
    for (const c of candidates) {
      const k = c.accountKey === 'mercadolibre_cuenta2' ? 'cuenta2' : 'cuenta1';
      perCuenta[k].unanswered++;
      if (c.alreadyProcessed) perCuenta[k].alreadyProcessed++;
      else perCuenta[k].needsAi++;
    }
    const needs = candidates.filter((c) => !c.alreadyProcessed);
    if (dryRun) {
      return {
        success: true,
        data: {
          dryRun: true,
          summary: { ...perCuenta, total: {
            unanswered: candidates.length,
            alreadyProcessed: candidates.length - needs.length,
            needsAi: needs.length,
          } },
          queue: needs,
        },
      };
    }
    // Live run — feed each through the AI pipeline. Tracked per
    // questionId so the operator can see which ones failed and why
    // (e.g. Anthropic credit error if budget is back to zero
    // mid-run).
    const processed: Array<{ questionId: string; ok: boolean; error?: string }> = [];
    for (const c of needs) {
      try {
        const question = new MercadoLibreIncomingMessage(
          c.questionId,
          MercadoLibreMessageType.QUESTION,
          c.fromId,
          c.fromId,
          c.text,
          c.itemId,
          MercadoLibreStatus.UNANSWERED,
          c.dateCreated ? new Date(c.dateCreated) : new Date(),
          c.accountKey,
        );
        const r = await this.conversationHandler.handleMercadoLibreMessage(question);
        if (!r.success || !r.response) {
          processed.push({ questionId: c.questionId, ok: false, error: r.error ?? 'no response' });
          continue;
        }
        // Mirror the webhook flow: when review mode is on, the AI
        // draft must be flagged pendingReview so the QA panel
        // surfaces it for the operator. The conversationHandler
        // already saved the message; we patch its metadata.
        const reviewMode = (process.env.ML_QA_REVIEW_MODE ?? 'false').toLowerCase() === 'true';
        if (reviewMode) {
          await this.markLatestDraftPending(c.questionId, c.fromId, c.accountKey).catch(() => {});
        }
        processed.push({ questionId: c.questionId, ok: true });
      } catch (err: any) {
        processed.push({ questionId: c.questionId, ok: false, error: err?.message ?? String(err) });
      }
    }
    return {
      success: true,
      data: {
        dryRun: false,
        summary: { ...perCuenta, total: {
          unanswered: candidates.length,
          alreadyProcessed: candidates.length - needs.length,
          needsAi: needs.length,
          processedOk: processed.filter((p) => p.ok).length,
          processedFail: processed.filter((p) => !p.ok).length,
        } },
        processed,
      },
    };
  }

  /**
   * Same pendingReview marker the webhook controller uses. Kept in
   * sync so the QA panel renders backfilled drafts identically to
   * live ones. Marcos 2026-06-12.
   */
  private async markLatestDraftPending(
    questionId: string,
    mlBuyerId: string,
    mlAccountKey: string | null,
  ): Promise<void> {
    const contact = await this.prisma.contact.findFirst({
      where: { metadata: { path: ['mercadolibreUserId'], equals: mlBuyerId } as any },
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
          mlAccountKey,
        } as any,
      },
    });
  }
}
