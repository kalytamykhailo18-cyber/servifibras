/**
 * ADAPTERS LAYER — Spanish keyword heuristic for order-status intent.
 *
 * Fires when the customer asks about a previous order: "¿dónde está mi
 * pedido?", "estado de mi compra", "tracking", "ya despacharon", etc.
 *
 * Tunable in `.env`:
 *   ORDER_STATUS_INTENT_PHRASES — comma-separated phrase override. If set,
 *     replaces the built-in Spanish defaults entirely. Useful if Marcos wants
 *     to add region-specific slang or narrow the rule without a code change.
 *
 * If the message contains an explicit order number in `ORD-YYYY-NNNN` format,
 * we surface it so the reply service can prefer it over "latest order".
 */

import { Injectable } from '@nestjs/common';
import {
  IOrderStatusIntent,
  OrderStatusIntentResult,
} from '../../use-cases/conversations/order-status-intent.interface';

const DEFAULT_PHRASES = [
  // Direct status / tracking
  'estado de mi pedido',
  'estado del pedido',
  'estado de mi compra',
  'estado de mi orden',
  'mi pedido',
  'mi compra',
  'mi orden',
  'donde esta mi pedido',
  'donde está mi pedido',
  'donde esta mi compra',
  'donde está mi compra',
  'donde esta mi orden',
  'donde está mi orden',
  'cuando llega',
  'cuándo llega',
  'cuando me llega',
  'cuándo me llega',
  'fecha de entrega',
  'fecha de envio',
  'fecha de envío',
  'seguimiento',
  'tracking',
  'numero de seguimiento',
  'número de seguimiento',
  'rastreo',
  'rastrear',
  'ya despacharon',
  'ya enviaron',
  'ya salio',
  'ya salió',
  'ya entregaron',
  // Bare "envío" / "envio" / "despacho" used to be in this list but they
  // false-positive on pre-sale logistics questions like "hacés envíos al
  // interior?" or "tenés despacho" — Marcos hit this on 2026-05-14 in
  // the ML sandbox. Phrases with possessive or temporal context
  // ("fecha de envío", "ya despacharon", "mi envío" etc.) stay above.
  'mi envio',
  'mi envío',
  'mi despacho',
];

function loadPhrases(): string[] {
  const raw = process.env.ORDER_STATUS_INTENT_PHRASES;
  if (raw && raw.trim().length > 0) {
    return raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
  }
  return DEFAULT_PHRASES.map((p) => p.toLowerCase());
}

// Order-number extraction supports three real-world formats:
//   • "ORD-2026-1234" — the format OrderManagementService generates for
//     manual/CRM-registered orders.
//   • "TN-15518"      — TiendaNube orders synced by tiendanube-orders-sync
//     (the local orderNumber column keeps the TN- prefix).
//   • "Pedido 15518" / "orden 15479" / "compra 15200" / "#15518" — how
//     REAL customers write it on WhatsApp (Marcos 2026-08-18 replay
//     surfaced this — 2 of the 40 sampled inbounds used bare numeric).
//     We capture the digits alone here; the reply service tries
//     TN-<digits> and ORD-YYYY-<padded> variants when resolving.
const ORDER_NUMBER_RES: RegExp[] = [
  /\b(ORD-\d{4}-\d{4})\b/i,
  /\b(TN-\d{3,7})\b/i,
  /(?:^|[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9])(?:pedido|orden|compra|order)s?\s*#?\s*(\d{3,7})\b/i,
  /(?:^|\s)#(\d{3,7})\b/,
];

// Marcos 2026-06-24 (MLA859949317): el matcher hacía `.includes(phrase)`
// y "cuándo llega" matcheaba dentro de "cuándo llegaría a Ameghino" — un
// pregunta de pre-venta sobre envíos. Cambiamos a word-boundary regex
// para que cada frase requiera límite de palabra a ambos lados.
function phraseToBoundaryRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // \b no respeta acentos en JS; usamos lookarounds para borde de palabra
  // ASCII-letras+dígitos. Cualquier carácter no-alfanumérico (espacio,
  // signo, comienzo/fin de cadena) cuenta como límite.
  return new RegExp(`(?:^|[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9])${escaped}(?:$|[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9])`, 'i');
}

// Marcos 2026-06-24: disqualifiers para pre-venta. Si el mensaje contiene
// uno de estos patterns, no es un "estado de mi orden" sino una consulta
// sobre logística general previa a comprar — debe ir a la IA.
const PRE_SALE_DISQUALIFIERS: RegExp[] = [
  /\bhac[eé]n\s+env[ií]os?\b/i,
  /\benv[ií]an\s+a\s+\w+/i,         // "envían a Ameghino", "envían a Mendoza"
  /\bqu[eé]\s+costo\s+(?:tiene|sale|es)/i,
  /\bcu[aá]nto\s+(?:cuesta|sale|es)\s+(?:el\s+)?env[ií]o/i,
  /\bllega(?:r[ií]a)?\s+a\s+\w+/i,  // "llegaría a Ameghino"
  /\bcp\s*\d{4}\b/i,                 // "CP 6064" en el mensaje
  /\ba\s+\w+,\s*(?:buenos\s+aires|caba|c[oó]rdoba|santa\s+fe|mendoza)/i,
];

@Injectable()
export class KeywordOrderStatusIntent implements IOrderStatusIntent {
  private readonly phrases = loadPhrases();
  private readonly phraseRes: Array<{ phrase: string; re: RegExp }> = this.phrases.map((p) => ({
    phrase: p,
    re: phraseToBoundaryRegex(p),
  }));

  detect(text: string): OrderStatusIntentResult {
    if (!text || typeof text !== 'string') {
      return { match: false, orderNumber: null, signals: [] };
    }
    const signals: string[] = [];

    // Pre-sale disqualifier check FIRST. Si la pregunta es claramente
    // sobre "¿hacen envíos a X? ¿cuánto cuesta? ¿cuándo llegaría?"
    // (pre-compra), no la tratamos como consulta de estado de orden.
    const preSaleHit = PRE_SALE_DISQUALIFIERS.find((re) => re.test(text));
    if (preSaleHit) {
      return { match: false, orderNumber: null, signals: [`disqualified:pre-sale`] };
    }

    for (const { phrase, re } of this.phraseRes) {
      if (re.test(text)) {
        signals.push(`phrase:${phrase}`);
      }
    }

    // Try each format in priority order; first match wins.
    let orderNumber: string | null = null;
    for (const re of ORDER_NUMBER_RES) {
      const m = text.match(re);
      if (m && m[1]) { orderNumber = m[1].toUpperCase(); break; }
    }
    if (orderNumber) signals.push(`orderNumber:${orderNumber}`);

    // An explicit order number alone counts as intent — customers often paste
    // their tracking code without surrounding text.
    const match = signals.length > 0;

    return { match, orderNumber, signals };
  }
}
