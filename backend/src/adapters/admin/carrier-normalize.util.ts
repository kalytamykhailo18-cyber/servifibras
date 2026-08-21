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

/**
 * Marcos 2026-07-24: mapa opcional de alias configurables por el admin
 * desde el módulo Settings > Alias de mensajerías. Cuando llega, se
 * consulta ANTES de las reglas hardcoded. Key: raw pattern lowercased.
 * Value: nombre canónico al que el admin quiere que caiga. Skip
 * inactive rows en el caller (el service ya filtra active=true).
 */
export type CarrierAliasMap = ReadonlyMap<string, string>;

export function normaliseCarrier(
  raw: string | null | undefined,
  aliases?: CarrierAliasMap,
): string {
  const v = (raw ?? '').trim();
  if (!v) return 'Sin asignar';
  const lc = v.toLowerCase();
  // Alias del admin: match exacto (lowercase, trim). Si hay hit,
  // corto acá y no aplico la cadena histórica.
  if (aliases && aliases.size > 0) {
    const aliased = aliases.get(lc);
    if (aliased && aliased.trim().length > 0) return aliased.trim();
  }
  // Marcos 2026-08-19 (Frente D.3): un raw ya-normalizado tipo
  // "Sin asignar" que reingresa a normaliseCarrier caía en el
  // title-case fallback y salía como "Sin Asignar" (con A mayúscula),
  // partiendo el bucket. Ancla explícita al canonical.
  if (/^sin asignar$/.test(lc)) return 'Sin asignar';
  if (/^andreani\b|env[ií]o nube/.test(lc)) return 'Andreani';
  if (lc === 'flex_373' || /^jyj\b|^j[\s.\-]?y[\s.\-]?j\b/.test(lc)) return 'JyJ';
  // Marcos 2026-06-30: separar TN pickup (comprador pasa a buscar
  // al local) de PRFV taller (Servifibras dispachando laminados
  // propios). Antes ambos caían en "Servifibras propio" — Marcos
  // marcó que ese label no representa nada real.
  //   TN "Retiras en Servifibras Caseros" → "Retira Caseros" (pickup)
  //   Literal "Servifibras propio" (raw stamp del branch prfv en el
  //   aggregator) → mantiene su bucket propio HASTA que Marcos
  //   defina el nombre nuevo para envíos de laminados.
  if (/^retiras? en (la )?servifibras/.test(lc)) return 'Retira Caseros';
  if (/^servifibras propio\b/.test(lc)) return 'Servifibras propio';
  // Marcos 2026-07-23: TN manda "Servifibras" a secas cuando el
  // comprador elige el método de envío express propio del local.
  // Esos despachos los hace JyJ, así que se cobran/pagan como JyJ.
  // Match exacto para no pisar "Servifibras propio" (línea de arriba)
  // ni "Retiras en Servifibras Caseros" (línea 2 arriba). Confirmado
  // contra prod: 41 rows con carrier=='Servifibras' exacto al
  // 07-23; nunca aparece con sufijos o mayúsculas raras.
  if (/^servifibras$/.test(lc)) return 'JyJ';
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
 * Marcos 2026-08-19 (Ustym report Frente D.3): set canónico de nombres
 * de mensajería que sabemos manejar (mapeos hardcoded del normalise +
 * pickup + fallback default). Cualquier grafía que caiga al branch
 * title-case-passthrough de `normaliseCarrier` no está acá — el caller
 * lo usa para emitir alerta "carrier desconocido" en vez de crear un
 * bucket nuevo en silencio y partir el conteo real de esa mensajería
 * en dos.
 *
 * Ojo: el admin puede agregar aliases desde Settings > Alias de
 * mensajerías, así que un alias nuevo cae en `aliases` (map opcional)
 * y NO como carrier desconocido. Sólo grafías sin alias entran acá.
 */
export const KNOWN_CANONICAL_CARRIERS: ReadonlySet<string> = new Set<string>([
  'Sin asignar',
  'Andreani',
  'JyJ',
  'Retira Caseros',
  'Retira Cliente Caseros',
  'Servifibras propio',
  'M2',
  'Baires',
  'OCA',
  'Despachos Online',
  'Mercado Libre',
  'Uber',
  'Oscar',
  'Otros Fletes',
]);

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

/**
 * Marcos 2026-06-30 (fix de regresión sobre el cascade-terminal):
 * el fallback Despachos Online se aplicaba a cualquier row que
 * resolviera "Sin asignar" — incluyendo TN orders con etiqueta
 * de método de envío CABA / GBA <N> (que son IN-zone). Marcos lo
 * notó: "no entiendo lo que aparece como despachos online de donde
 * está tomando la información".
 *
 * Su regla: "Despachos Online es para envíos FUERA de los CPs del
 * Excel parametrizado". CABA/GBA son IN-zone y deberían seguir
 * "Sin asignar" hasta que el operador pique o el default-per-zona
 * se cargue.
 *
 * Este helper aplica el fallback SOLO cuando la pista de label
 * sugiere out-of-zone (provincial / nacional / sin pista pero TN
 * mandó algo) y NO matchea descriptor CABA/GBA.
 */
export function applyOutsideZoneFallback(args: {
  currentCarrier: string;
  rawCarrier?: string | null;
  shippingLabel?: string | null;
}): string {
  if (args.currentCarrier !== 'Sin asignar') return args.currentCarrier;
  const fallback = outsideZoneDefaultCarrier();
  if (!fallback) return 'Sin asignar';
  const hint = ((args.rawCarrier ?? '') + ' ' + (args.shippingLabel ?? '')).toLowerCase().trim();
  // Sin ninguna pista del label = sin información → operador
  // debe picar. NO auto-asignar a Despachos Online.
  if (!hint) return 'Sin asignar';
  // Label arranca con CABA / GBA <digit> = IN-zone descriptor.
  // El default-per-zona (Excel o recommender) debe resolver esto;
  // sin él, queda en Sin asignar para que el operador pique.
  if (/(^|\s)(caba|gba\s*\d)\b/.test(hint)) return 'Sin asignar';
  // Cualquier otro descriptor (Tarifa Nacional / DESPACHO A
  // TERMINAL / nombre de provincia / etc) sí es out-of-zone.
  return fallback;
}
