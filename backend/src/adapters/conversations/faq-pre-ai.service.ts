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

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Channel, PrismaClient } from '@prisma/client';
import { CostOptCounterService } from '../ai/cost-opt-counter.service';

type IntentKey =
  | 'horarios'
  | 'direccion'
  | 'envios'
  // Marcos 2026-06-24: intents nuevos para extender el catalogo de
  // skip-Claude. Cada uno mapea a un QuickReply label que el operador
  // edita desde /admin/quick-replies. Si el label no existe / esta
  // inactivo, la consulta cae a Claude (no se rompe nada).
  | 'pagos'
  | 'garantia'
  | 'devoluciones'
  | 'mayorista'
  | 'retiro_local'
  | 'saludo';

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
  // Marcos 2026-06-24 (saludo): mensajes muy cortos que son solo
  // saludos o agradecimientos. NO necesitan Claude — respuesta canned
  // del operador. Anchored a inicio/fin para no atrapar "hola gracias
  // me podes ayudar con..." (eso es saludo + consulta real, va a Claude).
  // Long-form-aware: solo dispara cuando es el ÚNICO contenido (≤30 chars
  // de texto util). El detect() ya tiene el cap de 280 chars; este
  // pattern adicional pide que sea muy corto Y empiece con saludo Y no
  // tenga pregunta despues.
  {
    intent: 'saludo',
    re: /^\s*(?:hola|holaa+|holis|hi|hello|buen[ao]s?\s+(?:d[ií]as?|tardes?|noches?)|buenas|qu[eé]\s+tal|gracias|muchas\s+gracias|ok|okey|okay|perfecto|de\s+acuerdo|listo|dale|joya|gracias\s+por\s+todo)\s*[!.¡¿?]*\s*$/i,
  },
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
  // Marcos 2026-06-24 (pagos): muy frecuente — transferencia, efectivo,
  // tarjeta, cuotas, mercado pago. El cliente quiere saber metodos
  // antes de comprar.
  {
    intent: 'pagos',
    re: /\b(m[eé]todos?\s+de\s+pago|formas?\s+de\s+pago|c[oó]mo\s+(?:se\s+)?paga|aceptan?\s+(?:transferencia|efectivo|tarjeta|cr[eé]dito|d[eé]bito|mercado\s*pago|MP)|hacen?\s+cuotas?|en\s+cuotas?|sin\s+inter[eé]s|por\s+transferencia|en\s+efectivo|pago\s+con\s+(?:tarjeta|transferencia|efectivo|mercado\s*pago))\b/i,
  },
  // garantia: post-venta + pre-venta ("¿tiene garantía?", "¿devuelven el dinero?").
  {
    intent: 'garantia',
    re: /\b(tienen?\s+garant[ií]a|cu[aá]nto\s+(?:dura|es)\s+la\s+garant[ií]a|garant[ií]a\s+del?\s+producto|cubren?\s+(?:fallas|defectos)|me\s+devuelven\s+el\s+dinero|reembols\w+)\b/i,
  },
  // devoluciones: "puedo devolver", "como hago una devolucion".
  {
    intent: 'devoluciones',
    re: /\b(puedo\s+devolver|c[oó]mo\s+(?:hago\s+)?(?:una\s+)?devoluci[oó]n|aceptan?\s+devoluciones?|cambio\s+de\s+producto|si\s+no\s+me\s+(?:gusta|sirve)\s+puedo|si\s+vino\s+(?:fallado|defectuoso|mal))\b/i,
  },
  // mayorista: precios mayoristas / distribuidor.
  {
    intent: 'mayorista',
    re: /\b(precio\s+(?:para\s+)?mayoris\w+|listas?\s+mayoris\w+|venden?\s+por\s+mayor|distribuidor|reventa|al\s+por\s+mayor|cantidad(?:es)?\s+grandes?|precios?\s+especiales?\s+por\s+cantidad)\b/i,
  },
  // retiro_local: "puedo retirar en el local", "retiro propio".
  {
    intent: 'retiro_local',
    re: /\b(puedo\s+retirar(?:\s+en\s+el\s+local)?|retiro\s+(?:en\s+el\s+local|propio|por\s+local)|paso\s+(?:a\s+)?retirar|busco\s+(?:yo|directamente)\s+(?:en\s+)?(?:el\s+)?local|retiro\s+por\s+mi\s+cuenta)\b/i,
  },
];

// Marcos 2026-06-18: rotuladas en mayúsculas para coincidir con la
// convención del nuevo modelo QuickReply (`label` en uppercase).
const INTENT_TO_LABEL: Record<IntentKey, string> = {
  horarios: 'FAQ-HORARIOS',
  direccion: 'FAQ-DIRECCION',
  envios: 'FAQ-ENVIOS',
  // Marcos 2026-06-24: nuevos labels. Editables desde
  // /settings → Respuestas Rápidas. Si el operador no crea el
  // QuickReply correspondiente, el match queda en log (lo verá
  // como "intent matched pero sin canned answer") y la conversación
  // cae a Claude — no se rompe nada.
  pagos: 'FAQ-PAGOS',
  garantia: 'FAQ-GARANTIA',
  devoluciones: 'FAQ-DEVOLUCIONES',
  mayorista: 'FAQ-MAYORISTA',
  retiro_local: 'FAQ-RETIRO',
  saludo: 'FAQ-SALUDO',
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
  private readonly prisma: PrismaClient;

  constructor(
    @Optional() private readonly costOptCounter?: CostOptCounterService,
    @Optional() prismaShared?: import('../repositories/prisma.service').PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

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
        // Marcos 2026-06-24: promovido a log (no debug) para que el
        // operador vea en journalctl qué intents NUEVOS están
        // pidiéndose pero no tienen respuesta canned cargada. Sirve
        // de hint para priorizar qué QuickReply crear primero.
        this.logger.log(
          `🟡 FAQ intent "${intent.intent}" matched (texto: "${intent.matched}") pero label ${intent.label} ${row ? 'INACTIVO' : 'no existe'} — Claude responde`,
        );
        return null;
      }
      this.logger.log(
        `📌 Pre-AI FAQ matched: intent=${intent.intent} label=${intent.label} ("${intent.matched}") — Claude skipped`,
      );
      // Marcos 2026-06-24: registramos el evento de Bloque E para que
      // el widget de Uso de IA sume el ahorro mensual.
      this.costOptCounter?.record({
        source: 'faq-preai',
        intent: intent.intent,
      });
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
