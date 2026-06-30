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
import Anthropic from '@anthropic-ai/sdk';
import type { MercadoLibreService } from '../mercadolibre/mercadolibre.service';
import { MERCADOLIBRE_SERVICE } from '../../use-cases/mercadolibre/mercadolibre.token';
import { ClaudeBudgetService } from '../ai/claude-budget.service';
import { ClaudeService } from '../ai/claude.service';

// Marcos 2026-06-24 (Phase C): kill switch para el modo cerrado.
// Default OFF mientras Marcos cura las publicaciones; flipea a true
// para activar en una cuenta de prueba o por env.
function isConstrainedEnabled(): boolean {
  const raw = process.env.ML_CONSTRAINED_REPLY_ENABLED;
  if (raw == null || raw.trim().length === 0) return false;
  return raw.trim().toLowerCase() === 'true';
}

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
    // Marcos 2026-06-25 (cost tracking): los calls del modo cerrado
    // (constrained reply + self-eval) y de Phase B (staleness pass)
    // hasta hoy no se registraban en claude_usage_events, así que el
    // dashboard de costos no veía el modo cerrado. Optional para no
    // romper tests / contextos standalone que crean el service sin
    // budget service.
    @Optional()
    private readonly budget?: ClaudeBudgetService,
    // Marcos 2026-06-30: el reply del modo cerrado se devolvía SIN
    // pasar por el strip pipeline de ClaudeService — los patrones
    // ask-back ("¿En qué te puedo ayudar?", "¿Estás preguntando si…?",
    // "Necesito un poco más de info para cotizarte…") que ya están
    // bloqueados en el camino regular se colaban al ML auto-send.
    // Inyectado optional para tests; cuando está wired aplicamos
    // applyReplyPostProcessing antes del self-eval + del return.
    @Optional()
    private readonly claude?: ClaudeService,
  ) {}

  /**
   * Ingiere el histórico de Q&A de una publicación. Idempotente — el
   * upsert por mlQuestionId evita duplicados en re-ingestas. Devuelve
   * conteos para que el operador vea cuánto entró.
   */
  /**
   * Marcos 2026-06-29: el ingest histórico era one-shot (ingestForItem
   * lo corre cuando el admin clickea). Las preguntas que el agente +
   * operador responden DESPUÉS del ingest inicial no estaban
   * apareciendo en /ml-conocimiento — el historial quedaba congelado
   * en lo que ML devolvió esa única vez. Este helper agrega la Q&A
   * a la knowledge table apenas la respuesta sale a ML (release del
   * draft o auto-send del modo cerrado). Idempotente vía mlQuestionId
   * único — si la fila ya existe por re-ingest manual previo, no se
   * duplica.
   *
   * curationStatus='kept' porque el operador la aprobó (en el caso
   * de release manual) o el self-eval pasó el umbral (en auto-send)
   * — el Phase D ya filtró calidad.
   */
  async appendAnsweredQuestion(args: {
    itemId: string;
    accountKey: 'mercadolibre' | 'mercadolibre_cuenta2';
    mlQuestionId: string;
    questionText: string;
    answerText: string;
    questionAt?: Date | null;
    answeredAt?: Date | null;
  }): Promise<{ created: boolean; reason?: string }> {
    if (!args.itemId || !args.mlQuestionId || !args.questionText?.trim() || !args.answerText?.trim()) {
      return { created: false, reason: 'missing required fields' };
    }
    try {
      const existing = await this.prisma.mlPublicationKnowledge.findUnique({
        where: { mlQuestionId: args.mlQuestionId },
        select: { id: true },
      });
      if (existing) return { created: false, reason: 'already exists' };
      const now = new Date();
      await this.prisma.mlPublicationKnowledge.create({
        data: {
          itemId: args.itemId,
          accountKey: args.accountKey,
          mlQuestionId: args.mlQuestionId,
          questionText: args.questionText.trim(),
          answerText: args.answerText.trim(),
          questionAt: args.questionAt ?? now,
          answeredAt: args.answeredAt ?? now,
          curationStatus: 'kept',
        },
      });
      this.logger.log(
        `appendAnsweredQuestion ${args.itemId} q=${args.mlQuestionId} ok (curated kept)`,
      );
      return { created: true };
    } catch (err: any) {
      this.logger.warn(`appendAnsweredQuestion ${args.mlQuestionId} failed: ${err.message}`);
      return { created: false, reason: err.message };
    }
  }

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

  /** Resumen por publicación: counts por status + estado de modo cerrado.
   *  Marcos 2026-06-24: agrega closedModeMode + closedModeReady para
   *  que el panel muestre quién está listo para responder solo. */
  async summary(): Promise<Array<{
    itemId: string;
    accountKey: string;
    total: number;
    pending: number;
    kept: number;
    edited: number;
    discarded: number;
    closedModeMode: 'auto' | 'always-draft' | 'always-send';
    /** True cuando la publicación cumple el threshold para que el modo
     *  cerrado se active en automatic (>= ML_CONSTRAINED_MIN_CURATED). */
    closedModeReady: boolean;
  }>> {
    const minRequired = (() => {
      const raw = Number(process.env.ML_CONSTRAINED_MIN_CURATED);
      return Number.isFinite(raw) && raw > 0 ? raw : 3;
    })();
    const [rows, settingsRows] = await Promise.all([
      this.prisma.mlPublicationKnowledge.groupBy({
        by: ['itemId', 'accountKey', 'curationStatus'],
        _count: { _all: true },
      }),
      this.prisma.mlPublicationSettings.findMany({
        select: { itemId: true, closedModeMode: true },
      }),
    ]);
    const settingsByItem = new Map<string, string>();
    for (const s of settingsRows) settingsByItem.set(s.itemId, s.closedModeMode);
    const byItem = new Map<string, {
      itemId: string;
      accountKey: string;
      total: number;
      pending: number;
      kept: number;
      edited: number;
      discarded: number;
      closedModeMode: 'auto' | 'always-draft' | 'always-send';
      closedModeReady: boolean;
    }>();
    for (const r of rows) {
      const key = `${r.itemId}__${r.accountKey}`;
      const mode = settingsByItem.get(r.itemId) ?? 'auto';
      const e = byItem.get(key) ?? {
        itemId: r.itemId,
        accountKey: r.accountKey,
        total: 0,
        pending: 0,
        kept: 0,
        edited: 0,
        discarded: 0,
        closedModeMode: (mode === 'always-draft' || mode === 'always-send' ? mode : 'auto') as 'auto' | 'always-draft' | 'always-send',
        closedModeReady: false,
      };
      const n = r._count._all;
      e.total += n;
      if (r.curationStatus === 'pending') e.pending = n;
      if (r.curationStatus === 'kept') e.kept = n;
      if (r.curationStatus === 'edited') e.edited = n;
      if (r.curationStatus === 'discarded') e.discarded = n;
      // Ready cuando hay >= minRequired curadas (kept + edited).
      e.closedModeReady = (e.kept + e.edited) >= minRequired;
      byItem.set(key, e);
    }
    return Array.from(byItem.values()).sort((a, b) => b.pending - a.pending);
  }

  /**
   * Marcos 2026-06-24 (Phase B): pasada de IA que evalúa cada Q&A
   * pendiente contra la ficha ACTUAL de la publicación. Por cada fila
   * mete un score 0..1 (1 = sigue válida, 0 = totalmente desactualizada)
   * y una nota corta. NO modifica curationStatus — la decisión final
   * sigue siendo del operador. El score sirve para que el panel ordene
   * primero las dudosas (score bajo) y el operador foque ahí.
   *
   * Modelo: Haiku — barato y suficiente para una clasificación binaria
   * con justificación corta.
   */
  async aiStalenessPassForItem(args: {
    itemId: string;
    limit?: number;
  }): Promise<{
    itemId: string;
    processed: number;
    skipped: number;
    errored: number;
    flagged: number;
    note?: string;
  }> {
    const result = {
      itemId: args.itemId,
      processed: 0,
      skipped: 0,
      errored: 0,
      flagged: 0,
      note: undefined as string | undefined,
    };
    // Marcos 2026-06-24: el proyecto usa CLAUDE_API_KEY (con
    // ANTHROPIC_API_KEY como fallback por si el operador heredó el
    // estándar del SDK).
    const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      result.note = 'CLAUDE_API_KEY no configurada';
      return result;
    }
    if (!this.mercadolibre) {
      result.note = 'ML service no disponible';
      return result;
    }
    // Ficha actual de la publicación: título + precio + atributos + descripción.
    const listing = await this.mercadolibre.fetchListingDetails(args.itemId).catch(() => null);
    if (!listing) {
      result.note = 'No se pudo obtener la ficha de la publicación';
      return result;
    }
    const pendingRows = await this.prisma.mlPublicationKnowledge.findMany({
      where: { itemId: args.itemId, curationStatus: 'pending', aiValidityScore: null },
      orderBy: { questionAt: 'desc' },
      take: Math.max(1, Math.min(200, args.limit ?? 100)),
      select: { id: true, questionText: true, answerText: true, questionAt: true },
    });
    if (pendingRows.length === 0) {
      result.note = 'No hay filas pendientes sin scorear';
      return result;
    }
    const client = new Anthropic({ apiKey });
    const model = process.env.ML_KNOWLEDGE_AI_PASS_MODEL || 'claude-haiku-4-5-20251001';
    // Bloque común con la ficha — se repite en cada turno pero el
    // contenido es estable y cachea bien.
    const fichaBlock = this.buildListingFichaBlock(listing);
    for (const row of pendingRows) {
      try {
        const prompt = [
          'Sos un evaluador de Q&A histórica de Mercado Libre para Servifibras. Tu tarea: decidir si una pregunta + respuesta histórica sobre una publicación SIGUE SIENDO VÁLIDA hoy.',
          '',
          'Devolvé EXCLUSIVAMENTE un JSON así (sin texto antes ni después):',
          '{ "score": 0.0-1.0, "note": "una oración corta justificando" }',
          '',
          'Criterio:',
          '- 1.0 = la respuesta sigue siendo correcta y aplicable hoy (precio, atributos, presentación, todo coincide con la ficha actual).',
          '- 0.5 = parcialmente desactualizada (algún detalle cambió pero la idea general aplica).',
          '- 0.0 = totalmente desactualizada o contradice la ficha actual.',
          '',
          'FICHA ACTUAL DE LA PUBLICACIÓN:',
          fichaBlock,
          '',
          'PREGUNTA HISTÓRICA (' + new Date(row.questionAt).toISOString().slice(0, 10) + '):',
          row.questionText,
          '',
          'RESPUESTA HISTÓRICA:',
          row.answerText ?? '(sin respuesta)',
        ].join('\n');
        const resp = await client.messages.create({
          model,
          max_tokens: 200,
          temperature: 0,
          messages: [{ role: 'user', content: prompt }],
        });
        await this.budget?.recordUsage('ml_staleness_pass', model, resp as any).catch(() => {});
        const text = resp.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('')
          .trim();
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) { result.errored++; continue; }
        const parsed = JSON.parse(m[0]);
        const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(1, parsed.score)) : null;
        const note = typeof parsed.note === 'string' ? parsed.note.slice(0, 500) : null;
        if (score == null) { result.errored++; continue; }
        await this.prisma.mlPublicationKnowledge.update({
          where: { id: row.id },
          data: { aiValidityScore: score, aiNote: note },
        });
        result.processed++;
        if (score < 0.7) result.flagged++;
      } catch (err: any) {
        this.logger.warn(`AI staleness row ${row.id} failed: ${err.message}`);
        result.errored++;
      }
    }
    this.logger.log(`AI staleness pass ${args.itemId}: processed=${result.processed} flagged=${result.flagged} err=${result.errored}`);
    return result;
  }

  /**
   * Marcos 2026-06-24 (Phase D — auto-score). Segunda llamada a Haiku
   * (cheap, ~100 tokens) que evalúa la respuesta recién generada
   * según: directness al pregunta yes/no, fidelidad a la ficha (no
   * inventa precios/atributos/stock), tono natural sin cierres
   * formales, y si fallback fue honesto cuando no había info. Devuelve
   * score 0..10. El caller compara contra ML_CONSTRAINED_AUTOSEND_THRESHOLD
   * (default 8.5) para decidir auto-send vs review.
   */
  private async selfEvalReply(args: {
    ficha: string;
    qaBlock: string;
    buyerQuestion: string;
    reply: string;
    client: Anthropic;
    model: string;
  }): Promise<{ score: number; reason?: string }> {
    try {
      // System block estable por publicación → CACHEABLE. La pregunta+respuesta
      // del turno van en user block. Mismo cache hit en turnos seguidos.
      const evalSystem = [
        'Sos un evaluador de calidad de respuestas de Mercado Libre para Servifibras. Por cada turno te paso una pregunta del comprador + la respuesta que el agente generó. Calificás de 0 a 10 según:',
        '- Directness (si la pregunta era yes/no o de elección, la primera oración tiene que ser la respuesta directa)',
        '- Fidelidad: NO inventa precios, atributos, stock, links ni info que no está en la ficha ni en las Q&A',
        '- Tono natural sin cierres de oficina ("Quedo a disposición", "Atentamente", etc)',
        '- Si no podía responder con info de arriba, dijo honestamente "le paso al equipo" en vez de inventar',
        '- Coherencia interna y largo razonable',
        '',
        'Devolvé EXCLUSIVAMENTE JSON: { "score": 0.0-10.0, "reason": "una oración corta" }',
        '',
        'CONTEXTO DE LA PUBLICACIÓN (constante):',
        '',
        'FICHA:',
        args.ficha,
        '',
        'Q&A VALIDADAS:',
        args.qaBlock,
      ].join('\n');
      const evalUser = [
        'PREGUNTA DEL COMPRADOR:',
        args.buyerQuestion,
        '',
        'RESPUESTA A EVALUAR:',
        args.reply,
      ].join('\n');
      const resp = await args.client.messages.create({
        model: args.model,
        max_tokens: 150,
        temperature: 0,
        system: [
          { type: 'text', text: evalSystem, cache_control: { type: 'ephemeral' } },
        ] as any,
        messages: [{ role: 'user', content: evalUser }],
      });
      await this.budget?.recordUsage('ml_constrained_selfeval', args.model, resp as any).catch(() => {});
      const text = resp.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('')
        .trim();
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return { score: 0, reason: 'parse failed' };
      const parsed = JSON.parse(m[0]);
      const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(10, parsed.score)) : 0;
      const reason = typeof parsed.reason === 'string' ? parsed.reason.slice(0, 300) : undefined;
      return { score, reason };
    } catch (err: any) {
      this.logger.warn(`selfEvalReply failed: ${err.message}`);
      // Fail closed — score 0 means we never auto-send on eval errors.
      return { score: 0, reason: `error: ${err.message}` };
    }
  }

  private buildListingFichaBlock(listing: any): string {
    const parts: string[] = [];
    if (listing.title) parts.push(`Título: ${listing.title}`);
    if (listing.price != null) parts.push(`Precio actual: ${listing.currencyId ?? 'ARS'} ${listing.price}`);
    if (listing.availableQuantity != null) parts.push(`Stock disponible: ${listing.availableQuantity}`);
    if (listing.status) parts.push(`Estado: ${listing.status}`);
    if (Array.isArray(listing.attributes) && listing.attributes.length > 0) {
      const attrs = listing.attributes.slice(0, 30).map((a: any) => `  - ${a.name ?? a.id}: ${a.value_name ?? a.value ?? ''}`).join('\n');
      parts.push(`Atributos:\n${attrs}`);
    }
    if (listing.description) {
      parts.push(`Descripción: ${String(listing.description).slice(0, 1500)}`);
    }
    return parts.join('\n');
  }

  /**
   * Marcos 2026-06-24 (Phase C): MODO CERRADO DE RESPUESTA.
   *
   * Cuando llega una pregunta nueva en una publicación que tiene
   * suficientes Q&A curadas, en lugar de pasar por el agente con tools
   * + RAG abierto, armamos un prompt mínimo:
   *   - Ficha actual de la publicación (titulo + precio + atributos + descripción).
   *   - Las Q&A curadas (kept + edited) ya validadas por el equipo.
   *   - Reglas duras: SOLO responder con info de arriba; si no se
   *     cubre, devolver "le paso al equipo".
   * Y lo corremos con Haiku. Sin tool calls, sin historial, sin
   * fabricación. El resultado es la respuesta cerrada, o null si el
   * modelo dijo que no podía responder (el caller hace fallback).
   *
   * Threshold de readiness: la publicación necesita >= N Q&A curadas
   * (default 3; configurable via ML_CONSTRAINED_MIN_CURATED). Si tiene
   * menos, devolvemos null inmediatamente para que el caller use el
   * pipeline regular.
   */
  async tryConstrainedReply(args: {
    itemId: string;
    buyerQuestion: string;
    buyerNickname?: string | null;
    /** Listing ya fetched por el caller — evita doble round trip a ML. */
    listing?: any;
    /**
     * Marcos 2026-06-25 (sandbox "probar respuesta"): bypass del kill
     * switch ML_CONSTRAINED_REPLY_ENABLED. Permite probar el modo
     * cerrado desde el panel de curación aunque esté off en prod.
     * NUNCA usar desde el pipeline real — solo desde el endpoint de
     * test. Default false preserva el behavior productivo.
     */
    ignoreEnabledFlag?: boolean;
  }): Promise<{
    reply: string | null;
    usedConstrained: boolean;
    reason: string;
    curatedRowsUsed?: number;
    /**
     * Marcos 2026-06-24 (Phase D): self-eval score 0..10 que la IA
     * misma se asigna sobre su propia respuesta (directness, fidelidad
     * a la ficha, no-inventos, fallback honesto). El umbral
     * ML_CONSTRAINED_AUTOSEND_THRESHOLD (default 8.5) decide si el
     * caller debe auto-enviarla a ML o dejarla como pendingReview.
     */
    selfEvalScore?: number;
    /** Recomendación derivada del score: 'auto-send' | 'review'. */
    autoSendAllowed?: boolean;
  }> {
    if (!args.ignoreEnabledFlag && !isConstrainedEnabled()) {
      return { reply: null, usedConstrained: false, reason: 'feature flag off' };
    }
    const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { reply: null, usedConstrained: false, reason: 'no API key' };

    // Cargar Q&A curadas (kept + edited). discarded y pending se ignoran.
    const curated = await this.prisma.mlPublicationKnowledge.findMany({
      where: {
        itemId: args.itemId,
        curationStatus: { in: ['kept', 'edited'] },
      },
      orderBy: { questionAt: 'desc' },
      take: 50,
      select: {
        questionText: true,
        answerText: true,
        curatedAnswer: true,
      },
    });
    const minRequired = (() => {
      const raw = Number(process.env.ML_CONSTRAINED_MIN_CURATED);
      return Number.isFinite(raw) && raw > 0 ? raw : 3;
    })();
    if (curated.length < minRequired) {
      return {
        reply: null,
        usedConstrained: false,
        reason: `curated=${curated.length} < min=${minRequired}`,
      };
    }
    // Marcos 2026-06-24: per-publication override del modo cerrado.
    // 'always-draft' = nunca auto-envía aunque self-eval pase. Devolvemos
    // la reply pero con autoSendAllowed=false forzado.
    const settings = await this.prisma.mlPublicationSettings.findUnique({
      where: { itemId: args.itemId },
      select: { closedModeMode: true },
    });
    const closedMode = settings?.closedModeMode ?? 'auto';
    // Ficha actual — el caller puede pasarla pre-fetched (común en el
    // pipeline ML porque mlListing ya se cargó).
    const listing = args.listing
      ?? (this.mercadolibre ? await this.mercadolibre.fetchListingDetails(args.itemId).catch(() => null) : null);
    if (!listing) {
      return { reply: null, usedConstrained: false, reason: 'no listing context' };
    }

    const fichaBlock = this.buildListingFichaBlock(listing);
    const qaBlock = curated.map((c, i) => {
      const answer = c.curatedAnswer ?? c.answerText ?? '';
      return `${i + 1}. P: ${c.questionText}\n   R: ${answer}`;
    }).join('\n\n');
    const nickname = (args.buyerNickname ?? '').trim() || 'comprador';
    const FALLBACK = `Hola ${nickname}, le paso esta consulta al equipo y te respondemos en breve. Gracias por la paciencia.`;

    // Marcos 2026-06-24: split en system (ficha + Q&A — estable por
    // publicación, CACHEABLE) + user (pregunta del comprador). Anthropic
    // cache lifetime ~5min — turnos 2-N en la misma publicación leen
    // del cache al 10% del precio normal. En una publicación caliente
    // con preguntas seguidas el ahorro real es ~50% del costo de input.
    const systemBlock = [
      'Sos un asistente de Mercado Libre para Servifibras. Respondés SOLO con información que está abajo. NO podés improvisar, inventar precios, atributos, stock, links ni nada que no esté literalmente acá.',
      '',
      'FICHA ACTUAL DE LA PUBLICACIÓN:',
      fichaBlock,
      '',
      'PREGUNTAS Y RESPUESTAS YA VALIDADAS POR EL EQUIPO PARA ESTA PUBLICACIÓN:',
      qaBlock,
      '',
      'REGLAS GENERALES:',
      '- No uses cierre formal ("Quedo a disposición", "Atentamente", "Cordialmente"); si querés cerrar, usá "Saludos."',
      '- Si la pregunta nueva ya está cubierta arriba (o muy parecida), respondé reutilizando esa respuesta validada — adaptala al apodo del comprador si hace falta.',
      '- Si la pregunta NO está cubierta pero se contesta directo desde la ficha, respondé citando ESTRICTAMENTE la ficha.',
      '- Si NO se puede responder con info de arriba, devolvé EXACTAMENTE: "Hola {nick}, le paso esta consulta al equipo y te respondemos en breve. Gracias por la paciencia." (reemplazando {nick} por el apodo)',
      '- Máximo 80 palabras salvo que la pregunta requiera más.',
      '- Si la pregunta es yes/no o de elección, primera oración es la respuesta directa (sí/no/cuál).',
    ].join('\n');
    const userBlock = [
      `Apodo del comprador: ${nickname} (empezá la respuesta con "Hola ${nickname},")`,
      '',
      'PREGUNTA NUEVA:',
      args.buyerQuestion,
    ].join('\n');

    const client = new Anthropic({ apiKey });
    const model = process.env.ML_CONSTRAINED_MODEL || 'claude-haiku-4-5-20251001';
    try {
      // Marcos 2026-06-25: bumped de 350 a 800 — Marcos reportó casos
      // donde la respuesta se cortaba al final ("sigue cortando la
      // respuesta al final"). Con cap más alto el agente igual respeta
      // las "80 palabras salvo que requiera más" del prompt en casos
      // normales, pero para preguntas que requieren detalle (rinde por
      // ml + por mm + por presentación) tiene headroom.
      const maxOutputTokens = (() => {
        const raw = Number(process.env.ML_CONSTRAINED_MAX_TOKENS);
        return Number.isFinite(raw) && raw > 0 ? raw : 800;
      })();
      const resp = await client.messages.create({
        model,
        max_tokens: maxOutputTokens,
        temperature: 0,
        // cache_control marca el system block para Anthropic cache.
        // Mismo block en turnos siguientes de la misma publicación se
        // sirve del cache al 10% del precio normal.
        system: [
          {
            type: 'text',
            text: systemBlock,
            cache_control: { type: 'ephemeral' },
          },
        ] as any,
        messages: [{ role: 'user', content: userBlock }],
      });
      // Marcos 2026-06-25 (cost tracking): registramos el call en
      // claude_usage_events con callSite distinto del pipeline normal
      // para que el dashboard pueda mostrar el costo del modo cerrado
      // por separado y demostrar el ahorro vs respuesta abierta.
      // isTestTraffic=true cuando se invoca desde el sandbox.
      await this.budget?.recordUsage('ml_constrained_reply', model, resp as any, {
        errored: false,
        isTestTraffic: args.ignoreEnabledFlag === true,
      }).catch(() => {});
      // Marcos 2026-06-25: alerta cuando la respuesta toca el cap —
      // sirve para subir ML_CONSTRAINED_MAX_TOKENS si vemos pattern.
      if ((resp as any)?.stop_reason === 'max_tokens') {
        this.logger.warn(
          `Constrained reply HIT MAX_TOKENS for ${args.itemId} (cap=${maxOutputTokens}). Considera subir ML_CONSTRAINED_MAX_TOKENS si esto pasa seguido.`,
        );
      }
      const rawText = resp.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('')
        .trim();
      if (!rawText) {
        return { reply: null, usedConstrained: false, reason: 'empty response' };
      }
      // Marcos 2026-06-30: aplicamos el strip pipeline del camino
      // regular antes del self-eval. Patrones ask-back que el
      // pipeline regular ya bloqueaba ("¿En qué te puedo ayudar?",
      // "¿Estás preguntando si…?", "Necesito un poco más de info
      // para cotizarte…") venían colándose al ML auto-send porque
      // el modo cerrado devolvía rawText directo. Channel ML forzado
      // — el modo cerrado solo se usa para pre-venta ML.
      const text = this.claude
        ? this.claude.applyReplyPostProcessing(rawText, {
            channel: 'MERCADOLIBRE' as any,
            mlItemId: args.itemId,
          } as any)
        : rawText;
      if (!text || !text.trim()) {
        return { reply: null, usedConstrained: false, reason: 'empty after sanitize' };
      }
      // Si la respuesta es exactamente el fallback, devolvemos null
      // para que el caller decida (puede dejarla para revisión humana
      // o caer al pipeline regular).
      if (text.includes(FALLBACK) || text.includes('le paso esta consulta al equipo')) {
        this.logger.log(
          `Constrained reply ${args.itemId}: model declined (fallback emitted), ${curated.length} curated rows available`,
        );
        return { reply: null, usedConstrained: false, reason: 'model declined', curatedRowsUsed: curated.length };
      }
      // Marcos 2026-06-24 (Phase D): self-eval del reply.
      // 'always-send' override: skip self-eval, autoSendAllowed=true.
      // 'always-draft' override: skip self-eval, autoSendAllowed=false.
      let selfEval: { score: number; reason?: string };
      let autoSendAllowed: boolean;
      if (closedMode === 'always-send') {
        selfEval = { score: 10, reason: 'override always-send' };
        autoSendAllowed = true;
      } else if (closedMode === 'always-draft') {
        selfEval = { score: 0, reason: 'override always-draft' };
        autoSendAllowed = false;
      } else {
        selfEval = await this.selfEvalReply({
          ficha: fichaBlock,
          qaBlock,
          buyerQuestion: args.buyerQuestion,
          reply: text,
          client,
          model,
        });
        const threshold = (() => {
          const raw = Number(process.env.ML_CONSTRAINED_AUTOSEND_THRESHOLD);
          return Number.isFinite(raw) && raw > 0 && raw <= 10 ? raw : 8.5;
        })();
        autoSendAllowed = selfEval.score >= threshold;
      }
      this.logger.log(
        `Constrained reply ${args.itemId}: OK (${text.length} chars, ${curated.length} curated rows, self-eval=${selfEval.score.toFixed(1)}, autoSend=${autoSendAllowed})`,
      );
      return {
        reply: text,
        usedConstrained: true,
        reason: 'ok',
        curatedRowsUsed: curated.length,
        selfEvalScore: selfEval.score,
        autoSendAllowed,
      };
    } catch (err: any) {
      this.logger.warn(`Constrained reply ${args.itemId} failed: ${err.message}`);
      return { reply: null, usedConstrained: false, reason: `error: ${err.message}` };
    }
  }

  /**
   * Marcos 2026-06-24 (curation accelerator): auto-mark como 'kept'
   * todas las filas pending de la publicación que tengan
   * aiValidityScore >= threshold (default 0.7). Marcos las puede
   * desmarcar / editar después si encuentra alguna mal validada.
   * Acelera la curación masiva sin perder control humano.
   */
  async autoKeepHighScore(args: {
    itemId: string;
    minScore?: number;
    userId?: string | null;
  }): Promise<{ keptCount: number }> {
    const min = typeof args.minScore === 'number' && args.minScore > 0 && args.minScore <= 1
      ? args.minScore
      : 0.7;
    const r = await this.prisma.mlPublicationKnowledge.updateMany({
      where: {
        itemId: args.itemId,
        curationStatus: 'pending',
        aiValidityScore: { gte: min },
      },
      data: {
        curationStatus: 'kept',
        curatedAt: new Date(),
        curatedById: args.userId ?? null,
      },
    });
    this.logger.log(`autoKeepHighScore ${args.itemId}: ${r.count} rows kept (min score ${min})`);
    return { keptCount: r.count };
  }

  /**
   * Marcos 2026-06-24: ingesta de TODO el catálogo activo. Llama a
   * mercadolibre.listAllActiveItemIds para descubrir las publicaciones
   * activas de la(s) cuenta(s), después ingiere cada una. Devuelve
   * totales agregados. Si el ML service no está disponible, devuelve
   * un resultado vacío con note.
   */
  async ingestAllCatalog(args: {
    accountKey?: 'mercadolibre' | 'mercadolibre_cuenta2' | 'both';
  } = {}): Promise<{
    totals: { items: number; fetched: number; inserted: number; skipped: number; errored: number };
    note?: string;
  }> {
    if (!this.mercadolibre) {
      return {
        totals: { items: 0, fetched: 0, inserted: 0, skipped: 0, errored: 0 },
        note: 'ML service not available',
      };
    }
    const items = await this.mercadolibre.listAllActiveItemIds({
      accountKey: args.accountKey ?? 'both',
    });
    if (items.length === 0) {
      return {
        totals: { items: 0, fetched: 0, inserted: 0, skipped: 0, errored: 0 },
        note: 'no active items found',
      };
    }
    const totals = { items: items.length, fetched: 0, inserted: 0, skipped: 0, errored: 0 };
    for (const it of items) {
      try {
        const r = await this.ingestForItem({ itemId: it.itemId, accountKey: it.accountKey });
        totals.fetched += r.fetched;
        totals.inserted += r.inserted;
        totals.skipped += r.skipped;
        totals.errored += r.errored;
      } catch (err: any) {
        totals.errored++;
        this.logger.warn(`ingest-all-catalog row ${it.itemId} failed: ${err.message}`);
      }
    }
    this.logger.log(
      `ingest-all-catalog DONE: items=${totals.items} new=${totals.inserted} skipped=${totals.skipped} err=${totals.errored}`,
    );
    return { totals };
  }

  /**
   * Marcos 2026-06-24: set/unset el closedModeMode de una publicación.
   * 'auto' | 'always-draft' | 'always-send'.
   */
  async setClosedModeMode(args: {
    itemId: string;
    mode: 'auto' | 'always-draft' | 'always-send';
    userId?: string | null;
  }): Promise<{ ok: boolean }> {
    if (!['auto', 'always-draft', 'always-send'].includes(args.mode)) {
      return { ok: false };
    }
    await this.prisma.mlPublicationSettings.upsert({
      where: { itemId: args.itemId },
      create: { itemId: args.itemId, closedModeMode: args.mode, updatedById: args.userId ?? null },
      update: { closedModeMode: args.mode, updatedById: args.userId ?? null },
    });
    return { ok: true };
  }

  /** Mode actual de una publicación (para el panel). */
  async getClosedModeMode(itemId: string): Promise<'auto' | 'always-draft' | 'always-send'> {
    const s = await this.prisma.mlPublicationSettings.findUnique({
      where: { itemId },
      select: { closedModeMode: true },
    });
    const v = s?.closedModeMode ?? 'auto';
    return (v === 'always-draft' || v === 'always-send') ? v : 'auto';
  }

  /**
   * Marcos 2026-06-25 (Phase D widget): agrega métricas del modo
   * cerrado para el dashboard. Consulta `messages.metadata` filtrando
   * por `constrainedSelfEvalScore` (lo stampean tanto la rama draft
   * como la auto-sent — Phase D).
   *
   *   - total constrained replies en los últimos `days` días
   *   - split auto-sent vs draft
   *   - distribución del self-eval en buckets para histograma
   *   - top 5 publicaciones por uso del modo cerrado
   *
   * El umbral 8.5 viene de ML_CONSTRAINED_AUTOSEND_THRESHOLD para
   * que el bucket coincida con la línea real de auto-envío.
   */
  async closedModeStats(args: { days?: number } = {}): Promise<{
    windowDays: number;
    total: number;
    autoSent: number;
    drafted: number;
    avgScore: number | null;
    autoSendThreshold: number;
    buckets: Array<{ label: string; min: number; max: number; count: number }>;
    topPublications: Array<{ itemId: string; count: number; avgScore: number }>;
  }> {
    const windowDays = (() => {
      const n = Number(args.days);
      return Number.isFinite(n) && n > 0 && n <= 365 ? Math.floor(n) : 30;
    })();
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const threshold = (() => {
      const raw = Number(process.env.ML_CONSTRAINED_AUTOSEND_THRESHOLD);
      return Number.isFinite(raw) && raw > 0 && raw <= 10 ? raw : 8.5;
    })();
    const rows = await this.prisma.message.findMany({
      where: {
        isFromAI: true,
        timestamp: { gte: since },
        metadata: { path: ['constrainedSelfEvalScore'], not: undefined } as any,
      },
      select: { metadata: true, timestamp: true },
      take: 5000,
    });
    let total = 0;
    let autoSent = 0;
    let drafted = 0;
    let scoreSum = 0;
    const itemAgg = new Map<string, { count: number; scoreSum: number }>();
    const buckets = [
      { label: '< 6', min: 0, max: 6, count: 0 },
      { label: '6–7', min: 6, max: 7, count: 0 },
      { label: '7–8', min: 7, max: 8, count: 0 },
      { label: `8–${threshold.toFixed(1)}`, min: 8, max: threshold, count: 0 },
      { label: `${threshold.toFixed(1)}–9`, min: threshold, max: 9, count: 0 },
      { label: '9–10', min: 9, max: 10, count: 0 },
    ];
    for (const r of rows) {
      const md = (r.metadata as Record<string, unknown> | null) ?? {};
      const score = typeof md.constrainedSelfEvalScore === 'number'
        ? (md.constrainedSelfEvalScore as number)
        : null;
      if (score === null) continue;
      total++;
      scoreSum += score;
      const isAutoSent = md.constrainedAutoSent === true;
      const isDraft = md.pendingReview === true;
      if (isAutoSent) autoSent++;
      if (isDraft) drafted++;
      for (const b of buckets) {
        if (score >= b.min && score < b.max + (b.max === 10 ? 0.001 : 0)) {
          b.count++;
          break;
        }
      }
      const itemId = typeof md.mlItemId === 'string' ? md.mlItemId : null;
      if (itemId) {
        const cur = itemAgg.get(itemId) ?? { count: 0, scoreSum: 0 };
        cur.count++;
        cur.scoreSum += score;
        itemAgg.set(itemId, cur);
      }
    }
    const topPublications = Array.from(itemAgg.entries())
      .map(([itemId, agg]) => ({
        itemId,
        count: agg.count,
        avgScore: agg.count > 0 ? Number((agg.scoreSum / agg.count).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    return {
      windowDays,
      total,
      autoSent,
      drafted,
      avgScore: total > 0 ? Number((scoreSum / total).toFixed(2)) : null,
      autoSendThreshold: threshold,
      buckets,
      topPublications,
    };
  }

  /** Cuántas Q&A curadas tiene cada publicación — útil para que el panel
   *  muestre el badge "lista para modo cerrado". */
  async countCuratedByItem(): Promise<Record<string, number>> {
    const rows = await this.prisma.mlPublicationKnowledge.groupBy({
      by: ['itemId'],
      where: { curationStatus: { in: ['kept', 'edited'] } },
      _count: { _all: true },
    });
    const out: Record<string, number> = {};
    for (const r of rows) out[r.itemId] = r._count._all;
    return out;
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
