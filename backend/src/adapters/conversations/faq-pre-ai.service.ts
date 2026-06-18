/**
 * ADAPTERS LAYER — Pre-AI FAQ shortcut.
 *
 * Marcos's 2026-06-04 cost optimization #5: when a customer asks something
 * the operator already has a canned answer for (horarios de atención,
 * dirección, política de envíos), reply from the QuickReply table without
 * burning a Claude call. The agent still handles anything ambiguous —
 * this is a deterministic shortcut for high-volume, exact-match intents.
 *
 * Why hook off QuickReply (not a new table or env var)?
 *   The operator already curates these strings via the existing
 *   `quick_replies` admin UI. Reusing well-known shortcuts means Marcos
 *   edits the FAQ text once and both the operator dropdown AND the
 *   pre-AI filter pick it up — no double maintenance, no business
 *   content in source code.
 *
 * Convention: each intent looks up a shortcut prefixed `faq-`. If the
 * shortcut row doesn't exist or is inactive, the filter declines and
 * the conversation falls through to Claude.
 *
 * Tunable in `.env`:
 *   FAQ_PRE_AI_ENABLED — 'true' / 'false' (default 'true'). Kill switch.
 *   FAQ_PRE_AI_CHANNELS — comma-separated channel allowlist. Empty /
 *     unset means all channels are eligible. ML is excluded by default
 *     because the platform-mandated greeting + signoff would have to be
 *     applied here too, and the AI path already handles that.
 *
 * Returning `null` means "no shortcut applies, let the AI handle it".
 */

import { Injectable, Logger } from '@nestjs/common';
import { Channel, PrismaClient } from '@prisma/client';

type IntentKey = 'horarios' | 'direccion' | 'envios';

interface IntentMatch {
  intent: IntentKey;
  /** Etiqueta del QuickReply asociado (uppercase). */
  label: string;
  matched: string;
}

function isEnabled(): boolean {
  const raw = process.env.FAQ_PRE_AI_ENABLED;
  if (raw == null || raw.trim().length === 0) return true;
  return raw.trim().toLowerCase() === 'true';
}

function allowedChannels(): Set<Channel> | null {
  const raw = process.env.FAQ_PRE_AI_CHANNELS;
  if (raw == null || raw.trim().length === 0) {
    // Default: every channel EXCEPT MercadoLibre. ML replies go through
    // the AI path so the mandatory "Hola {apodo}, ... Un saludo, Lucas
    // de Servifibras." wrap is applied; bypassing the AI here would
    // skip that wrapper.
    return new Set<Channel>([
      Channel.WHATSAPP,
      Channel.FACEBOOK,
      Channel.INSTAGRAM,
      Channel.TIENDANUBE_WEBCHAT,
    ]);
  }
  const parts = raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const out = new Set<Channel>();
  for (const p of parts) {
    if ((Object.values(Channel) as string[]).includes(p)) {
      out.add(p as Channel);
    }
  }
  return out.size > 0 ? out : null;
}

// Intent → regex. Anchored on word boundaries to avoid catching
// substrings inside unrelated questions ("dirección de la entrega"
// should match dirección; "tengo direccionado el pago" should not —
// the second case fails because it's a different lemma family).
const INTENT_PATTERNS: Array<{ intent: IntentKey; re: RegExp }> = [
  {
    intent: 'horarios',
    re: /\b(qu[eé]\s+horarios?|hasta\s+qu[eé]\s+hora|a\s+qu[eé]\s+hora\s+(?:abren|cierran|atienden)|horario\s+de\s+atenci[oó]n|atienden\s+(?:los\s+)?(?:s[áa]bados?|domingos?|feriados?)|abren\s+hoy|est[áa]n\s+abiertos?)\b/i,
  },
  {
    intent: 'direccion',
    re: /\b(d[oó]nde\s+(?:est[áa]n|quedan|los?\s+encuentro)|cu[áa]l\s+es\s+(?:la\s+)?direcci[oó]n|d[oó]nde\s+(?:retiro|paso\s+a\s+buscar)|tienen\s+(?:local|sucursal|showroom)|d[oó]nde\s+(?:los\s+)?ubico)\b/i,
  },
  {
    intent: 'envios',
    re: /\b(hacen\s+env[ií]os?|env[ií]an\s+a|enviar\s+a\s+\w+|(?:c[oó]mo|cu[aá]nto)\s+(?:es\s+)?el\s+env[ií]o|costo\s+(?:del?\s+)?env[ií]o|env[ií]o\s+a\s+domicilio|llega\s+a\s+\w+)\b/i,
  },
];

// Marcos 2026-06-18: rotuladas en mayúsculas para coincidir con la
// convención del nuevo modelo QuickReply (`label` en uppercase).
const INTENT_TO_LABEL: Record<IntentKey, string> = {
  horarios: 'FAQ-HORARIOS',
  direccion: 'FAQ-DIRECCION',
  envios: 'FAQ-ENVIOS',
};

function detect(text: string): IntentMatch | null {
  if (!text) return null;
  const trimmed = text.trim();
  // Guard against giant inbound messages — long messages are almost
  // never single-intent FAQ questions, they're usually a full inquiry
  // that needs reasoning. Skip the regex pass on anything > 280 chars.
  if (trimmed.length === 0 || trimmed.length > 280) return null;
  for (const { intent, re } of INTENT_PATTERNS) {
    const m = trimmed.match(re);
    if (m) {
      return { intent, label: INTENT_TO_LABEL[intent], matched: m[0] };
    }
  }
  return null;
}

@Injectable()
export class FaqPreAiService {
  private readonly logger = new Logger(FaqPreAiService.name);
  private readonly prisma = new PrismaClient();

  /**
   * Returns canned FAQ text for the question, or `null` if no FAQ
   * applies (intent didn't match, channel excluded, feature disabled,
   * or no active QuickReply for the matched shortcut).
   */
  async maybeReply(channel: Channel, text: string): Promise<string | null> {
    if (!isEnabled()) return null;

    const channels = allowedChannels();
    if (channels && !channels.has(channel)) return null;

    const intent = detect(text);
    if (!intent) return null;

    try {
      const row = await this.prisma.quickReply.findUnique({
        where: { label: intent.label },
      });
      if (!row || !row.active) {
        // Intent matched but no canned answer is configured — fall
        // through to AI rather than leaving the customer hanging.
        this.logger.debug(
          `FAQ intent "${intent.intent}" matched but label ${intent.label} missing/inactive — letting AI answer`,
        );
        return null;
      }
      this.logger.log(
        `📌 Pre-AI FAQ matched: intent=${intent.intent} label=${intent.label} ("${intent.matched}") — Claude skipped`,
      );
      // Best-effort usage bump so the QuickReply admin UI shows that
      // the pre-AI path is hitting this row too, not just operator use.
      void this.prisma.quickReply
        .update({
          where: { id: row.id },
          data: { hitCount: { increment: 1 }, lastUsedAt: new Date() },
        })
        .catch((err: any) =>
          this.logger.warn(`FAQ usage bump failed (non-fatal): ${err.message}`),
        );
      return row.body;
    } catch (err: any) {
      // Never block the conversation — fall through to Claude.
      this.logger.error(`FAQ pre-AI lookup failed (non-fatal): ${err.message}`);
      return null;
    }
  }
}
