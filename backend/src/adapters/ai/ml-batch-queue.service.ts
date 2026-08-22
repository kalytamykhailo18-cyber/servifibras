/**
 * ADAPTERS LAYER — ML batch-queue service (Bloque E item 4).
 *
 * Marcos 2026-06-06 cost optimisation: instead of calling Claude
 * synchronously for every ML pre-venta question, queue inbound
 * questions and dispatch them through Anthropic's Message Batches
 * API. Anthropic discounts batch input + output by 50%; buyers wait
 * minutes longer than the sync path but ML is async by design.
 *
 * Lifecycle of an entry:
 *   PENDING     — just enqueued, awaiting next dispatch tick.
 *   DISPATCHED  — submitted to the Batches API, awaiting result.
 *   ANSWERED    — Claude replied, we posted the answer to ML.
 *   FALLBACK    — batch result was `tool_use`; sync path took over.
 *   FAILED      — batch errored / expired / cancelled.
 *
 * Env knobs:
 *   ML_BATCH_MODE_ENABLED            (default false)  on/off
 *   ML_BATCH_MIN_BATCH_SIZE          (default 2)      min PENDING to dispatch
 *   ML_BATCH_MAX_BATCH_SIZE          (default 50)     cap per submitted batch
 *   ML_BATCH_DISPATCH_INTERVAL_MIN   (default 5)      cron tick
 *   ML_BATCH_POLL_INTERVAL_MIN       (default 2)      poll tick
 *   ML_BATCH_MAX_AGE_MIN             (default 120)    after which PENDING
 *                                                     entries fall back to
 *                                                     sync to bound buyer
 *                                                     wait.
 *   ML_BATCH_FORCE_DISPATCH_AGE_MIN  (default 15)     force-dispatch even if
 *                                                     under min batch size
 *                                                     once oldest PENDING is
 *                                                     this stale.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  PrismaClient,
  MlBatchEntryStatus,
  MessageSender,
} from '@prisma/client';
import { ClaudeService } from './claude.service';
import { AIConversation, AIMessage } from '../../domain/entities/ai-message.entity';
import type { AITurnContext } from '../../use-cases/ai/ai.interface';
import { Channel } from '@prisma/client';
import { MERCADOLIBRE_SERVICE } from '../../use-cases/mercadolibre/mercadolibre.token';
import type { MercadoLibreService } from '../mercadolibre/mercadolibre.service';
import { getMessageCipher } from '../security/message-cipher';

import { PrismaService } from '../repositories/prisma.service';
export interface EnqueueInput {
  conversationId: string;
  contactId: string;
  questionId: string;
  itemId: string | null;
  buyerNickname: string | null;
  questionText: string;
  /** Snapshot of prior AIConversation messages at enqueue time. */
  conversationContext: AIMessage[];
}

@Injectable()
export class MlBatchQueueService {
  private readonly logger = new Logger(MlBatchQueueService.name);
  private readonly prisma: PrismaClient;

