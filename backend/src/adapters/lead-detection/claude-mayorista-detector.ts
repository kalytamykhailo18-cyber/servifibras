/**
 * ADAPTERS LAYER — Claude-backed mayorista detector.
 *
 * Same swap pattern as the other detectors. The keyword version is solid
 * for explicit phrases ("al por mayor", quantity > threshold) but misses
 * implicit cases — "tengo una distribuidora chica en Mendoza, qué cuenta
 * me hacen si compro fijo". Claude reads context.
 *
 * Tunables (.env):
 *   MAYORISTA_DETECTOR_BACKEND   — 'keyword' (default) | 'llm'
 *   MAYORISTA_LLM_TIMEOUT_MS     — per-call timeout (default 5000)
 *   MAYORISTA_LLM_MAX_TOKENS     — output budget (default 200)
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  IMayoristaDetector,
  MayoristaDetectionResult,
} from '../../use-cases/lead-detection/mayorista-detector.interface';
import { KeywordMayoristaDetector } from './keyword-mayorista-detector';
import { ClaudeService } from '../ai/claude.service';

const SYSTEM_PROMPT =
  'Sos un detector de intención de compra mayorista para Servifibras (B2B materiales compuestos en Argentina). ' +
  'Devolvés SIEMPRE un JSON: {"isMayorista": true|false, "confidence": 0..1, "signals": [string]}. Nada más.\n\n' +
  'Considerá mayorista cuando el cliente:\n' +
  '— pide al por mayor / por mayoreo / a granel,\n' +
  '— se identifica como distribuidor / fábrica / industria / revendedor,\n' +
  '— pide volumen alto (cientos de litros / kilos) o pedido recurrente,\n' +
  '— pide cuenta corriente, lista de precios mayorista, descuento por volumen.\n\n' +
  'NO marcar mayorista si es:\n' +
  '— consulta puntual de un artesano / hobbysta,\n' +
  '— compra única chica para uso personal.\n\n' +
  '"signals" debe ser una lista corta de marcadores observados (ej: ["distribuidor","volumen:alto"]).';

function num(envKey: string, fallback: number): number {
  const v = process.env[envKey];
  const n = v != null ? Number(v) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

@Injectable()
export class ClaudeMayoristaDetector implements IMayoristaDetector {
  private readonly logger = new Logger(ClaudeMayoristaDetector.name);

  constructor(
    private readonly claude: ClaudeService,
    private readonly fallback: KeywordMayoristaDetector,
  ) {}

  async detect(text: string): Promise<MayoristaDetectionResult> {
    if (!text || typeof text !== 'string') {
      return { isMayorista: false, signals: [], confidence: 0 };
    }
    if (!this.claude.isAvailable()) {
      const k = this.fallback.detectSync(text);
      return { ...k, signals: [...k.signals, 'fallback:no_api_key'] };
    }

    const timeoutMs = num('MAYORISTA_LLM_TIMEOUT_MS', 5000);
    try {
      const result = await Promise.race([
        this.askClaude(text),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('llm-timeout')), timeoutMs),
        ),
      ]);
      if (!result) {
        const k = this.fallback.detectSync(text);
        return { ...k, signals: [...k.signals, 'fallback:llm_null'] };
      }
      return result;
    } catch (err: any) {
      this.logger.warn(`Mayorista LLM failed (${err.message}) — falling back`);
      const k = this.fallback.detectSync(text);
      return { ...k, signals: [...k.signals, 'fallback:llm_error'] };
    }
  }

  private async askClaude(text: string): Promise<MayoristaDetectionResult | null> {
    const raw = await this.claude.askJson({
      system: SYSTEM_PROMPT,
      user: `Mensaje del cliente:\n"""${text}"""\n\nDevolvé el JSON.`,
      maxTokens: num('MAYORISTA_LLM_MAX_TOKENS', 200),
      callSite: 'mayorista',
    });
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.isMayorista !== 'boolean') return null;
    const confRaw = Number(raw.confidence);
    const confidence = Number.isFinite(confRaw)
      ? Math.max(0, Math.min(1, confRaw))
      : (raw.isMayorista ? 0.7 : 0);
    const signals = Array.isArray(raw.signals)
      ? raw.signals.filter((s: any) => typeof s === 'string').slice(0, 8)
      : [];
    return { isMayorista: raw.isMayorista, confidence, signals };
  }
}
