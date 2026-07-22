/**
 * ADAPTERS LAYER — detector determinístico de mensajes de cierre.
 *
 * Marcos 2026-07-20: cuando el cliente respondía "👍" o "gracias" o
 * "ok" después de que su consulta ya estaba resuelta, la conversación
 * volvía a quedar "pendiente humano" y no había forma de cerrarla sin
 * que el operador hiciera algo. Marcos pidió que el agente lo
 * reconozca y dé por cerrada la conversación solo.
 *
 * Marcos 2026-07-21 (segunda ronda, screenshot 13:58 AR): la primera
 * versión del detector era demasiado estricta con anclado ^...$. Los
 * mensajes reales del cliente vienen con variantes que la regex
 * anclada no capturaba:
 *   - "Dale. Gracias"                     (punto en el medio)
 *   - "Muchas gracias por tu tiempo"      (extra "por tu tiempo")
 *   - "Genial . Gracias. Estoy atenta"    (compound multi-oración)
 *   - "Excelente, muchas gracias"         (falta pattern "excelente" + coma)
 * Marcos flageó 7 rows stuck como pendientes por esto. Nueva regla:
 * en vez de anclar cada patrón, tokenizamos y contamos:
 *   (1) mensaje ≤ ACK_MAX_CHARS (default 80, era 40)
 *   (2) NO contiene "?"
 *   (3) NO contiene verbos de acción (envíame, mandame, necesito, quiero,
 *       podés, cuándo, cómo, dónde, sirven, quedo esperando, esperando
 *       tu respuesta, tengo una duda, otra consulta)
 *   (4) contiene al menos UN token de ack (gracias, ok, dale, listo,
 *       perfecto, bárbaro, genial, excelente, buenísimo, entendido,
 *       copiado, recibido, claro, de acuerdo, exacto, muchas gracias,
 *       muy amable, muy amable, listísimo, joya, joyita, mil gracias)
 *   (5) o es emoji-only (👍/🙏/❤️/😊/etc.)
 *
 * Los tunables se leen de .env — nunca hardcodeados:
 *   ACK_MAX_CHARS               longitud máxima para "corto" (default 80)
 *   ACK_ENABLED                 'false' desactiva el atajo (default true)
 */

// Tokens que solos o combinados con otros indican "cierre de charla".
// Se normaliza texto quitando acentos + minúsculas antes de matchear.
const ACK_TOKENS = new Set<string>([
  'gracias', 'graci',
  'ok', 'okay', 'okey', 'okis', 'okok',
  'dale', 'dalee',
  'listo', 'listisimo', 'listos',
  'perfecto', 'perfe', 'perfe',
  'barbaro', 'barbaros',
  'genial', 'geniales',
  'excelente', 'excelentes',
  'buenisimo', 'buenisimos', 'bueno',
  'entendido', 'entendida',
  'copiado', 'copiada',
  'recibido', 'recibida',
  'clarisimo', 'claro',
  'acuerdo', // "de acuerdo"
  'exacto', 'exacta',
  'joya', 'joyita',
  'mil', // "mil gracias" — mil solo por sí no cierra pero se apoya en gracias
  'amable', // "muy amable" / "sos muy amable"
  'atenta', 'atento', // "estoy atenta/atento"
]);

// Palabras que si aparecen desactivan el atajo — el cliente sigue
// esperando algo. Cubre pedidos de info, siguiente paso, o dudas
// nuevas. NO agregar aquí acknowledgments ni conectores neutros.
const REQUEST_TOKENS = new Set<string>([
  'envíame', 'enviame', 'envian', 'envio',
  'mandame', 'mándame', 'mandan', 'manden', 'mande',
  'necesito', 'necesitaba', 'necesitamos',
  'quiero', 'queria', 'quería',
  'podes', 'podés', 'podria', 'podrías', 'podrian', 'pueden', 'podré', 'podre',
  'cuando', 'cuándo', 'como', 'cómo', 'donde', 'dónde',
  'sirve', 'sirven',
  'quedo', 'queda', // "quedo esperando" / "queda pendiente" — mantiene abierto
  'esperando',
  'duda', 'dudas', 'consulta', 'consultas', // "otra consulta", "una duda"
  'preguntar', 'pregunta',
  'aviso', 'avisas', 'avisen',
  'confirmo', 'confirmame', 'confirmen',
  'pasa', 'pasás', 'pasame',
  'contame', 'contás',
  'hola', 'buenas', 'buenos', // saludo de inicio, no cierre
]);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  const norm = normalize(text);
  if (!norm) return [];
  return norm.split(' ').filter(Boolean);
}

