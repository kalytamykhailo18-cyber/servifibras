/**
 * ADAPTERS LAYER — detector determinístico de mensajes de cierre.
 *
 * Marcos 2026-07-20: cuando el cliente respondía "👍" o "gracias" o
 * "ok" después de que su consulta ya estaba resuelta, la conversación
 * volvía a quedar "pendiente humano" y no había forma de cerrarla sin
 * que el operador hiciera algo. Marcos pidió que el agente lo
 * reconozca y dé por cerrada la conversación solo.
 *
 * Estrategia:
 *   - Regla rápida y determinística (sin llamar a Claude) para el 90%
 *     de los casos obvios: mensaje corto + acknowledgment pattern.
 *   - Cae en el flujo normal cuando duda (frase larga, contiene
 *     pregunta, o no matchea patterns). Preferimos falso-negativo
 *     (mantener pendiente) antes que falso-positivo (cerrar cuando el
 *     cliente en realidad preguntaba algo).
 *
 * Los tunables se leen de .env — nunca hardcodeados:
 *   ACK_MAX_CHARS               longitud máxima para considerar un
 *                                mensaje "corto" (default 40)
 *   ACK_ENABLED                  'false' desactiva el atajo por
 *                                completo (default true)
 */

// Patrones de acknowledgment en español rioplatense. Anclado a inicio +
// fin del string para no matchear "gracias por confirmar el precio del
// tanque" (que sí es una pregunta implícita). El mensaje entero tiene
// que ser un ack, no contener uno adentro.
const ACK_PATTERNS: RegExp[] = [
  /^gracias!?\.?$/i,
  /^muchas gracias!?\.?$/i,
  /^muy amable!?\.?$/i,
  /^dale!?\.?$/i,
  /^listo!?\.?$/i,
  /^perfecto!?\.?$/i,
  /^b[aá]r[bv]aro!?\.?$/i,
  /^genial!?\.?$/i,
  /^gen[ií]al!?\.?$/i,
  /^buen[íi]simo!?\.?$/i,
  /^ok(ay)?!?\.?$/i,
  /^okey!?\.?$/i,
  /^okis!?\.?$/i,
  /^okok!?\.?$/i,
  /^entendido!?\.?$/i,
  /^copiado!?\.?$/i,
  /^recibido!?\.?$/i,
  /^clarísimo!?\.?$/i,
  /^clar[ií]simo!?\.?$/i,
  /^claro!?\.?$/i,
  /^de acuerdo!?\.?$/i,
  /^perfe(cto)?!?\.?$/i,
  /^dalee?!?\.?$/i,
  /^bue(no)?!?\.?$/i,
  /^exacto!?\.?$/i,
  // Combos ("ok gracias", "listo gracias", "dale gracias")
  /^(ok|okay|dale|listo|perfecto|buen[íi]simo)\s+(gracias|muchas gracias)!?\.?$/i,
  /^(gracias|muchas gracias)\s+(che|entonces|master|totales)?!?\.?$/i,
];

// Emojis "de cierre" — thumbs-up, corazón, manos rezando, sonrisas
// simples. Un mensaje entero compuesto SOLO por uno o más de estos
// emojis se considera acknowledgment.
// Emoji closing: cualquier combinación de emoji-base + selectores
// de variación (U+FE0F) + zero-width joiners (U+200D) + skin tone
// modifiers (U+1F3FB..U+1F3FF) + espacios. Sin esto, "❤️" (heart +
// variation selector U+FE0F) fallaba porque el selector no entra
// en Extended_Pictographic.
const CLOSING_EMOJI_RE = /^(\p{Extended_Pictographic}|[\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]|\s)+$/u;

function envNum(key: string, fallback: number): number {
  const raw = process.env[key];
  const n = raw != null ? Number(raw) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envEnabled(key: string, defaultValue: boolean): boolean {
  const raw = (process.env[key] ?? '').toLowerCase();
  if (raw === '') return defaultValue;
  return raw !== 'false' && raw !== '0';
}

export function isAckEnabled(): boolean {
  return envEnabled('ACK_ENABLED', true);
}

export function isAcknowledgment(rawText: string | null | undefined): boolean {
  if (!isAckEnabled()) return false;
  if (!rawText) return false;
  const text = rawText.trim();
  if (!text) return false;
  const maxChars = envNum('ACK_MAX_CHARS', 40);
  if (text.length > maxChars) return false;
  // Contiene un "?" → probablemente es una pregunta, aunque corta.
  // Ejemplos: "ok?", "listo?", "gracias?"
  if (/\?/.test(text)) return false;
  // Emoji-only (aunque sean varios): "👍", "🙏🙏", "❤️😊"
  if (CLOSING_EMOJI_RE.test(text)) return true;
  return ACK_PATTERNS.some((re) => re.test(text));
}

/**
 * Heurística cheap para "¿el turno previo del staff/AI dejó la consulta
 * resuelta?". Si el previo era una pregunta del staff hacia el cliente,
 * el "ok" del cliente NO cierra el loop — está confirmando algo que
 * requiere seguimiento. Si el previo era una respuesta declarativa,
 * el "ok" cierra el loop.
 *
 * Señal: contiene "?" o termina con ":" (staff pidió info).
 */
export function looksLikeUnresolvedFromStaff(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  if (!t) return false;
  if (/\?/.test(t)) return true;
  if (/:$/.test(t)) return true;
  return false;
}
