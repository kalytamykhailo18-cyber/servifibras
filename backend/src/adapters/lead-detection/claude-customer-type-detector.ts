/**
 * ADAPTERS LAYER — Claude-backed customer-type detector.
 *
 * Same swap pattern as ClaudeComplexityClassifier:
 *   - Falls back to keyword detector when Claude isn't configured.
 *   - Wrapped with a hard timeout so a slow LLM doesn't stall the
 *     `classifyOnInbound` non-blocking call.
 *   - Malformed responses fall back to keyword and tag the signal.
 *
 * Tunables (.env):
 *   CUSTOMER_TYPE_DETECTOR_BACKEND  — 'keyword' (default) | 'llm'
 *   CUSTOMER_TYPE_LLM_TIMEOUT_MS    — total per-call timeout (default 5000)
 *   CUSTOMER_TYPE_LLM_MAX_TOKENS    — output budget (default 200)
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  CustomerTypeCode,
  CustomerTypeDetection,
  ICustomerTypeDetector,
} from '../../use-cases/lead-detection/customer-type-detector.interface';
import { KeywordCustomerTypeDetector } from './keyword-customer-type-detector';
import { ClaudeService } from '../ai/claude.service';

const ALL_TYPES: CustomerTypeCode[] = [
  'ARTESANO', 'EMPRENDEDOR', 'MAYORISTA', 'INDUSTRIAL', 'PRFV_LAMINADOS', 'PROVEEDOR',
];

const SYSTEM_PROMPT =
  'Sos un clasificador de tipo de cliente para Servifibras (B2B materiales compuestos en Argentina). ' +
  'Devolvés SIEMPRE un JSON con: {"type": ARTESANO|EMPRENDEDOR|MAYORISTA|INDUSTRIAL|PRFV_LAMINADOS|PROVEEDOR|null, ' +
  '"confidence": 0..1, "signals": [string]}. Nada más.\n\n' +
  'Definiciones:\n' +
  'ARTESANO — hobbysta o craft pequeño, compras chicas para uso personal.\n' +
  'EMPRENDEDOR — pyme/freelancer comprando insumos para su negocio.\n' +
  'MAYORISTA — comercio que revende, compra al por mayor.\n' +
  'INDUSTRIAL — empresa industrial con consumos altos y recurrentes.\n' +
  'PRFV_LAMINADOS — especialista en PRFV / laminados.\n' +
  'PROVEEDOR — vende algo a Servifibras (no es cliente).\n\n' +
  'Si el texto es muy corto o ambiguo, devolvé type=null con confidence baja.';

function num(envKey: string, fallback: number): number {
  const v = process.env[envKey];
  const n = v != null ? Number(v) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

@Injectable()
export class ClaudeCustomerTypeDetector implements ICustomerTypeDetector {
  private readonly logger = new Logger(ClaudeCustomerTypeDetector.name);

  constructor(
    private readonly claude: ClaudeService,
    private readonly fallback: KeywordCustomerTypeDetector,
  ) {}

  async detect(text: string): Promise<CustomerTypeDetection> {
    if (!text || typeof text !== 'string') {
      return { type: null, signals: [], confidence: 0 };
    }
    if (!this.claude.isAvailable()) {
      const k = this.fallback.detectSync(text);
      return { ...k, signals: [...k.signals, 'fallback:no_api_key'] };
    }

    const timeoutMs = num('CUSTOMER_TYPE_LLM_TIMEOUT_MS', 5000);
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
      this.logger.warn(`Customer-type LLM failed (${err.message}) — falling back`);
      const k = this.fallback.detectSync(text);
      return { ...k, signals: [...k.signals, 'fallback:llm_error'] };
    }
  }

  private async askClaude(text: string): Promise<CustomerTypeDetection | null> {
    const raw = await this.claude.askJson({
      system: SYSTEM_PROMPT,
      user: `Mensaje del cliente:\n"""${text}"""\n\nDevolvé el JSON.`,
      maxTokens: num('CUSTOMER_TYPE_LLM_MAX_TOKENS', 200),
      callSite: 'customer_type',
    });
    if (!raw || typeof raw !== 'object') return null;
    const type = raw.type === null || ALL_TYPES.includes(raw.type)
      ? (raw.type as CustomerTypeCode | null)
      : null;
    const confidenceRaw = Number(raw.confidence);
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : 0;
    const signals = Array.isArray(raw.signals)
      ? raw.signals.filter((s: any) => typeof s === 'string').slice(0, 8)
      : [];
    if (type == null && confidence === 0 && signals.length === 0) return null;
    return { type, confidence, signals };
  }
}
