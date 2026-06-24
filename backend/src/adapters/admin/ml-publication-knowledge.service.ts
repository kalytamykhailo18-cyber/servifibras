/**
 * ADAPTERS LAYER — Per-publication Q&A knowledge ingestion + curation.
 *
 * Marcos 2026-06-24: Phase A de la arquitectura nueva. En lugar de
 * patchear cada respuesta caso por caso, alimentamos por publicación
 * el histórico de Q&A respondidas que ML ya devolvió en su momento.
 * El operador (o una pasada de IA — Phase B) las cura. Phase C: el
 * modo de respuesta cerrado lee SOLO de acá + la ficha de la
 * publicación para responder nuevas preguntas. Phase D: self-eval
 * ≥ 8.5 auto-envía.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { MercadoLibreService } from '../mercadolibre/mercadolibre.service';
import { MERCADOLIBRE_SERVICE } from '../../use-cases/mercadolibre/mercadolibre.token';

export interface IngestResult {
  itemId: string;
  accountKey: 'mercadolibre' | 'mercadolibre_cuenta2';
  fetched: number;
  inserted: number;
  skipped: number;
  errored: number;
  note?: string;
}

@Injectable()
export class MlPublicationKnowledgeService {
  private readonly logger = new Logger(MlPublicationKnowledgeService.name);
  private readonly prisma = new PrismaClient();

  constructor(
    @Optional()
    @Inject(MERCADOLIBRE_SERVICE)
    private readonly mercadolibre?: MercadoLibreService,
  ) {}

  /**
   * Ingiere el histórico de Q&A de una publicación. Idempotente — el
   * upsert por mlQuestionId evita duplicados en re-ingestas. Devuelve
   * conteos para que el operador vea cuánto entró.
   */
  async ingestForItem(args: {
    itemId: string;
    accountKey?: 'mercadolibre' | 'mercadolibre_cuenta2';
  }): Promise<IngestResult> {
    const accountKey = args.accountKey ?? 'mercadolibre';
    const result: IngestResult = {
      itemId: args.itemId,
      accountKey,
      fetched: 0,
      inserted: 0,
      skipped: 0,
      errored: 0,
    };
    if (!this.mercadolibre) {
      result.note = 'ML service not available in this runtime';
      return result;
    }
    const rows = await this.mercadolibre.fetchAnsweredQuestionsForItem(args.itemId, accountKey);
    result.fetched = rows.length;
    for (const q of rows) {
      try {
        // Upsert por mlQuestionId — re-ingestas no duplican, sólo
        // refrescan si el answer cambió del lado de ML.
        const existing = await this.prisma.mlPublicationKnowledge.findUnique({
          where: { mlQuestionId: q.id },
          select: { id: true, answerText: true },
        });
        if (existing) {
          // Refresh sólo el answerText si vino distinto; no tocamos
          // curationStatus / curatedAnswer (preservan el laburo del operador).
          if ((existing.answerText ?? null) !== (q.answerText ?? null)) {
            await this.prisma.mlPublicationKnowledge.update({
              where: { id: existing.id },
              data: { answerText: q.answerText, answeredAt: q.answeredAt },
            });
          }
          result.skipped++;
          continue;
        }
        await this.prisma.mlPublicationKnowledge.create({
          data: {
            itemId: args.itemId,
            accountKey,
            mlQuestionId: q.id,
            questionText: q.text,
            answerText: q.answerText,
            questionAt: q.dateCreated,
            answeredAt: q.answeredAt,
          },
        });
        result.inserted++;
      } catch (err: any) {
        this.logger.warn(`ingest row failed for q=${q.id}: ${err.message}`);
        result.errored++;
      }
    }
    this.logger.log(
      `Ingest ${args.itemId} (${accountKey}): fetched=${result.fetched} new=${result.inserted} skipped=${result.skipped} err=${result.errored}`,
    );
    return result;
  }

  /** Lista las Q&A de una publicación para el panel curador. */
  async listForItem(itemId: string): Promise<Array<{
    id: string;
    mlQuestionId: string;
    questionText: string;
    answerText: string | null;
    curatedAnswer: string | null;
    questionAt: Date;
    answeredAt: Date | null;
    curationStatus: string;
    stalenessFlag: string | null;
    aiValidityScore: number | null;
    aiNote: string | null;
    curatedAt: Date | null;
  }>> {
    const rows = await this.prisma.mlPublicationKnowledge.findMany({
      where: { itemId },
      orderBy: { questionAt: 'desc' },
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      mlQuestionId: r.mlQuestionId,
      questionText: r.questionText,
      answerText: r.answerText,
      curatedAnswer: r.curatedAnswer,
      questionAt: r.questionAt,
      answeredAt: r.answeredAt,
      curationStatus: r.curationStatus,
      stalenessFlag: r.stalenessFlag,
      aiValidityScore: r.aiValidityScore,
      aiNote: r.aiNote,
      curatedAt: r.curatedAt,
    }));
  }

  /** Resumen por publicación: counts por status. Útil para el dashboard. */
  async summary(): Promise<Array<{
    itemId: string;
    accountKey: string;
    total: number;
    pending: number;
    kept: number;
    edited: number;
    discarded: number;
  }>> {
    const rows = await this.prisma.mlPublicationKnowledge.groupBy({
      by: ['itemId', 'accountKey', 'curationStatus'],
      _count: { _all: true },
    });
    const byItem = new Map<string, {
      itemId: string;
      accountKey: string;
      total: number;
      pending: number;
      kept: number;
      edited: number;
      discarded: number;
    }>();
    for (const r of rows) {
      const key = `${r.itemId}__${r.accountKey}`;
      const e = byItem.get(key) ?? {
        itemId: r.itemId,
        accountKey: r.accountKey,
        total: 0,
        pending: 0,
        kept: 0,
        edited: 0,
        discarded: 0,
      };
      const n = r._count._all;
      e.total += n;
      if (r.curationStatus === 'pending') e.pending = n;
      if (r.curationStatus === 'kept') e.kept = n;
      if (r.curationStatus === 'edited') e.edited = n;
      if (r.curationStatus === 'discarded') e.discarded = n;
      byItem.set(key, e);
    }
    return Array.from(byItem.values()).sort((a, b) => b.pending - a.pending);
  }

  /**
   * Curación operativa. Actions:
   *   - 'keep'      → curationStatus='kept', preserva answerText original
   *   - 'edit'      → curationStatus='edited' + curatedAnswer = nuevo texto
   *   - 'discard'   → curationStatus='discarded' + stalenessFlag
   */
  async curate(args: {
    id: string;
    action: 'keep' | 'edit' | 'discard';
    curatedAnswer?: string;
    stalenessFlag?: string;
    userId?: string | null;
  }): Promise<{ ok: boolean; reason?: string }> {
    const row = await this.prisma.mlPublicationKnowledge.findUnique({
      where: { id: args.id },
      select: { id: true },
    });
    if (!row) return { ok: false, reason: 'Knowledge row not found' };
    const now = new Date();
    const data: any = {
      curationStatus:
        args.action === 'keep' ? 'kept' :
        args.action === 'edit' ? 'edited' : 'discarded',
      curatedAt: now,
      curatedById: args.userId ?? null,
    };
    if (args.action === 'edit') {
      const txt = (args.curatedAnswer ?? '').trim();
      if (!txt) return { ok: false, reason: 'curatedAnswer requerido para action=edit' };
      data.curatedAnswer = txt;
    }
    if (args.action === 'discard') {
      data.stalenessFlag = args.stalenessFlag ?? 'irrelevant';
    }
    await this.prisma.mlPublicationKnowledge.update({
      where: { id: args.id },
      data,
    });
    return { ok: true };
  }
}
