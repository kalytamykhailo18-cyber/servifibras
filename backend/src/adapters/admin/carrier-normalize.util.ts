/**
 * Marcos 2026-06-30: helper compartido para resolver el nombre de
 * mensajería a partir de strings crudos. Antes vivía como método
 * privado en AnalyticsService — ahora también lo usa el
 * DailyLogisticaAggregator para que la Listas panel muestre la
 * misma segmentación por mensajería que la Despachos panel, sin
 * duplicar la regla de negocio.
 *
 * Conocidas (regex contra el lower-case del input):
 *   - Andreani / Envío Nube → "Andreani"
 *   - Flex_373 / JyJ        → "JyJ"
 *   - Servifibras / Retiras en Servifibras → "Servifibras propio"
 *   - M2 / Mensajería M2    → "M2"
 *   - Baires / Mensajería Baires → "Baires"
 *   - OCA                   → "OCA"
 *   - Despachos Online (con o sin sufijo Shipping) → "Despachos Online"
 *   - Mercado Libre         → "Mercado Libre"
 *
 * Descriptores TN (CABA GRATUITO, GBA X GRATIS, Tarifa Nacional,
 * DESPACHO A TERMINAL) → "Sin asignar" (el cascade del caller
 * decide qué hacer con esos).
 *
 * Cualquier otro nombre pasa title-cased como su propio bucket.
 */

// Marcos 2026-06-30: cualquier cosa que arranque con "CABA" o
// "GBA <digit>" es descriptor de método de envío TN, sin importar
// si lleva "GRATIS"/"GRATUITO" o solo un paren con horario tipo
// "GBA 2 (15hs A 21hs)". Los nombres reales de mensajerías nunca
// arrancan con esos prefijos.
const SHIPPING_DESCRIPTOR_REGEX = /^(caba|gba\s*\d)\b|^tarifa nacional|despacho a terminal|grat(is|uito)\s*\(|env[ií]o (grat(is|uito)|sin cargo)/;

export function normaliseCarrier(raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  if (!v) return 'Sin asignar';
  const lc = v.toLowerCase();
  if (/^andreani\b|env[ií]o nube/.test(lc)) return 'Andreani';
  if (lc === 'flex_373' || /^jyj\b|^j[\s.\-]?y[\s.\-]?j\b/.test(lc)) return 'JyJ';
  if (/servifibras/.test(lc) || /^retiras? en (la )?servifibras/.test(lc)) return 'Servifibras propio';
  if (/^m2\b|mensaje?r[ií]a m2/.test(lc)) return 'M2';
  if (/^baires\b|mensaje?r[ií]a baires/.test(lc)) return 'Baires';
  if (/^oca\b/.test(lc)) return 'OCA';
  if (/^despachos? online\b/.test(lc)) return 'Despachos Online';
  if (/^mercado libre\b/.test(lc)) return 'Mercado Libre';
  if (SHIPPING_DESCRIPTOR_REGEX.test(lc)) return 'Sin asignar';
  return v
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Marcos 2026-06-30: cascade terminal para la mensajería de larga
 * distancia (CPs fuera del Excel parametrizado). Default "Despachos
 * Online"; configurable via env si Marcos cambia de courier de
 * fallback en el futuro. Vacío en env = comportamiento legacy
 * (deja "Sin asignar" como bucket terminal).
 */
export function outsideZoneDefaultCarrier(): string | null {
  const v = (process.env.OUTSIDE_ZONE_DEFAULT_CARRIER ?? 'Despachos Online').trim();
  return v || null;
}