  constructor(
    private readonly claude: ClaudeService,
    @Optional() @Inject(MERCADOLIBRE_SERVICE)
    private readonly mercadolibre?: MercadoLibreService,
    @Optional() prismaShared?: PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  static modeEnabled(): boolean {
    return (process.env.ML_BATCH_MODE_ENABLED || '').toLowerCase() === 'true';
  }

  private intEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  async enqueue(input: EnqueueInput): Promise<{ id: string; batchCustomId: string }> {
    if (!input.questionId) {
      throw new Error('enqueue: questionId is required');
    }
    // The Anthropic batch `custom_id` constraints: ≤64 chars, ascii,
    // unique per batch. We use the entry id (uuid) so retries inside
    // a single batch are impossible (DB unique index enforces it).
    const existing = await this.prisma.mlBatchQueueEntry.findUnique({
      where: { questionId: input.questionId },
    });
    if (existing) {
      this.logger.debug(
        `enqueue: question ${input.questionId} already queued as ${existing.id} (status=${existing.status}) — skipping duplicate`,
      );
      return { id: existing.id, batchCustomId: existing.batchCustomId };
    }
    const row = await this.prisma.mlBatchQueueEntry.create({
      data: {
        conversationId: input.conversationId,
        contactId: input.contactId,
        questionId: input.questionId,
        itemId: input.itemId,
        buyerNickname: input.buyerNickname,
        questionText: input.questionText,
        conversationContext: input.conversationContext.map((m) => ({
          role: m.role,
          content: m.content,
        })) as any,
        batchCustomId: this.makeCustomId(),
        status: MlBatchEntryStatus.PENDING,
      },
    });
    this.logger.log(
      `📥 Enqueued ML batch entry ${row.id.slice(0, 8)} (question=${input.questionId}, item=${input.itemId ?? '-'})`,
    );
    return { id: row.id, batchCustomId: row.batchCustomId };
  }

  /**
   * Drain PENDING entries into one Anthropic batch. Returns the
   * batch id when a dispatch fires; null when there's nothing to do
   * (under min batch size and oldest entry not stale enough). Force
   * is meant for the admin "force dispatch" button.
   */
  async dispatchPending(opts?: { force?: boolean }): Promise<{ batchId: string | null; dispatched: number }> {
    const minBatch = this.intEnv('ML_BATCH_MIN_BATCH_SIZE', 2);
    const maxBatch = this.intEnv('ML_BATCH_MAX_BATCH_SIZE', 50);
    const forceAgeMin = this.intEnv('ML_BATCH_FORCE_DISPATCH_AGE_MIN', 15);

    const pending = await this.prisma.mlBatchQueueEntry.findMany({
      where: { status: MlBatchEntryStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: maxBatch,
    });
    if (pending.length === 0) {
      return { batchId: null, dispatched: 0 };
    }
    if (!opts?.force && pending.length < minBatch) {
      const oldest = pending[0].createdAt.getTime();
      const ageMin = (Date.now() - oldest) / 60_000;
      if (ageMin < forceAgeMin) {
        this.logger.debug(
          `dispatch: ${pending.length} pending (under min ${minBatch}, oldest ${ageMin.toFixed(1)}min) — waiting`,
        );
        return { batchId: null, dispatched: 0 };
      }
      this.logger.log(
        `dispatch: ${pending.length} pending below min batch ${minBatch} but oldest ${ageMin.toFixed(1)}min ≥ ${forceAgeMin}min — dispatching anyway`,
      );
    }

    // Build per-entry compose inputs.
    const composeInputs = pending.map((entry) => {
      const history = (entry.conversationContext as any[] | null)?.map(
        (m: any) =>
          m.role === 'assistant'
            ? AIMessage.fromAssistant(String(m.content ?? ''))
            : AIMessage.fromUser(String(m.content ?? '')),
      ) ?? [];
      const conversation = new AIConversation(history);
      const turn: AITurnContext = {
        channel: Channel.MERCADOLIBRE,
        contactId: entry.contactId,
        customerName: entry.buyerNickname || null,
        isContinuation: history.some((m) => m.role === 'assistant'),
        isTestTraffic: false,
        // ML listing is left unresolved at dispatch time — the
        // composed system block stays anchored to the customer-
        // context + base prompt. Marcos's "listing context" guard
        // still fires on the SYNC fallback path if the batch yields
        // tool_use. (Trade: batched answers skip the live listing
        // re-fetch. Acceptable for routine Qs that don't need the
        // publication's exact specs.)
        mercadolibreListing: null,
      } as any;
      return {
        customId: entry.batchCustomId,
        conversation,
        newMessage: entry.questionText,
        turn,
      };
    });

    let batchId: string;
    try {
      const r = await this.claude.submitReplyBatch(composeInputs);
      batchId = r.batchId;
    } catch (err: any) {
      this.logger.error(`Batch dispatch failed: ${err.message}`);
      // Mark all attempted entries as FAILED so the operator can
      // re-trigger a sync fallback from the admin panel.
      await this.prisma.mlBatchQueueEntry.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: {
          status: MlBatchEntryStatus.FAILED,
          errorMessage: err.message?.slice(0, 500) ?? 'dispatch error',
        },
      });
      return { batchId: null, dispatched: 0 };
    }

    await this.prisma.mlBatchQueueEntry.updateMany({
      where: { id: { in: pending.map((p) => p.id) } },
      data: {
        status: MlBatchEntryStatus.DISPATCHED,
        batchId,
        dispatchedAt: new Date(),
      },
    });
    this.logger.log(
      `🚀 Dispatched ML batch ${batchId} (${pending.length} entries)`,
    );
    return { batchId, dispatched: pending.length };
  }

