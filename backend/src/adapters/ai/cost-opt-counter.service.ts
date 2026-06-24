/**
 * ADAPTERS LAYER — Bloque E visibility counter.
 *
 * Marcos 2026-06-24: cada vez que un shortcut "skip Claude" del Bloque
 * E dispara (FAQ pre-IA, publication-FAQ, product-lookup,
 * history-compression, ML shortcut), grabamos un evento en
 * cost_opt_events. El widget de Uso de IA suma estos events para
 * mostrar cuántos turnos NO fueron enviados a Claude este mes y
 * cuántos tokens se estima haber ahorrado.
 *
 * Diseño:
 *   - Fire-and-forget: nunca bloquea el flujo del operador. Si
 *     Postgres se cae, el shortcut sigue funcionando y el evento se
 *     pierde silencioso. Mejor perder una métrica que romper un reply.
 *   - Promedios conservadores por source. Sin pretender precisión
 *     exacta — la idea es darle a Marcos un orden de magnitud que
 *     justifique la inversión del Bloque E.
 *   - Sin caché in-memory: la tabla es liviana (un row por shortcut
 *     fired), Postgres puede absorberlo de sobra.
 *
 * Sources:
 *   faq-preai            — FaqPreAiService (intents horarios/dirección/etc)
 *   publication-faq      — PublicationFaqService (FAQs por publicación ML)
 *   product-lookup       — ProductLookupShortcutService (stock-intent)
 *   history-compression  — HistoryCompressionService (resumen + tail)
 *   ml-shortcut          — cualquier otro skip-Claude desde el ML handler
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export type CostOptSource =
  | 'faq-preai'
  | 'publication-faq'
  | 'product-lookup'
  | 'history-compression'
  | 'ml-shortcut';

/**
 * Promedio conservador de tokens INPUT que se hubieran enviado a
 * Claude si no hubiera disparado el shortcut. Sale del promedio
 * real observado en claude_usage_events ~ 30K tokens/turno. Por
 * defecto descontamos el 25% para ser conservadores en la cuenta de
 * "ahorro" que mostramos al cliente — preferimos quedarnos cortos.
 *
 * Sources que respondan SIN Claude entero (FAQ, publication-FAQ,
 * product-lookup, ml-shortcut) ahorran todo el turno. La compresión
 * de historia ahorra solo la porción comprimida — usamos un valor
 * menor para no inflar.
 */
const SAVED_TOKENS_BY_SOURCE: Record<CostOptSource, number> = {
  'faq-preai':           22_000,
  'publication-faq':     22_000,
  'product-lookup':      22_000,
  'ml-shortcut':         22_000,
  // Compresión NO ahorra el turno entero — solo el porte de history
  // re-enviado. Estimación conservadora: ~6K tokens promedio.
  'history-compression':  6_000,
};

@Injectable()
export class CostOptCounterService {
  private readonly logger = new Logger(CostOptCounterService.name);
  private readonly prisma = new PrismaClient();

  /**
   * Disparado por cada surface que skipea Claude. Devuelve void —
   * el caller no espera el resultado.
   */
  record(args: {
    source: CostOptSource;
    intent?: string | null;
    conversationId?: string | null;
    /** Override del default por source. Útil si el caller conoce
     *  el costo real del turno (e.g. tamaño del history reemplazado). */
    estimatedTokensSaved?: number;
  }): void {
    const tokens =
      typeof args.estimatedTokensSaved === 'number' && args.estimatedTokensSaved >= 0
        ? args.estimatedTokensSaved
        : SAVED_TOKENS_BY_SOURCE[args.source] ?? 0;
    // Fire-and-forget. Errores log a warn pero no rebotan al caller.
    void this.prisma.costOptEvent
      .create({
        data: {
          source: args.source,
          intent: args.intent ?? null,
          conversationId: args.conversationId ?? null,
          estimatedTokensSaved: tokens,
        },
      })
      .catch((err: any) => {
        this.logger.warn(`cost-opt event persist failed (non-fatal, source=${args.source}): ${err.message}`);
      });
  }

  /**
   * Resumen mensual usado por el budget widget. Devuelve count + tokens
   * estimados por source para el mes en curso.
   */
  async monthSummary(): Promise<{
    bySource: Array<{ source: string; count: number; estimatedTokensSaved: number }>;
    totalCount: number;
    totalTokensSaved: number;
  }> {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const rows = await this.prisma.costOptEvent.groupBy({
      by: ['source'],
      where: { createdAt: { gte: monthStart } },
      _count: { _all: true },
      _sum: { estimatedTokensSaved: true },
    });
    const bySource = rows
      .map((r) => ({
        source: r.source,
        count: r._count._all,
        estimatedTokensSaved: r._sum.estimatedTokensSaved ?? 0,
      }))
      .sort((a, b) => b.count - a.count);
    const totalCount = bySource.reduce((s, r) => s + r.count, 0);
    const totalTokensSaved = bySource.reduce((s, r) => s + r.estimatedTokensSaved, 0);
    return { bySource, totalCount, totalTokensSaved };
  }
}