// Emoji-only closing: cualquier combinación de emoji-base + selectores
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
  const maxChars = envNum('ACK_MAX_CHARS', 80);
  if (text.length > maxChars) return false;
  // (2) "?" → pregunta, aunque corta. "ok?", "listo?", "gracias?"
  if (/\?/.test(text)) return false;
  // Emoji-only (aunque sean varios): "👍", "🙏🙏", "❤️😊"
  if (CLOSING_EMOJI_RE.test(text)) return true;
  const tokens = tokenize(text);
  if (tokens.length === 0) return false;
  // (3) si contiene algún request-verb, no cerramos
  for (const t of tokens) {
    if (REQUEST_TOKENS.has(t)) return false;
  }
  // (4) al menos un ack-token
  for (const t of tokens) {
    if (ACK_TOKENS.has(t)) return true;
  }
  return false;
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

/**
 * Marcos 2026-07-21: pidió que el AGENTE tome contexto para decidir
 * si un ack cierra o no la conversación. La regla determinística +
 * la guarda de pregunta abierta atrapan la mayoría de los casos,
 * pero hay ambigüedades: "dale gracias" puede ser respuesta a
 * "¿te cotizo el de 2kg?" (SI, sigue esperando) o cierre después de
 * "quedamos en contacto entonces" (fin de conversación).
 *
 * Esta función pasa las últimas N turnos + el ack a Claude para un
 * "second opinion". Devuelve:
 *   - true  → CLOSED (Claude confirma que el cliente cerró)
 *   - false → OPEN (Claude dice que el cliente sigue esperando)
 *   - null  → indeterminado (API caída, budget agotado, response
 *             mal formateada — el llamador debe fallar seguro: NO
 *             cerrar, dejar que fluya al flujo normal del agente)
 *
 * El callSite queda separado ("ack_confirm") para poder ver el costo
 * en el dashboard. Ver askJson en claude.service.ts para budget guard.
 */
export interface AckConfirmTurn {
  role: 'staff' | 'ai' | 'customer';
  text: string;
}
export interface AckConfirmClient {
  askJson(args: { system: string; user: string; callSite?: string; maxTokens?: number }): Promise<any | null>;
}
export async function claudeConfirmAckCloses(
  client: AckConfirmClient,
  ackText: string,
  recentTurns: AckConfirmTurn[],
): Promise<boolean | null> {
  const trimmedTurns = recentTurns.slice(-6);
  const dialogue = trimmedTurns.map((t) => {
    const label = t.role === 'customer' ? 'CLIENTE' : t.role === 'staff' ? 'STAFF' : 'AGENTE';
    return `${label}: ${(t.text ?? '').trim()}`;
  }).join('\n');
  const system = [
    'Sos un clasificador conciso.',
    'Determiná si la conversación de atención al cliente está terminada o si el cliente sigue esperando respuesta del staff.',
    'Respondé SOLO con JSON: {"decision":"CLOSED"|"OPEN","reason":"<breve>"}',
    'CLOSED = el cliente cerró con un agradecimiento/confirmación y su consulta original ya fue resuelta o no hay pregunta abierta del staff.',
    'OPEN = el cliente respondió afirmativamente a una oferta o pregunta del staff, o su ack implica que quiere seguir (ej. staff pregunta "¿te cotizo el de 2kg?" y el cliente contesta "dale gracias" — CLIENTE SIGUE ESPERANDO la cotización).',
    'Ante duda, respondé OPEN — falso-positivo cerrando cuando no debe es peor que dejarlo abierto.',
  ].join(' ');
  const user = `Últimos mensajes (más viejo arriba):\n${dialogue}\n\nÚltimo mensaje del cliente: "${ackText.trim()}"\n\nDecidí.`;
  const result = await client.askJson({ system, user, callSite: 'ack_confirm', maxTokens: 80 });
  if (!result || typeof result !== 'object') return null;
  const decision = String((result as any).decision ?? '').toUpperCase();
  if (decision === 'CLOSED') return true;
  if (decision === 'OPEN') return false;
  return null;
}