  /**
   * Poll every batch with at least one DISPATCHED entry; when a
   * batch has ended, drain its results and finalize each entry.
   */
  async pollAndFinalize(): Promise<{ polled: number; finalized: number }> {
    const dispatched = await this.prisma.mlBatchQueueEntry.findMany({
      where: { status: MlBatchEntryStatus.DISPATCHED, batchId: { not: null } },
      select: { batchId: true },
      distinct: ['batchId'],
    });
    if (dispatched.length === 0) return { polled: 0, finalized: 0 };

    let finalized = 0;
    for (const d of dispatched) {
      if (!d.batchId) continue;
      try {
        const { status } = await this.claude.retrieveBatchStatus(d.batchId);
        if (status === 'in_progress' || status === 'canceling') continue;
        const before = await this.prisma.mlBatchQueueEntry.count({
          where: { batchId: d.batchId, status: MlBatchEntryStatus.DISPATCHED },
        });
        await this.finalizeBatch(d.batchId);
        const after = await this.prisma.mlBatchQueueEntry.count({
          where: { batchId: d.batchId, status: MlBatchEntryStatus.DISPATCHED },
        });
        finalized += Math.max(0, before - after);
      } catch (err: any) {
        this.logger.error(`Poll batch ${d.batchId} failed: ${err.message}`);
      }
    }
    return { polled: dispatched.length, finalized };
  }

  /**
   * Walk the batch results once and finalize each DISPATCHED entry.
   * Text results → post-process + post to ML + save message.
   * Tool-use   → sync fallback via `continueConversation`.
   * Error     → mark FAILED with the upstream message.
   */
  async finalizeBatch(batchId: string): Promise<void> {
    const results = await this.claude.fetchBatchResults(batchId);
    const byCustomId = new Map(results.map((r) => [r.customId, r]));

    const entries = await this.prisma.mlBatchQueueEntry.findMany({
      where: { batchId, status: MlBatchEntryStatus.DISPATCHED },
    });
    for (const entry of entries) {
      const res = byCustomId.get(entry.batchCustomId);
      if (!res) {
        await this.prisma.mlBatchQueueEntry.update({
          where: { id: entry.id },
          data: {
            status: MlBatchEntryStatus.FAILED,
            errorMessage: 'no batch result for entry',
          },
        });
        continue;
      }

      try {
        if (res.kind === 'text' && res.text) {
          const turn = this.rebuildTurnForEntry(entry);
          const answer = this.claude.applyReplyPostProcessing(res.text, turn);
          await this.deliverAnswer(entry.id, entry.questionId, entry.conversationId, answer, MlBatchEntryStatus.ANSWERED);
          // Best-effort usage accounting for batch reply.
          if (res.rawMessage) {
            await this.claude.recordReplyUsage(res.rawMessage.model || 'claude-batch', res.rawMessage);
          }
        } else if (res.kind === 'tool_use') {
          // Sync fallback — the batch can't continue the tool loop.
          const turn = this.rebuildTurnForEntry(entry);
          const history = ((entry.conversationContext as any[]) || []).map(
            (m: any) =>
              m.role === 'assistant'
                ? AIMessage.fromAssistant(String(m.content ?? ''))
                : AIMessage.fromUser(String(m.content ?? '')),
          );
          const conversation = new AIConversation(history);
          try {
            const answer = await this.claude.continueConversation(
              conversation,
              entry.questionText,
              turn,
            );
            await this.deliverAnswer(entry.id, entry.questionId, entry.conversationId, answer, MlBatchEntryStatus.FALLBACK);
          } catch (err: any) {
            this.logger.error(`Tool-use fallback errored on ${entry.id}: ${err.message}`);
            await this.prisma.mlBatchQueueEntry.update({
              where: { id: entry.id },
              data: {
                status: MlBatchEntryStatus.FAILED,
                errorMessage: err.message?.slice(0, 500) ?? 'fallback error',
              },
            });
          }
        } else {
          await this.prisma.mlBatchQueueEntry.update({
            where: { id: entry.id },
            data: {
              status: MlBatchEntryStatus.FAILED,
              errorMessage: res.errorMessage?.slice(0, 500) ?? 'batch error',
            },
          });
        }
      } catch (err: any) {
        this.logger.error(`Finalize entry ${entry.id} failed: ${err.message}`);
        await this.prisma.mlBatchQueueEntry.update({
          where: { id: entry.id },
          data: {
            status: MlBatchEntryStatus.FAILED,
            errorMessage: err.message?.slice(0, 500) ?? 'finalize error',
          },
        });
      }
    }
  }

