/**
 * ADAPTERS LAYER — Claude-backed human-handoff detector.
 *
 * The keyword version catches phrasing like "te derivo con un asesor" or
 * "quiero hablar con una persona". Claude adds the implicit cases — a
 * customer who's getting frustrated, asking the same question for the
 * third time, or hinting they need someone to call.
 *
 * Tunables (.env):
 *   HANDOFF_DETECTOR_BACKEND   — 'keyword' (default) | 'llm'
 *   HANDOFF_LLM_TIMEOUT_MS     — per-call timeout (default 5000)
 *   HANDOFF_LLM_MAX_TOKENS     — output budget (default 200)
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  HandoffDetection,
  HandoffSource,
  IHumanHandoffDetector,
} from '../../use-cases/lead-detection/human-handoff-detector.interface';
import { KeywordHumanHandoffDetector } from './keyword-human-handoff-detector';
import { ClaudeService } from '../ai/claude.service';

const SYSTEM_PROMPT_CUSTOMER =
  'Detectás si un cliente de Servifibras (B2B materiales compuestos en Argentina) ' +
  'está pidiendo hablar con una persona / asesor humano (no quiere seguir con la IA). ' +
  'Devolvés SIEMPRE un JSON: {"needsHuman": true|false, "signals": [string], "reason": string|null}. Nada más.\n\n' +
  'Marcá needsHuman=true cuando:\n' +
  '— pide explícitamente hablar con alguien / un humano / una persona,\n' +
  '— pide número de teléfono o que lo llamen,\n' +
  '— se está frustrando ("ya pregunté tres veces", "no me entendés"),\n' +
  '— el caso es delicado y quiere un trato humano.\n\n' +
  'NO marcar needsHuman cuando es una pregunta rutinaria que la IA puede contestar.';

const SYSTEM_PROMPT_AI =
  'Detectás si una respuesta automática generada por una IA contiene una frase ' +
  'de derivación a un humano ("te derivo con", "te paso con", "pasamos con un asesor"). ' +
  'Devolvés SIEMPRE un JSON: {"needsHuman": true|false, "signals": [string], "reason": string|null}. Nada más.';

function num(envKey: string, fallback: number): number {
  const v = process.env[envKey];
  const n = v != null ? Number(v) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

@Injectable()
export class ClaudeHumanHandoffDetector implements IHumanHandoffDetector {
  private readonly logger = new Logger(ClaudeHumanHandoffDetector.name);

  constructor(
    private readonly claude: ClaudeService,
    private readonly fallback: KeywordHumanHandoffDetector,
  ) {}

  async detectInCustomerMessage(text: string): Promise<HandoffDetection> {
    return this.detect(text, 'customer');
  }
  async detectInAIReply(text: string): Promise<HandoffDetection> {
    return this.detect(text, 'ai');
  }

  private async detect(text: string, source: HandoffSource): Promise<HandoffDetection> {
    if (!text || typeof text !== 'string') {
      return { needsHuman: false, source: null, signals: [], reason: null };
    }
    if (!this.claude.isAvailable()) {
      const k = source === 'customer'
        ? this.fallback.detectInCustomerMessageSync(text)
        : this.fallback.detectInAIReplySync(text);
      return { ...k, signals: [...k.signals, 'fallback:no_api_key'] };
    }

    const timeoutMs = num('HANDOFF_LLM_TIMEOUT_MS', 5000);
    try {
      const result = await Promise.race([
        this.askClaude(text, source),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('llm-timeout')), timeoutMs),
        ),
      ]);
      if (!result) {
        const k = source === 'customer'
          ? this.fallback.detectInCustomerMessageSync(text)
          : this.fallback.detectInAIReplySync(text);
        return { ...k, signals: [...k.signals, 'fallback:llm_null'] };
      }
      return result;
    } catch (err: any) {
      this.logger.warn(`Handoff LLM failed (${err.message}) — falling back`);
      const k = source === 'customer'
        ? this.fallback.detectInCustomerMessageSync(text)
        : this.fallback.detectInAIReplySync(text);
      return { ...k, signals: [...k.signals, 'fallback:llm_error'] };
    }
  }

  private async askClaude(text: string, source: HandoffSource): Promise<HandoffDetection | null> {
    const raw = await this.claude.askJson({
      system: source === 'customer' ? SYSTEM_PROMPT_CUSTOMER : SYSTEM_PROMPT_AI,
      user: source === 'customer'
        ? `Mensaje del cliente:\n"""${text}"""\n\nDevolvé el JSON.`
        : `Respuesta automática de la IA:\n"""${text}"""\n\nDevolvé el JSON.`,
      maxTokens: num('HANDOFF_LLM_MAX_TOKENS', 200),
      callSite: source === 'customer' ? 'handoff_customer' : 'handoff_ai',
    });
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.needsHuman !== 'boolean') return null;
    const signals = Array.isArray(raw.signals)
      ? raw.signals.filter((s: any) => typeof s === 'string').slice(0, 8)
      : [];
    return {
      needsHuman: raw.needsHuman,
      source: raw.needsHuman ? source : null,
      signals,
      reason: raw.needsHuman
        ? (typeof raw.reason === 'string' && raw.reason.length > 0
            ? raw.reason.slice(0, 64)
            : (source === 'customer' ? 'customer_request' : 'ai_handoff_phrase'))
        : null,
    };
  }
}
