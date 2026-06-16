/**
 * ADAPTERS LAYER — Claude-backed complexity classifier.
 *
 * Marcos's three-level routing rule (see complexity-classifier.interface.ts)
 * is the highest-impact LLM swap on the inbound pipeline: a smart classifier
 * catches "polite-but-angry" customers and nuanced business signals that
 * keyword matching misses entirely. We ship this behind a feature flag so
 * the system stays sane the day the API key arrives.
 *
 * Behaviour:
 *   1) If Claude isn't configured, defer to the keyword classifier so the
 *      pipeline never blocks. Same pattern as `OrderStatusReplyService`.
 *   2) Otherwise prompt Claude with a tight schema and parse JSON back.
 *      Errors fall back to keyword too — never throws upstream.
 *
 * Tunables (.env):
 *   COMPLEXITY_CLASSIFIER_BACKEND  — 'keyword' (default) | 'llm'.
 *                                    Even when set to 'llm' we fall back
 *                                    silently if Claude isn't configured.
 *   COMPLEXITY_LLM_MAX_TOKENS      — output budget (default 200).
 *   COMPLEXITY_LLM_TIMEOUT_MS      — total timeout per call (default 5000).
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ComplexityClassification,
  ComplexityLevel,
  IComplexityClassifier,
} from '../../use-cases/lead-detection/complexity-classifier.interface';
import { KeywordComplexityClassifier } from './keyword-complexity-classifier';
import { ClaudeService } from '../ai/claude.service';

function num(envKey: string, fallback: number): number {
  const v = process.env[envKey];
  const n = v != null ? Number(v) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const SYSTEM_PROMPT =
  'Sos un clasificador de complejidad de mensajes de clientes para Servifibras (B2B materiales compuestos en Argentina). ' +
  'Devolvés SIEMPRE un JSON con la forma: {"level": 1|2|3, "signals": [string], "reason": string}. Nada más.\n\n' +
  'Niveles:\n' +
  'L1 — pregunta rutinaria: precio, stock, info técnica básica.\n' +
  'L2 — señal compleja de negocio: cotización formal, OC empresa, factura A, nuevo distribuidor, lote grande con plazo.\n' +
  'L3 — situación delicada que NO debe responder la IA: reclamo, devolución, queja, frustración del cliente, error nuestro, escalamiento legal o estratégico.\n\n' +
  '"signals" es una lista corta de marcadores observados en el texto (ej: ["queja:devolucion","emocional"]). ' +
  '"reason" es una etiqueta corta en español.';

@Injectable()
export class ClaudeComplexityClassifier implements IComplexityClassifier {
  private readonly logger = new Logger(ClaudeComplexityClassifier.name);

  constructor(
    private readonly claude: ClaudeService,
    private readonly fallback: KeywordComplexityClassifier,
  ) {}

  async classify(text: string): Promise<ComplexityClassification> {
    if (!this.claude.isAvailable()) {
      // Silent fallback — let the pipeline keep working before the API key
      // arrives. We tag the reason so logs make the situation obvious.
      const k = this.fallback.classifySync(text);
      return { ...k, signals: [...k.signals, 'fallback:no_api_key'] };
    }

    const timeoutMs = num('COMPLEXITY_LLM_TIMEOUT_MS', 5000);
    try {
      const result = await Promise.race([
        this.askClaude(text),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('llm-timeout')), timeoutMs),
        ),
      ]);
      if (!result) {
        const k = this.fallback.classifySync(text);
        return { ...k, signals: [...k.signals, 'fallback:llm_null'] };
      }
      return result;
    } catch (err: any) {
      this.logger.warn(`Complexity LLM failed (${err.message}) — falling back to keyword`);
      const k = this.fallback.classifySync(text);
      return { ...k, signals: [...k.signals, 'fallback:llm_error'] };
    }
  }

  private async askClaude(text: string): Promise<ComplexityClassification | null> {
    const maxTokens = num('COMPLEXITY_LLM_MAX_TOKENS', 200);
    const raw = await this.claude.askJson({
      system: SYSTEM_PROMPT,
      user: `Mensaje del cliente:\n"""${text}"""\n\nDevolvé el JSON.`,
      maxTokens,
      callSite: 'complexity',
    });
    if (!raw) return null;

    return parseClassification(raw);
  }
}

function parseClassification(raw: any): ComplexityClassification | null {
  if (!raw || typeof raw !== 'object') return null;
  const lvl = Number(raw.level);
  if (![1, 2, 3].includes(lvl)) return null;
  const signals = Array.isArray(raw.signals)
    ? raw.signals.filter((s: any) => typeof s === 'string').slice(0, 8)
    : [];
  const reason = typeof raw.reason === 'string' && raw.reason.length > 0
    ? raw.reason.slice(0, 64)
    : `llm_l${lvl}`;
  return {
    level: lvl as ComplexityLevel,
    signals,
    reason,
  };
}