  /**
   * Post the agent reply to ML, persist the AI message to the
   * conversation, and update the queue entry. Best-effort: ML send
   * failure marks the entry FAILED but the AI message is still
   * saved so the operator sees what the AI would have said.
   */
  private async deliverAnswer(
    entryId: string,
    questionId: string,
    conversationId: string,
    answer: string,
    finalStatus: MlBatchEntryStatus,
  ): Promise<void> {
    if (!answer || answer.length === 0) {
      await this.prisma.mlBatchQueueEntry.update({
        where: { id: entryId },
        data: {
          status: MlBatchEntryStatus.FAILED,
          errorMessage: 'empty answer',
        },
      });
      return;
    }
    // Marcos 2026-06-11 (afternoon): the batch path was bypassing the
    // review-mode gate that the question-notification path respects —
    // so questions routed through the batcher were auto-sent to ML
    // without the operator's approval. Same gate applies here: if
    // ML_QA_REVIEW_MODE=true, persist the AI message with the
    // pendingReview flag (so the QA panel surfaces it) and STOP
    // before calling answerQuestion. The operator releases it from
    // the panel.
    // Marcos 2026-06-12: same runtime override as the question
    // webhook — the Configuration row `ml_qa_auto_reply_enabled`
    // beats the env. Best-effort; on DB failure we fall back to the
    // env to keep the gate engaged.
    let reviewMode =
      (process.env.ML_QA_REVIEW_MODE ?? 'true').toLowerCase() === 'true';
    try {
      const cfg = await this.prisma.configuration.findUnique({
        where: { key: 'ml_qa_auto_reply_enabled' },
        select: { value: true, isActive: true },
      });
      if (cfg && cfg.isActive) {
        const v = cfg.value as any;
        const autoReplyOn = v === true || v === 'true';
        reviewMode = !autoReplyOn;
      }
    } catch { /* fall through to env */ }
    // Marcos 2026-07-07: kill-switch global (mismo del webhook path).
    // Cuando ML_AUTO_SEND_DISABLED=true forzamos review — el batch
    // queue tampoco puede enviar directo a ML.
    if ((process.env.ML_AUTO_SEND_DISABLED ?? 'false').toLowerCase() === 'true') {
      reviewMode = true;
    }
    await this.prisma.message.create({
      data: {
        conversationId,
        sender: MessageSender.AI,
        content: getMessageCipher().encrypt(answer),
        isFromAI: true,
        ...(reviewMode
          ? { metadata: { pendingReview: true, mlQuestionId: questionId } as any }
          : {}),
      },
    });
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessage: getMessageCipher().encrypt(answer), lastMessageAt: new Date() },
    });
    if (reviewMode) {
      this.logger.log(
        `📝 ML batch ${entryId.slice(0, 8)} → draft pending review (ML_QA_REVIEW_MODE=true), question ${questionId}`,
      );
      await this.prisma.mlBatchQueueEntry.update({
        where: { id: entryId },
        data: { status: finalStatus, answer, answeredAt: new Date() },
      });
      return;
    }
    if (this.mercadolibre) {
      // Marcos 2026-06-12: same multi-cuenta bug the release flow had —
      // we need to send with the right cuenta's token. Pull
      // `mlAccountKey` off the conversation; default to cuenta 1.
      const conv = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { mlAccountKey: true },
      });
      const accountKey: 'mercadolibre' | 'mercadolibre_cuenta2' =
        conv?.mlAccountKey === 'mercadolibre_cuenta2' ? 'mercadolibre_cuenta2' : 'mercadolibre';
      const send = await this.mercadolibre.answerQuestion(questionId, answer, accountKey);
      if (!send.success) {
        await this.prisma.mlBatchQueueEntry.update({
          where: { id: entryId },
          data: {
            status: MlBatchEntryStatus.FAILED,
            answer,
            errorMessage: `ML send failed: ${send.error ?? 'unknown'}`,
          },
        });
        return;
      }
    } else {
      this.logger.warn(`MercadoLibreService unavailable — ${entryId} answer saved locally only`);
    }
    await this.prisma.mlBatchQueueEntry.update({
      where: { id: entryId },
      data: { status: finalStatus, answer, answeredAt: new Date() },
    });
    this.logger.log(
      `📨 ML batch entry ${entryId.slice(0, 8)} → ${finalStatus} (question ${questionId} answered)`,
    );
  }

  /**
   * Catch entries that have been PENDING longer than
   * ML_BATCH_MAX_AGE_MIN — route them through the sync fallback
   * path so a buyer never sits unanswered indefinitely if the
   * batch cadence stalls.
   */
  async fallbackStalePending(): Promise<{ rescued: number }> {
    const maxAgeMin = this.intEnv('ML_BATCH_MAX_AGE_MIN', 120);
    const cutoff = new Date(Date.now() - maxAgeMin * 60_000);
    const stale = await this.prisma.mlBatchQueueEntry.findMany({
      where: {
        status: MlBatchEntryStatus.PENDING,
        createdAt: { lt: cutoff },
      },
    });
    let rescued = 0;
    for (const entry of stale) {
      try {
        const turn = this.rebuildTurnForEntry(entry);
        const history = ((entry.conversationContext as any[]) || []).map(
          (m: any) =>
            m.role === 'assistant'
              ? AIMessage.fromAssistant(String(m.content ?? ''))
              : AIMessage.fromUser(String(m.content ?? '')),
        );
        const conversation = new AIConversation(history);
        const answer = await this.claude.continueConversation(
          conversation,
          entry.questionText,
          turn,
        );
        await this.deliverAnswer(
          entry.id,
          entry.questionId,
          entry.conversationId,
          answer,
          MlBatchEntryStatus.FALLBACK,
        );
        rescued++;
      } catch (err: any) {
        this.logger.error(`Stale-fallback for ${entry.id} errored: ${err.message}`);
        await this.prisma.mlBatchQueueEntry.update({
          where: { id: entry.id },
          data: {
            status: MlBatchEntryStatus.FAILED,
            errorMessage: err.message?.slice(0, 500) ?? 'stale fallback error',
          },
        });
      }
    }
    return { rescued };
  }

  async list(opts?: { status?: MlBatchEntryStatus; limit?: number }) {
    return this.prisma.mlBatchQueueEntry.findMany({
      where: opts?.status ? { status: opts.status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: opts?.limit && opts.limit > 0 ? opts.limit : 50,
    });
  }

  async counts(): Promise<Record<MlBatchEntryStatus, number>> {
    const rows = await this.prisma.mlBatchQueueEntry.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const out: Record<MlBatchEntryStatus, number> = {
      PENDING: 0,
      DISPATCHED: 0,
      ANSWERED: 0,
      FAILED: 0,
      FALLBACK: 0,
    };
    for (const r of rows) out[r.status as MlBatchEntryStatus] = r._count._all;
    return out;
  }

  private makeCustomId(): string {
    // ≤64 chars, lowercase hex, namespaced so we can grep server-
    // side logs. Plenty of entropy for batch correlation.
    const a = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    const b = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    return `mlbq_${Date.now().toString(36)}_${a}${b}`;
  }

  private rebuildTurnForEntry(entry: {
    contactId: string;
    buyerNickname: string | null;
  }): AITurnContext {
    return {
      channel: Channel.MERCADOLIBRE,
      contactId: entry.contactId,
      customerName: entry.buyerNickname || null,
      isContinuation: false,
      isTestTraffic: false,
      mercadolibreListing: null,
    } as any;
  }
}
