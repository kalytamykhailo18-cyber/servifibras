/**
 * ADAPTERS LAYER — Daily Logística aggregator.
 *
 * Marcos's brief 2026-06-06 (Bloque C): the daily logistics Excel
 * groups orders into 6 fixed sections in this order:
 *
 *   COLECTA 1            — ML cuenta 1 (SERVIFIBRAS) — colecta
 *   COLECTA 2            — ML cuenta 2 (TIENDASERVIFIBRAS.COM) — colecta
 *   FLEX 1               — ML cuenta 1 — flex
 *   FLEX 2               — ML cuenta 2 — flex
 *   MOTOS                — TN + WhatsApp + mayorista — Flex / local delivery
 *   MICROS               — TN + WhatsApp + mayorista — external transport / interior
 *
 * Each row carries `cliente` (buyer + #orderNumber + carrier/notes
 * glued the way the warehouse already reads them) and `producto`
 * (joined SKU + armador alias per line item).
 *
 * Source split rules:
 *   - ML orders → fetch live via MercadoLibreService.fetchOrdersForRange
 *     per cuenta provider. Categorise each by `shipping.logistic_type`:
 *       'self_service' / 'cross_docking' / 'drop_off' → COLECTA
 *       'flex' / 'self_pickup'                        → FLEX
 *       'fulfillment'                                  → skip (ML ships)
 *       anything else                                  → COLECTA (safer default)
 *   - Local Order rows (WA / mayorista / manual): `carrier` value
 *     matching MICROS_CARRIER_PATTERNS env regex → MICROS, else MOTOS.
 *   - TN orders: not yet synced into the local DB (deferred to a
 *     dedicated TN-orders sync). Returns an empty section with a
 *     `pending: 'tiendanube-orders-not-synced'` note instead of failing.
 *
 * Failure mode: per-source errors are logged but don't take down the
 * whole aggregation — the section just emits `[]` plus a `errors[]`
 * entry the Excel generator can render as a footer line.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OrderStatus, PrismaClient } from '@prisma/client';
import type { MercadoLibreService } from '../mercadolibre/mercadolibre.service';
import { MERCADOLIBRE_SERVICE } from '../../use-cases/mercadolibre/mercadolibre.token';
import { LogisticaArmadoService } from './logistica-armado.service';
import { normaliseCarrier, applyOutsideZoneFallback } from './carrier-normalize.util';
import { DispatchTariffService } from './dispatch-tariff.service';

export type DailySection =
  | 'COLECTA_1'
  | 'COLECTA_2'
  | 'FLEX_1'
  | 'FLEX_2'
  | 'MOTOS'
  | 'MICROS'
  | 'RETIRA_CASEROS'
  | 'LAMINADOS_PRFV';

export const SECTION_ORDER: DailySection[] = [
  'COLECTA_1',
  'COLECTA_2',
  'FLEX_1',
  'FLEX_2',
  'MOTOS',
  'MICROS',
  // Marcos 2026-06-10 — operators caught that "Acordá entrega" and
  // "Acordá envío" are TWO different ML states. Pickups at the
  // Servifibras Caseros store live here (TN orders with
  // shipping_pickup_type=pickup auto-route; ML no_shipping rows
  // get a manual override since the ML order endpoint exposes no
  // pickup-vs-ship signal).
  'RETIRA_CASEROS',
  // Marcos 2026-06-12 — PRFV laminado pipeline integrates here once
  // a placa transitions to LISTA_CORTADA. Sits at the bottom because
  // it's a smaller / less-frequent flow than the daily ML/TN volume,
  // but it surfaces in the same panel so the operator doesn't switch
  // pages to dispatch ready laminados.
  'LAMINADOS_PRFV',
];

export const SECTION_LABELS: Record<DailySection, string> = {
  COLECTA_1: 'COLECTA 1',
  COLECTA_2: 'COLECTA 2',
  FLEX_1: 'FLEX 1',
  FLEX_2: 'FLEX 2',
  MOTOS: 'MOTOS',
  MICROS: 'MICROS',
  RETIRA_CASEROS: 'RETIRA CASEROS',
  LAMINADOS_PRFV: 'LAMINADOS PRFV',
};

export interface DailySectionRow {
  cliente: string;
  /** Marcos 2026-06-10: split fields so the panel can show name
   *  on top + order number underneath without parsing the legacy
   *  composite `cliente` string. Stays alongside `cliente` for
   *  backward compatibility (Excel generator + e2e probes). */
  clienteName: string;
  orderRef: string;
  producto: string;
  /** Stable identifier so the Excel generator can carry the "armado"
   *  checkbox state back into our DB when the operator ticks a row. */
  rowKey: string;
  /** Where this row came from — useful for the "Armado" UI to know
   *  whether the persistence target is an ML order id, a CRM order
   *  id, or a TN order id. */
  source: 'ML_CUENTA_1' | 'ML_CUENTA_2' | 'CRM_ORDER' | 'TIENDANUBE_ORDER' | 'PRFV_PLACA';
  sourceId: string;
  /** Picker checked this row as "armado". Bloque C — Marcos 2026-06-06.
   *  Persisted in `LogisticaArmado` keyed by rowKey, so the state is
   *  stable across day boundaries and Excel regenerations.
   *
   *  Kept as a boolean derived from `state` so legacy consumers (the
   *  current Excel column C, e2e probes) still work without
   *  awareness of the 3-state machine. True whenever state is
   *  ARMADO or LISTO. */
  armado: boolean;
  /** ISO timestamp of the armado tick. null when state=PENDIENTE. */
  armadoAt: string | null;
  /** Operator user-id that ticked the row. null when armado=false or
   *  when the original record lost its operator (User delete cascade
   *  sets this to null). */
  armadoById: string | null;
  /**
   * Marcos 2026-06-25: nombre del operador que stampedó la fila
   * (último que toco state/courier — armado o pasaje a LISTO). Antes
   * el frontend solo recibía el id opaco; ahora se resuelve server-side
   * para mostrar "Armado por dario" en el panel y en el detail del
   * pedido. Null si el operador fue borrado.
   */
  armadoByName: string | null;
  /** Bloque B item 3.6 — Marcos 2026-06-08: 3-state lifecycle.
   *  PENDIENTE (default — picker hasn't touched it),
   *  ARMADO    (pack assembled),
   *  LISTO     (closed and labelled, esperando retiro). */
  state: 'PENDIENTE' | 'ARMADO' | 'LISTO';
  /** ISO timestamp of the LISTO transition (null while state≠LISTO). */
  listoAt: string | null;
  /** Bloque B item 3.7 — Marcos 2026-06-08: per-item check progress.
   *  Array of item keys the picker has ticked off inside the
   *  expanded panel. Drives the "3/5" counter and the LISTO
   *  block-until-complete rule. */
  itemsChecked: string[];
  /** Bloque B item 3.8 — Marcos 2026-06-08: per-row free-text note
   *  del armador. Editable inline desde el panel de logística;
   *  persisted by rowKey across day regenerations. Empty/blank → null. */
  notes: string | null;
  /**
   * Marcos 2026-06-18 PM: nota del PEDIDO original (cargada por quien
   * armó el pedido en /orders o que vino en TN). Pasa al armador SIN
   * mezclarse con sus propias notas (`notes`). Si el operador escribió
   * "frágil — atar con cinta" al cargar el pedido, el armador lo ve
   * acá; si después él agrega "falta confirmar color", eso queda en
   * `notes`. Read-only para el armador (su edición va a `notes`).
   * Null para placas PRFV y otras fuentes sin nota de origen.
   */
  orderNotes: string | null;
  /** Bloque B item 3.9 — Marcos 2026-06-08: cancellation flag.
   *  True when the underlying ML shipping_status / order status is
   *  "cancelled" OR the CRM Order.status is CANCELLED. The panel
   *  renders these rows with a red CANCELADA badge so the picker
   *  doesn't waste time on a cart the buyer pulled back. */
  isCancelled: boolean;
  /** Bloque B item 3.9 — direct link to the underlying publication
   *  (ML rows only). Click on the producto column opens it in a new
   *  tab; helps resolve "what was this product again?" quickly. */
  mlPermalink: string | null;
  /** Bloque B item 3.11 — Marcos 2026-06-09: dispatched flag.
   *  True when the order has already left the warehouse (ML
   *  shipping_status ∈ shipped/delivered OR local Order.status ∈
   *  DISPATCHED/DELIVERED). The frontend hides these from the
   *  default "Pendientes" view and shows them under the DESPACHADAS
   *  tab so the picker only sees what still needs work.
   *
   *  Marcos 2026-06-11 (#2000016880649372 fallout): when
   *  `isStuckInHub` is true this flag is FORCED to false — a pack
   *  that's been parked in ML's hub past the stale window is NOT
   *  actually dispatched, the carrier didn't pick it up, so the
   *  picker has to see it again. */
  isDispatched: boolean;
  /** Marcos 2026-06-11 (#2000016880649372): true when an ML pack's
   *  shipment is parked in `substatus=in_hub` past
   *  ML_HUB_STALE_HOURS (default 24h since dateCreated). The panel
   *  yanks these rows back into Pendientes and renders a red
   *  "ATASCADO EN HUB" badge so silent expiry surfaces instead of
   *  hiding under Despachadas. ML rows only; always false on CRM/TN
   *  rows because they have no in_hub state. */
  isStuckInHub: boolean;
  /**
   * Marcos 2026-06-20: true cuando el row salió a "Despachadas"
   * porque ML reportó shipping_status / substatus de despacho, PERO
   * el operador jamás stampó ARMADO ni LISTO (state quedó en
   * PENDIENTE). Indica que el paquete físicamente se fue sin pasar
   * por la verificación de armado del equipo — riesgo de que falte
   * un producto o que se haya despachado el pedido equivocado. La UI
   * lo surfacea con un badge rojo en la tab Despachadas + un contador
   * en el chip de la tab para que el armador pueda revisar.
   */
  autoDispatchedWithoutArmado: boolean;
  /** Raw ML shipping signals — surfaced for diagnostics when an
   *  operator clicks into a row that's behaving oddly (e.g.
   *  "despachada" filing without a real pickup). Null on CRM/TN
   *  rows. Worst-pack values when a pack groups multiple orders. */
  mlShippingStatus: string | null;
  mlShippingSubstatus: string | null;
  /** Marcos 2026-06-09: "Acordás la entrega" — ML orders where the
   *  buyer arranges direct pickup, so the ML shipping flow stays
   *  blank (shipping.id=null, logistic_type=undefined). These ride
   *  the panel under MOTOS (local fleet) and need the picker to
   *  coordinate with the buyer, so the UI renders an "Acordá con
   *  cliente" chip on the row. */
  pickupAgreement: boolean;
  /** Marcos 2026-06-10: post-venta unread indicator. True when ML's
   *  /messages/packs/{packId}/sellers/{sellerId} returns a buyer
   *  message not yet replied to. ML rows only; null on CRM/TN rows.
   *  Drives a "MENSAJE" envelope chip on the panel so the picker
   *  knows to read the chat before sealing the box (typical reason:
   *  buyer wants to change/add an item). */
  hasUnreadMessage: boolean | null;
  /** Marcos 2026-06-10: which flex courier picked up the box (FLEX
   *  rows only; null on COLECTA/MOTOS/MICROS). The dropdown shows
   *  in the "Listas para despachar" tab; choices come from the
   *  FLEX_COURIERS env. */
  flexCourier: string | null;
  /** Marcos 2026-06-30: mensajería ya resuelta para esta fila
   *  (operator pick > carrier de la fuente > default Despachos
   *  Online). Misma regla que el panel "Despachos por mensajería".
   *  El frontend lo usa para mostrar un chip con la mensajería
   *  efectiva en cada row + chips de distribución arriba del tab. */
  resolvedCarrier: string;
  /** ISO timestamp the underlying order was created. Drives the
   *  per-section sort (newest first). For ML rows we use the
   *  packed-cart's earliest order creation date (so a multi-day
   *  pack sorts by its newest member). */
  createdAtIso: string | null;
  /** Bloque B item 2 — Marcos 2026-06-07: in-CRM expand-in-place.
   *  Itemised breakdown of the order so the picker can open a row in
   *  the panel and see the full pack composition (image, full name,
   *  SKU, quantity) instead of relying on the short "X + Y - Z"
   *  formula in the `producto` column or downloading the Excel. The
   *  short formula stays as the collapsed view. */
  items: Array<{
    sku: string | null;
    name: string;
    quantity: number;
    /** Operator-edited short alias (Bloque C). Falls back to the
     *  cleaned first 40 chars of `name` when absent. The collapsed
     *  `producto` column already prefers this; surfaced again so the
     *  expand panel can show "Alias → full name" inline. */
    alias: string | null;
    /** Image URL when available (ML items only — CRM "Registrar
     *  pedido" rows don't carry images). */
    imageUrl: string | null;
    /** Unit ARS price when the source surfaces it (ML items). null
     *  for CRM orders that don't store per-line prices. */
    unitPrice: number | null;
    /** Marcos 2026-06-10: warehouse location (Product.warehouseLocation
     *  joined by SKU). Frontend prefixes "UBI: {warehouseLocation}"
     *  on the item line. Null when no SKU match or no location was
     *  loaded for that SKU. */
    warehouseLocation: string | null;
  }>;
}

export interface AggregatedDay {
  date: string; // YYYY-MM-DD
  sections: Record<DailySection, DailySectionRow[]>;
  errors: Array<{ source: string; message: string }>;
  notes: Array<{ source: string; message: string }>;
  /** Marcos 2026-06-30: distribución de mensajería para los packs
   *  pendientes del día (no incluye los ya despachados — esos
   *  viven en el panel "Despachos por mensajería"). Permite al
   *  frontend mostrar chips arriba del tab "Listas" como
   *  "JyJ: 12 · Despachos Online: 18 · M2: 6 · Sin asignar: 3".
   *  Computado sobre los rows de las secciones que NO están
   *  dispatched.
   */
  carrierSummary: Array<{
    carrier: string;
    pending: number;
    listas: number;
    total: number;
    /** Marcos 2026-06-30: proyección del costo a pagar al courier
     *  para los packs de hoy de esta mensajería. Computado como
     *  AVG(DispatchTariff.costPerPackage) para la mensajería (las
     *  tarifas vienen por zona; sin zona-lookup en el aggregator
     *  usamos el promedio para una proyección al ojo). Null cuando
     *  no hay tarifa activa cargada para esa mensajería (típicamente
     *  Despachos Online / Mercado Libre / Servifibras propio). */
    estimatedCostPerPackage: number | null;
    /** total = (pending + listas) × estimatedCostPerPackage cuando
     *  hay tarifa, null cuando no. */
    estimatedCostTotal: number | null;
  }>;
}

/**
 * Heuristic: a "MICROS" order is one that ships via interior /
 * external transports (Andreani, ViaCargo, etc.). Anything else
 * (typical for local Flex / on-foot delivery) lands on MOTOS. Env
 * regex makes this tunable without redeploying when a new transport
 * appears in the mix.
 */
function isMicrosCarrier(carrier: string | null | undefined): boolean {
  if (!carrier) return false;
  const raw = (process.env.MICROS_CARRIER_PATTERNS || 'andreani|viacargo|via\\s*cargo|via cargo|cruz\\s*del\\s*sur|chevallier|transporte|exp\\.|expreso').trim();
  const re = new RegExp(raw, 'i');
  return re.test(carrier);
}

function categoriseMlLogisticType(
  logisticType: string | null,
  shippingMode: string | null,
): 'COLECTA' | 'FLEX' | 'FULFILLMENT' | 'UNKNOWN' {
  const lt = (logisticType ?? '').toLowerCase();
  if (lt === 'fulfillment') return 'FULFILLMENT';
  // Marcos 2026-06-08: ML's seller UI labels `self_service` shipments
  // as FLEX (sticker reads "Envíos Flex", instructions say "darle el
  // paquete a tu conductor mañana"). Same goes for legacy `flex` /
  // `self_pickup` / `self_pickup_in_seller`. All four map to FLEX so
  // the daily panel matches what the picker sees in ML.
  if (
    lt === 'flex' ||
    lt === 'self_pickup' ||
    lt === 'self_pickup_in_seller' ||
    lt === 'self_service'
  ) {
    return 'FLEX';
  }
  // COLECTA = ML truck picks up at seller OR seller drops at agency.
  if (
    lt === 'cross_docking' ||
    lt === 'drop_off' ||
    lt === 'xd_drop_off'
  ) {
    return 'COLECTA';
  }
  // Older mode coding — fall back to shipping_mode when logistic_type
  // is missing or unrecognised.
  const sm = (shippingMode ?? '').toLowerCase();
  if (sm === 'me1' || sm === 'me2' || sm === 'mercadoenvios') return 'COLECTA';
  if (sm === 'fulfillment') return 'FULFILLMENT';
  return 'UNKNOWN';
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function isoDayBounds(date: Date): {
  fromIso: string;
  toIso: string;
  isoDay: string;
  /** Bloque B item 3.11 — Marcos 2026-06-09: rolling backlog. Pull
   *  orders from the last LOGISTICA_LOOKBACK_DAYS days, not just
   *  the picked day. ML's "Etiquetas para imprimir" filter works
   *  on the backlog (pedidos pendientes regardless of when they
   *  were placed); the panel matches that. */
  backlogFromIso: string;
} {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  const from = new Date(y, m, d, 0, 0, 0, 0);
  const to = new Date(y, m, d, 23, 59, 59, 999);
  const lookbackDays = Number(process.env.LOGISTICA_LOOKBACK_DAYS) || 14;
  const backlogFrom = new Date(y, m, d - lookbackDays, 0, 0, 0, 0);
  return {
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    isoDay: `${y}-${pad2(m + 1)}-${pad2(d)}`,
    backlogFromIso: backlogFrom.toISOString(),
  };
}

/**
 * Marcos 2026-06-09 (urgent): an order is "dispatched" (off the
 * picker's plate) the moment ML's chain has it — not strictly when
 * status flips to `shipped`. For cross-docking shipments the seller
 * drops at the agency and ML's UI immediately shows "En camino /
 * Llega mañana" while the shipment endpoint still reports
 * `status=ready_to_ship, substatus=in_hub`. From the picker's POV
 * that box is GONE — it must not block the pendientes view.
 *
 * So: a shipment is dispatched if EITHER
 *   - top-level status ∈ {shipped, delivered, not_delivered}, OR
 *   - substatus ∈ {in_hub, in_transit, out_for_delivery, soon_deliver,
 *                  receiver_absent, delivered, not_delivered}.
 */
const ML_DISPATCHED_STATUSES = new Set([
  'shipped',
  'delivered',
  'not_delivered',
]);
const ML_DISPATCHED_SUBSTATUSES = new Set([
  'in_hub',
  'in_transit',
  'out_for_delivery',
  'soon_deliver',
  'receiver_absent',
  'delivered',
  'not_delivered',
]);
const isMlShipmentDispatched = (
  status: string | null | undefined,
  substatus: string | null | undefined,
): boolean => {
  const st = (status ?? '').toLowerCase();
  const sub = (substatus ?? '').toLowerCase();
  return ML_DISPATCHED_STATUSES.has(st) || ML_DISPATCHED_SUBSTATUSES.has(sub);
};

/**
 * Marcos 2026-06-11 (#2000016880649372): an ML pack flagged as
 * "in-flight" by ML but that hasn't actually moved past the stale
 * window means the carrier never advanced it — and our aggregator
 * was silently filing it under Despachadas. Surface these back to
 * the picker instead.
 *
 * Three failure modes covered:
 *   1. `substatus=in_hub` past ML_HUB_STALE_HOURS (default 24h) —
 *      ML's hub received the box, but it never left.
 *   2. `substatus=in_transit` past ML_TRANSIT_STALE_HOURS (default
 *      72h) — moving for too long, likely lost.
 *   3. `substatus=not_delivered` ALWAYS — explicit delivery failure
 *      regardless of timing.
 *
 * `substatus=delivered` is the only terminal-OK signal; anything
 * else that's "supposedly dispatched" gets re-surfaced if stale.
 * `out_for_delivery` / `receiver_absent` / `soon_deliver` resolve
 * within a day on their own, so we don't flag them.
 *
 * Threshold is env-driven so we can tighten/loosen without redeploys.
 */
function envHours(key: string, fallback: number): number {
  const raw = (process.env[key] ?? '').trim();
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const isMlStuckInHub = (
  status: string | null | undefined,
  substatus: string | null | undefined,
  createdAtIso: string | null,
  nowMs: number = Date.now(),
): boolean => {
  const st  = (status ?? '').toLowerCase();
  const sub = (substatus ?? '').toLowerCase();
  // not_delivered is a terminal failure — always flag.
  if (sub === 'not_delivered' || st === 'not_delivered') return true;
  if (!createdAtIso) return false;
  const t = Date.parse(createdAtIso);
  if (!Number.isFinite(t)) return false;
  const hoursOld = (nowMs - t) / 3_600_000;
  if (sub === 'in_hub' && hoursOld >= envHours('ML_HUB_STALE_HOURS', 24)) return true;
  // Per-substatus stale windows. Marcos 2026-06-12: tighter windows
  // (24h transit, 24h delivery-attempt) were flagging healthy
  // shipments — #2000013466422713 is en-camino with ETA Jun 16 and
  // got marked ATASCADO. Realistic domestic transit in AR is 2-5
  // days; only consider it stuck past that.
  if (sub === 'in_transit' && hoursOld >= envHours('ML_TRANSIT_STALE_HOURS', 96)) return true;
  // out_for_delivery + receiver_absent should resolve within ~2
  // days; past that the carrier likely lost it.
  if (
    (sub === 'out_for_delivery' || sub === 'receiver_absent' || sub === 'soon_deliver')
    && hoursOld >= envHours('ML_DELIVERY_STALE_HOURS', 48)
  ) return true;
  // Top-level `shipped` with NO advancing substatus past the transit
  // window — the carrier accepted the label but never moved it. This
  // is the shape #2000016880649372 has. Sub empty / missing.
  if (st === 'shipped' && (!sub || sub === '') && hoursOld >= envHours('ML_TRANSIT_STALE_HOURS', 96)) return true;
  return false;
};

@Injectable()
export class DailyLogisticaAggregatorService {
  private readonly logger = new Logger(DailyLogisticaAggregatorService.name);
  private readonly prisma = new PrismaClient();

  constructor(
    private readonly armado: LogisticaArmadoService,
    @Optional()
    @Inject(MERCADOLIBRE_SERVICE)
    private readonly mercadolibre?: MercadoLibreService,
    // Marcos 2026-06-30: opcional para que tests que instancian el
    // service standalone no se rompan. Cuando está wired computa
    // proyección de costo por mensajería sobre los packs pendientes
    // del día (~ARS X por chip).
    @Optional()
    private readonly dispatchTariff?: DispatchTariffService,
  ) {}

  async aggregate(date: Date): Promise<AggregatedDay> {
    // Marcos 2026-06-29 (perf investigation): instrumentación temporal
    // de cada stage del aggregator. Marcos reportó timeouts de ~30s y
    // pidió cazar la causa raíz en vez de mitigarlo solo con caché.
    // Los timings se loguean al final como "aggregate timing total=...
    // mlCuentas=... localOrders=... prfv=... mergeArmado=... unread=...".
    // Una vez identificada y atacada la stage culpable, se puede sacar
    // este logging si genera ruido — pero la idea es dejarlo como hint
    // de performance permanente.
    const tAll = Date.now();
    const timings: Record<string, number> = {};
    const stamp = (k: string, t0: number) => { timings[k] = Date.now() - t0; };

    const { fromIso, toIso, isoDay, backlogFromIso } = isoDayBounds(date);
    // Bloque B item 3.11 — backlog window for ML + local fetch.
    // `fromIso/toIso` still drives the operational-day stamping
    // (LogisticaArmado.dayDate). `backlogFromIso/toIso` is what we
    // actually filter orders by — matches ML's "pendientes para
    // armar" view that spans multiple days.
    void fromIso; // kept in scope for future per-day stats
    const out: AggregatedDay = {
      date: isoDay,
      sections: {
        COLECTA_1: [],
        COLECTA_2: [],
        FLEX_1: [],
        FLEX_2: [],
        MOTOS: [],
        MICROS: [],
        RETIRA_CASEROS: [],
        LAMINADOS_PRFV: [],
      },
      errors: [],
      notes: [],
      // Stamped al final del agregado después de resolveCarriers().
      carrierSummary: [],
    };

    // ─── ML cuenta 1 + cuenta 2 ─────────────────────────────────────
    const tMl = Date.now();
    if (!this.mercadolibre) {
      out.notes.push({
        source: 'mercadolibre',
        message: 'MercadoLibreService not available in this runtime — ML sections skipped.',
      });
    } else {
      const cuentaProviders: Array<{ provider: string; suffix: '_1' | '_2' }> = [
        { provider: 'mercadolibre', suffix: '_1' },
        { provider: 'mercadolibre_cuenta2', suffix: '_2' },
      ];
      // Marcos 2026-06-29 (perf): antes este loop era secuencial — cada
      // cuenta esperaba a que la anterior terminara antes de empezar.
      // Con dos cuentas que cada una tarda ~10-15s contra la API de
      // ML, el aggregator quedaba en ~25-30s solo por el await en
      // serie. Las dos cuentas son independientes (no comparten
      // estado, escriben a `out.sections[*]` cuyo .push es seguro en
      // single-threaded JS), así que las corremos en paralelo.
      // hydrateMlUnreadFlags sigue afuera del Promise.all porque
      // necesita el merge completo de ambas cuentas para deduplicar
      // el cache hit.
      const subTimings: Record<string, number> = {};
      const processCuenta = async ({ provider, suffix }: { provider: string; suffix: '_1' | '_2' }) => {
        const tCuentaTotal = Date.now();
        const cuentaTimings = { fetch: 0, alias: 0, process: 0 };
        try {
          const tFetch = Date.now();
          const result = await this.mercadolibre.fetchOrdersForRange({
            fromIso: backlogFromIso,
            toIso,
            provider,
          });
          cuentaTimings.fetch = Date.now() - tFetch;
          if (!result) {
            out.notes.push({
              source: `mercadolibre${suffix}`,
              message: `${provider} no tiene credenciales — sección vacía.`,
            });
            return;
          }
          // Marcos 2026-06-29 (perf): pre-cargo el aliasMap UNA sola
          // vez para todos los SKUs de esta cuenta (antes el loop
          // per-pack tiraba 2 queries Prisma cada uno). Saca el N+1
          // que era el bottleneck principal del mlCuentas stage.
          const tAlias = Date.now();
          const allSkusInCuenta: string[] = [];
          for (const o of result.orders) {
            for (const it of o.items) {
              if (it.sku) allSkusInCuenta.push(it.sku);
            }
          }
          const aliasMap = await this.loadProductAliasMap(allSkusInCuenta);
          cuentaTimings.alias = Date.now() - tAlias;
          const tProcess = Date.now();
          // Bloque B item 3.5 — Marcos 2026-06-08: cart/pack grouping.
          // ML attaches a `pack_id` to every order that belongs to a
          // multi-item cart. From the picker's POV one pack = one
          // box = one label. Group all orders sharing a packId into
          // a single panel row whose items array concatenates each
          // underlying order's items. Singleton orders (pack_id =
          // null) become a row each, same as before.
          const groups = new Map<string, typeof result.orders>();
          for (const o of result.orders) {
            const key = o.packId ? `pack:${o.packId}` : `order:${o.id}`;
            const arr = groups.get(key) ?? [];
            arr.push(o);
            groups.set(key, arr);
          }
          for (const [key, ordersInGroup] of groups) {
            // Section is determined from the FIRST order's shipment —
            // packs ship together so every underlying order shares
            // the same logistic.type. (Verified on Marcos's cuenta 1
            // 2026-06-08 — all pack siblings have identical shipping.)
            const head = ordersInGroup[0];
            // Marcos 2026-06-09 (urgent → corrected): "Acordás la
            // entrega" orders have NO ML shipping — shipping.id is
            // null and logistic_type is undefined because the buyer
            // arranges direct pickup. Marcos's correction: these are
            // NOT skip-worthy, they're micro/moto jobs (the local
            // fleet hands them over after coordinating with the
            // buyer). Route to MOTOS with a `pickupAgreement` flag so
            // the picker UI surfaces an "Acordá con cliente" chip.
            const hasAnyShipping = ordersInGroup.some(
              (g) => g.shippingId || g.logisticType,
            );
            const pickupAgreement = !hasAnyShipping;
            let section: DailySection;
            if (pickupAgreement) {
              section = 'MOTOS';
            } else {
              const cat = categoriseMlLogisticType(head.logisticType, head.shippingMode);
              if (cat === 'FULFILLMENT') continue;
              if (cat === 'UNKNOWN') {
                this.logger.debug(
                  `ML group ${key} unknown logistic_type=${head.logisticType ?? '-'} mode=${head.shippingMode ?? '-'} — defaulting to COLECTA`,
                );
              }
              section =
                cat === 'FLEX'
                  ? (suffix === '_1' ? 'FLEX_1' : 'FLEX_2')
                  : (suffix === '_1' ? 'COLECTA_1' : 'COLECTA_2');
            }
            // Flatten items across every order in the pack.
            const allItems = ordersInGroup.flatMap((g) => g.items);
            const allItemsExpanded = await this.expandMlItems(allItems, aliasMap);
            // Pack-aware rowKey: orders sharing a packId become one
            // row so armado state persists at the pack level — the
            // picker ticks once for the whole box, not once per
            // underlying order.
            const rowKey = head.packId
              ? `ml:${suffix.slice(1)}:pack:${head.packId}`
              : `ml:${suffix.slice(1)}:${head.id}`;
            // sourceId carries the pack id when present, otherwise the
            // singleton order id — keeps the back-link traceable.
            const sourceId = head.packId ?? head.id;
            // Aggregate the producto label across the pack's items.
            const groupedProducto = head.packId
              ? await this.formatMlProductoFromItems(allItems, aliasMap)
              : await this.formatMlProducto(head, aliasMap);
            const groupedCliente = head.packId
              ? this.formatMlPackCliente(head, ordersInGroup.length, allItems.length)
              : this.formatMlCliente(head);
            // Marcos 2026-06-10: split clienteName + orderRef for the
            // new two-line panel display.
            const clienteName = head.buyerNickname || 'Comprador';
            const orderRef = head.packId
              ? `pack #${head.packId}`
              : `#${head.id}`;
            // Bloque B item 3.9 — cancellation + permalink. Marcos
            // 2026-06-08: shipping_status="cancelled" on any sibling
            // order means the whole pack was pulled by the buyer.
            // mlPermalink is built from the first item's itemId
            // (catalog redirects MLA-id → full canonical URL).
            //
            // Marcos 2026-06-23 (pack #2000017022488910 + #2000016728149670):
            // shippingStatus a veces no se flipea a 'cancelled' cuando
            // ML cancela el reclamo del lado de ellos — pero el
            // order-level `status` SÍ ('cancelled' o 'invalid'). Sin
            // chequear ese campo, packs cancelados volvían a aparecer
            // en Armado con la nota manual "RECLAMO CERRADO". Ahora
            // miramos ambos: shippingStatus OR order.status. Cualquier
            // sibling con uno de los dos en 'cancelled'/'invalid' ya
            // hace que el pack quede oculto del panel armado.
            const isCancelled = ordersInGroup.some((g) => {
              const ss = (g.shippingStatus ?? '').toLowerCase();
              const os = (g.status ?? '').toLowerCase();
              return ss === 'cancelled' || os === 'cancelled' || os === 'invalid';
            });
            // Bloque B item 3.11 — dispatched flag. A pack is
            // dispatched when EVERY sibling order has been shipped.
            // Marcos 2026-06-09 (urgent): for cross-docking the
            // top-level status stays at `ready_to_ship` even after
            // ML's UI shows "En camino / Llega mañana" — what flips
            // is the substatus to `in_hub`/`in_transit`/etc. The
            // helper covers both signals.
            const isDispatchedRaw = ordersInGroup.every((g) =>
              isMlShipmentDispatched(g.shippingStatus, g.shippingSubstatus),
            );
            // Pick the latest creation date across the pack so
            // multi-day carts sort by their newest member.
            const createdAtIso = ordersInGroup
              .map((g) => g.dateCreated)
              .filter((d): d is string => !!d)
              .sort()
              .pop() ?? null;
            // Marcos 2026-06-11 (#2000016880649372): if ANY sibling
            // order in the pack is parked in `in_hub` past the stale
            // window, the whole pack is stuck — the carrier never
            // moved it. Yank it back to Pendientes with a red badge.
            const isStuckInHub = ordersInGroup.some((g) =>
              isMlStuckInHub(g.shippingStatus, g.shippingSubstatus, g.dateCreated ?? createdAtIso),
            );
            const isDispatched = isStuckInHub ? false : isDispatchedRaw;
            // Pick the most "advanced" status/substatus across the
            // pack — for diagnostics surfaced on the row. Prefer the
            // first non-empty value in the group.
            const mlShippingStatus = ordersInGroup.map((g) => g.shippingStatus).find((v) => v != null && v !== '') ?? null;
            const mlShippingSubstatus = ordersInGroup.map((g) => g.shippingSubstatus).find((v) => v != null && v !== '') ?? null;
            // Marcos 2026-06-09: the bare `MLA{digits}` form 404s on
            // ML's article host. The canonical permalink is
            // `MLA-{digits}-_JM` (alpha-prefix, hyphen, digits, `-_JM`).
            // Insert the hyphen after the 3-letter country prefix and
            // append the catalog suffix so the redirect lands on the
            // real product page.
            const firstItemId = allItems[0]?.itemId;
            const mlPermalink = firstItemId
              ? `https://articulo.mercadolibre.com.ar/${firstItemId.replace(/^([A-Z]{3})(\d+)$/, '$1-$2')}-_JM`
              : null;
            out.sections[section].push({
              cliente: groupedCliente,
              clienteName,
              orderRef,
              producto: groupedProducto,
              rowKey,
              source: suffix === '_1' ? 'ML_CUENTA_1' : 'ML_CUENTA_2',
              sourceId,
              armado: false,
              armadoAt: null,
              armadoById: null,
              armadoByName: null,
              state: 'PENDIENTE' as const,
              itemsChecked: [] as string[],
              notes: null as string | null,
              orderNotes: null as string | null,
              isCancelled,
              mlPermalink,
              isDispatched,
              isStuckInHub,
              // Marcos 2026-06-20: se setea con true más abajo en el
              // armado-merge pass cuando isDispatched=true pero el
              // operador nunca stampó armado. Default false.
              autoDispatchedWithoutArmado: false,
              mlShippingStatus,
              mlShippingSubstatus,
              pickupAgreement,
              hasUnreadMessage: false,
              flexCourier: null,
              createdAtIso,
              listoAt: null,
              items: allItemsExpanded,
              resolvedCarrier: '',
            });
          }
          cuentaTimings.process = Date.now() - tProcess;
        } catch (err: any) {
          out.errors.push({
            source: `mercadolibre${suffix}`,
            message: err?.message ?? String(err),
          });
        }
        subTimings[`cuenta${suffix}_total`] = Date.now() - tCuentaTotal;
        subTimings[`cuenta${suffix}_fetch`] = cuentaTimings.fetch;
        subTimings[`cuenta${suffix}_alias`] = cuentaTimings.alias;
        subTimings[`cuenta${suffix}_process`] = cuentaTimings.process;
      };
      const tHydrate = Date.now();
      await Promise.all(cuentaProviders.map(processCuenta));
      subTimings['ml_pre_hydrate'] = Date.now() - tHydrate;

      // Marcos 2026-06-10: post-venta unread indicator. For every ML
      // pendiente row (across both cuentas), check if the buyer has
      // an unread message in the post-venta chat. Two reasons we
      // only check pendientes:
      //   1. Despachadas don't matter — the picker is done with them.
      //   2. Perf: ~30-40 pendientes vs 350+ total cuts the API hit
      //      count by ~10× and keeps the panel under 5s.
      // Cache results per pack/order id with a short TTL so cross-tab
      // navigation reuses the same lookup.
      const tHy = Date.now();
      try {
        await this.hydrateMlUnreadFlags(out);
      } catch (err: any) {
        // Non-fatal: the panel still renders, just without the
        // envelope chip on rows.
        this.logger.warn(`ML unread hydration failed: ${err?.message ?? err}`);
      }
      subTimings['ml_hydrate'] = Date.now() - tHy;
      Object.assign(timings, subTimings);
    }
    stamp('mlCuentas', tMl);

    // ─── Local Order rows (WA / mayorista / manual) → MOTOS / MICROS ──
    const tLocal = Date.now();
    try {
      // Marcos 2026-06-16: pendientes (CONFIRMED / PROCESSING) must
      // NEVER drop off the panel because they're old — they carry
      // forward day-to-day automatically until the operator arms them.
      // Two queries:
      //   1. Active orders (CONFIRMED, PROCESSING) — no time filter,
      //      they roll over from any past day until handled.
      //   2. Recently dispatched / cancelled — bounded by the env
      //      lookback so the Despachadas tab doesn't pollute with
      //      ancient history.
      const orderSelect = {
        id: true,
        orderNumber: true,
        carrier: true,
        notes: true,
        products: true,
        source: true,
        status: true,
        sectionOverride: true,
        // Marcos 2026-06-25: nuevo campo para detectar TN pickup sin
        // contaminar `notes`. La detección isTnPickup lo lee.
        shippingPickupType: true,
        createdAt: true,
        contact: { select: { name: true } },
      };
      const [activeOrders, recentSettled] = await Promise.all([
        this.prisma.order.findMany({
          where: {
            status: { in: [OrderStatus.CONFIRMED, OrderStatus.PROCESSING] },
          },
          select: orderSelect,
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.order.findMany({
          where: {
            createdAt: { gte: new Date(backlogFromIso), lte: new Date(toIso) },
            status: { in: [OrderStatus.DISPATCHED, OrderStatus.CANCELLED] },
          },
          select: orderSelect,
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      const localOrders = [...activeOrders, ...recentSettled];
      // Marcos 2026-06-10: skip e2e/fixture orders whose contact name
      // matches the test-filter regex — they were polluting MOTOS with
      // "2D Test 2d-mayorista-…" rows and Marcos can't tell them apart
      // from real mayorista orders.
      const testFilterRaw = (process.env.LOGISTICA_TEST_ORDER_FILTER_REGEX || '').trim();
      const testFilterRe = testFilterRaw ? new RegExp(testFilterRaw, 'i') : null;
      // Marcos 2026-06-16: extra filter on orderNumber so DEMO seed
      // rows + E2E/AUDIT prefixes don't leak into MOTOS now that the
      // pendientes fetch is unbounded. Matches against the
      // orderNumber field directly (not contact.name).
      const testOrderRaw = (process.env.LOGISTICA_TEST_ORDER_NUMBER_REGEX || '').trim();
      const testOrderRe = testOrderRaw ? new RegExp(testOrderRaw, 'i') : null;
      for (const o of localOrders) {
        if (testFilterRe && o.contact?.name && testFilterRe.test(o.contact.name)) {
          continue;
        }
        if (testOrderRe && o.orderNumber && testOrderRe.test(o.orderNumber)) {
          continue;
        }
        // Marcos 2026-06-26: TN orders con pago PENDIENTE no entran a
        // la cola de armado. mapStatus del TN sync pone PROCESSING
        // ⟺ payment_status='pending'; CONFIRMED se setea solo cuando
        // el pago está acreditado (paid/authorized). Los rows MANUAL
        // del operador se crean siempre en CONFIRMED, así que el
        // filtro no los afecta — solo skip las TN sin pagar para que
        // no aparezcan en el panel hasta que TN confirme la
        // acreditación. Marcos reportó múltiples órdenes "pendientes
        // de pago" listadas para armar el 2026-06-26.
        if (o.source === 'TIENDANUBE' && o.status === OrderStatus.PROCESSING) {
          continue;
        }
        // Marcos 2026-06-10 — TN orders with shipping_pickup_type=pickup
        // are buyer-pickup at the Servifibras Caseros store. Marcos
        // 2026-06-25: el flag pasó de `notes` (que se mezclaba con
        // las notas del operador) al campo dedicado `shippingPickupType`.
        // Fallback al carrier-regex preservado para TN options donde
        // pickup_type no llega (legacy).
        const pickupCarrierRe = (process.env.PICKUP_CARRIER_PATTERNS || '').trim();
        const isPickupCarrier = pickupCarrierRe.length > 0
          && o.carrier
          && new RegExp(pickupCarrierRe, 'i').test(o.carrier);
        const isTnPickup =
          o.shippingPickupType === 'pickup' || !!isPickupCarrier;
        // Marcos 2026-06-12: manual orders carry an explicit "Enviar
        // a" preselection from the operator. Honour it before the
        // legacy carrier-regex inference so the picker finds the row
        // exactly where the operator dropped it.
        const VALID_OVERRIDE = new Set<DailySection>(['MOTOS', 'MICROS', 'RETIRA_CASEROS', 'LAMINADOS_PRFV']);
        const override =
          typeof (o as any).sectionOverride === 'string'
            && VALID_OVERRIDE.has((o as any).sectionOverride as DailySection)
            ? ((o as any).sectionOverride as DailySection)
            : null;
        const section: DailySection = override
          ?? (isTnPickup
            ? 'RETIRA_CASEROS'
            : (isMicrosCarrier(o.carrier) ? 'MICROS' : 'MOTOS'));
        // Bloque B item 3 — TN orders ride the same Order table.
        // Distinguish on the row so the picker UI can label which
        // checkout the order came from; rowKey carries the same
        // prefix split so existing armado-state lookups still work.
        const fromTn = o.source === 'TIENDANUBE';
        const isCancelled = o.status === OrderStatus.CANCELLED;
        // Marcos 2026-06-11: TN's "despachado" flag fires when the
        // operator marks empaquetado (which they do to print the
        // shipping label, often before the carrier actually picks
        // up). So for TN-sourced rows we DON'T auto-flip
        // isDispatched from the source side — the operator drives
        // it manually through PENDIENTE → ARMADO → LISTO and then
        // "Marcar como despachadas" once the package is really
        // out the door. CRM (WhatsApp / mayorista) orders still
        // follow the local DISPATCHED status, and ML rows continue
        // to use shipping_status (handled upstream — irrelevant
        // here). Cancellation handling is untouched.
        const isDispatched = fromTn
          ? false
          : o.status === OrderStatus.DISPATCHED;
        const localName = o.contact?.name?.trim() || 'Cliente';
        const localOrderRef = `#${o.orderNumber}`;
        out.sections[section].push({
          cliente: this.formatLocalCliente(o),
          clienteName: localName,
          orderRef: localOrderRef,
          producto: await this.formatLocalProducto(o),
          rowKey: fromTn ? `tn:${o.id}` : `crm:${o.id}`,
          source: fromTn ? 'TIENDANUBE_ORDER' : 'CRM_ORDER',
          sourceId: o.id,
          armado: false,
          armadoAt: null,
          armadoById: null,
          armadoByName: null,
          state: 'PENDIENTE' as const,
          itemsChecked: [] as string[],
          notes: null as string | null,
          // Marcos 2026-06-18 PM: nota cargada por el operador en
          // /orders (o por TN al sync). Llega read-only al armador
          // para que vea aclaraciones del pedido sin que se
          // confunda con las suyas propias.
          orderNotes: o.notes ?? null,
          isCancelled,
          mlPermalink: null,
          isDispatched,
          isStuckInHub: false,
          autoDispatchedWithoutArmado: false,
          mlShippingStatus: null,
          mlShippingSubstatus: null,
          pickupAgreement: false,
          hasUnreadMessage: null,
          flexCourier: null,
          createdAtIso: o.createdAt.toISOString(),
          listoAt: null,
          items: await this.expandLocalItems(o.products),
          // Marcos 2026-06-30: la cascade del final del aggregate
          // resuelve la mensajería efectiva — para que tenga acceso
          // al carrier del Order original, lo stampeamos en _carrier.
          resolvedCarrier: '',
          _carrier: o.carrier ?? null,
        } as any);
      }
    } catch (err: any) {
      out.errors.push({ source: 'crm-orders', message: err?.message ?? String(err) });
    }
    stamp('localOrders', tLocal);

    // ─── TN orders ────────────────────────────────────────────────────
    // Bloque B item 3 (Marcos 2026-06-08): TN orders are now synced
    // into the local Order model with source=TIENDANUBE. The local-
    // orders query above ALREADY surfaces them because the schema
    // is shared — but we re-tag them as source=TIENDANUBE_ORDER on
    // the row so the daily UI can distinguish "vino del checkout
    // de TN" vs "alguien lo cargó por WhatsApp / mayorista". The
    // MOTOS/MICROS routing is driven by the same carrier regex
    // (TN orders carry shipping_carrier_name → carrier on Order).
    // We rewrite the rows we just pushed where the underlying
    // Order had source=TIENDANUBE.

    // ─── PRFV laminados ready for dispatch ───────────────────────────
    // Marcos 2026-06-12: once a placa transitions to LISTA_CORTADA
    // (phase 2) it's ready to be picked up or dispatched. Surface
    // these in the same daily panel under LAMINADOS_PRFV so the
    // operator doesn't have to switch pages. DESPACHADA_RETIRADA is
    // the terminal state — those don't show up here.
    const tPrfv = Date.now();
    try {
      const placas = await this.prisma.prfvPlaca.findMany({
        where: { state: 'LISTA_CORTADA' },
        orderBy: { stateChangedAt: 'desc' },
        select: {
          id: true,
          cliente: true,
          producto: true,
          notes: true,
          stateChangedAt: true,
          createdAt: true,
        },
      });
      for (const p of placas) {
        out.sections.LAMINADOS_PRFV.push({
          cliente: p.cliente,
          clienteName: p.cliente,
          orderRef: `placa #${p.id.slice(0, 8)}`,
          producto: p.producto,
          rowKey: `prfv:${p.id}`,
          source: 'PRFV_PLACA',
          sourceId: p.id,
          armado: true,                // LISTA_CORTADA already implies "armado"
          armadoAt: p.stateChangedAt.toISOString(),
          armadoById: null,
          armadoByName: null,
          state: 'LISTO' as const,
          listoAt: p.stateChangedAt.toISOString(),
          itemsChecked: [],
          notes: p.notes ?? null,
          orderNotes: null,
          isCancelled: false,
          mlPermalink: null,
          isDispatched: false,
          isStuckInHub: false,
          autoDispatchedWithoutArmado: false,
          mlShippingStatus: null,
          mlShippingSubstatus: null,
          pickupAgreement: false,
          hasUnreadMessage: null,
          flexCourier: null,
          createdAtIso: p.createdAt.toISOString(),
          items: [],
          resolvedCarrier: '',
        });
      }
    } catch (err: any) {
      out.errors.push({ source: 'prfv-placas', message: err?.message ?? String(err) });
    }
    stamp('prfv', tPrfv);

    // ─── Merge armado state ──────────────────────────────────────────
    const tMerge = Date.now();
    // Single bulk lookup across all rows we just collected, then
    // mutate each row in-place. This keeps the per-row population
    // path simple and lets the picker UI / Excel generator render
    // column C (boolean) + column D (timestamp) without re-querying.
    try {
      const allKeys = SECTION_ORDER.flatMap((s) => out.sections[s].map((r) => r.rowKey));
      if (allKeys.length > 0) {
        const armadoMap = await this.armado.lookupMany(allKeys);
        for (const s of SECTION_ORDER) {
          for (const r of out.sections[s]) {
            const stamp = armadoMap.get(r.rowKey);
            if (stamp) {
              // Marcos 2026-06-11: PENDIENTE is now a real state in
              // the enum — a row can carry sectionOverride / note /
              // courier metadata without being armado yet. The
              // derived `armado` flag reflects the true lifecycle:
              // true only when state ∈ {ARMADO, LISTO}. Anything
              // that reads `row.armado` (the legacy Excel checkbox,
              // older e2e probes) stays correct.
              r.armado = stamp.state === 'ARMADO' || stamp.state === 'LISTO';
              r.state = stamp.state === 'PENDIENTE' ? 'PENDIENTE' : stamp.state;
              r.armadoAt = stamp.armadoAt?.toISOString() ?? stamp.stampedAt.toISOString();
              r.listoAt = stamp.listoAt?.toISOString() ?? null;
              r.armadoById = stamp.stampedById;
              r.armadoByName = stamp.stampedByName;
              r.itemsChecked = Array.isArray(stamp.itemsChecked) ? stamp.itemsChecked : [];
              r.notes = stamp.notes ?? null;
              r.flexCourier = stamp.flexCourier ?? null;
              // Marcos 2026-06-10: tag the row for filter-out below.
              (r as { _archived?: boolean })._archived = stamp.archivedAt != null;
              // Marcos 2026-06-10: stash the manual section override so
              // the second pass can re-bucket the row.
              (r as { _override?: string | null })._override = stamp.sectionOverride ?? null;
              // Marcos 2026-06-10: manual dispatch confirmation
              // wins over the source-side flag (a buyer picked up,
              // or the flex courier physically took the box).
              //
              // Marcos 2026-06-11 (#2000016880649372): EXCEPT when
              // the manual confirmation has been sitting for too
              // long without ML confirming delivery. The operator
              // who clicked "marcar despachada" may have done so
              // optimistically; if ML never advances past anything
              // other than `delivered` past ML_MANUAL_DISPATCH_STALE_HOURS,
              // we treat the manual stamp as suspect and surface the
              // row back to the picker with the ATASCADO badge.
              if (stamp.manuallyDispatchedAt) {
                const dispatchedHoursAgo =
                  (Date.now() - stamp.manuallyDispatchedAt.getTime()) / 3_600_000;
                const mlSub = (r.mlShippingSubstatus ?? '').toLowerCase();
                // Only ML rows can be flagged "stuck" — CRM/TN rows
                // don't have an ML status feedback loop to disprove
                // the manual stamp.
                const isMlRow = r.source === 'ML_CUENTA_1' || r.source === 'ML_CUENTA_2';
                // Marcos 2026-06-26: ventana de "trust absoluto" para
                // confirmaciones manuales viejas. Después de N horas
                // (default 5 días = 120h) asumimos que la
                // confirmación del operador es definitiva — ML a
                // veces no actualiza el substatus past in_hub aunque
                // el paquete entregó, y rebotar a "ATASCADO EN HUB"
                // pedidos manualmente despachados hace 10 días
                // contamina el panel con falsos positivos (Marcos
                // 2026-06-26: pack CALU2441483 del 16/06).
                const trustHours = envHours('ML_MANUAL_DISPATCH_TRUST_HOURS', 120);
                const trustedOld = isMlRow && dispatchedHoursAgo >= trustHours;
                const stale =
                  !trustedOld
                  && isMlRow
                  && dispatchedHoursAgo >= envHours('ML_MANUAL_DISPATCH_STALE_HOURS', 24)
                  && mlSub !== 'delivered';
                if (stale) {
                  r.isStuckInHub = true;
                  r.isDispatched = false;
                } else {
                  r.isStuckInHub = false;
                  r.isDispatched = true;
                }
              }
            }
          }
        }
      }
    } catch (err: any) {
      out.errors.push({ source: 'logistica-armado', message: err?.message ?? String(err) });
    }

    // Marcos 2026-06-20: pase final que flagea filas auto-despachadas
    // sin armar. La condición es: la fila terminó isDispatched=true
    // (ML reportó shipped/in_hub/in_transit OR el operador stampó
    // manuallyDispatched más arriba), PERO el state quedó PENDIENTE
    // — nadie tildó armado ni listo en el panel. Eso significa que
    // físicamente el paquete se fue del galpón sin pasar por la
    // verificación de armado del equipo. Es la señal que Marcos pidió
    // para no perder paquetes — la UI muestra un badge rojo en la tab
    // Despachadas y la cuenta en el chip de la tab.
    //
    // Marcos 2026-06-22: agregamos cutoff por createdAt para no
    // contaminar el contador con pedidos viejos donde el equipo
    // probablemente hizo el armado físicamente pero no tildó el
    // panel (la feature recién se shippeó 2026-06-20). Sin esto el
    // operador abría Despachadas y veía 1.045 badges retroactivos
    // que no son alertas útiles. .env knob para que Marcos pueda
    // moverlo si quiere ver más histórico o resetar.
    const sinArmarSinceIso = (process.env.LOGISTICA_SIN_ARMAR_SINCE_ISO || '2026-06-20T00:00:00Z').trim();
    const sinArmarCutoff = new Date(sinArmarSinceIso);
    const sinArmarCutoffMs = Number.isFinite(sinArmarCutoff.getTime()) ? sinArmarCutoff.getTime() : 0;
    for (const s of SECTION_ORDER) {
      for (const r of out.sections[s]) {
        if (!r.isDispatched || r.state !== 'PENDIENTE' || r.isCancelled) continue;
        const createdAtMs = r.createdAtIso ? new Date(r.createdAtIso).getTime() : 0;
        if (createdAtMs < sinArmarCutoffMs) continue;
        r.autoDispatchedWithoutArmado = true;
      }
    }

    // Marcos 2026-06-10: filter out rows the picker archived (the
    // "Eliminar canceladas" action stamps archivedAt on the
    // LogisticaArmado row). They live in the cancelled-orders module
    // — out of the daily panel.
    //
    // Marcos 2026-06-23: además, filtrar automáticamente cualquier
    // row que ya esté cancelado (isCancelled=true). Antes la fila
    // mostraba un badge CANCELADA pero seguía en el panel — Marcos
    // tenía que clickear manualmente "Eliminar canceladas" para
    // archivarlas, y mientras tanto los pickers seguían viendo
    // ordenes que ya no debían armar. Auto-hide elimina el ruido.
    // La fila sigue accesible desde el modulo de canceladas para
    // auditoria; solo se saca del flujo de armado.
    for (const s of SECTION_ORDER) {
      out.sections[s] = out.sections[s].filter(
        (r) => !(r as { _archived?: boolean })._archived && !r.isCancelled,
      );
      for (const r of out.sections[s]) {
        delete (r as { _archived?: boolean })._archived;
      }
    }

    // Marcos 2026-06-10: apply per-row manual section overrides
    // ("Mover a Retira Caseros" on ML no_shipping rows). We collect
    // the moves first, then splice so we don't mutate the array we're
    // iterating over. Validates that the override is a known section.
    const validSections = new Set<string>(SECTION_ORDER);
    const moves: Array<{ row: DailySectionRow; from: DailySection; to: DailySection }> = [];
    for (const s of SECTION_ORDER) {
      for (const r of out.sections[s]) {
        const override = (r as { _override?: string | null })._override;
        delete (r as { _override?: string | null })._override;
        if (override && override !== s && validSections.has(override)) {
          moves.push({ row: r, from: s, to: override as DailySection });
        }
      }
    }
    for (const { row, from, to } of moves) {
      out.sections[from] = out.sections[from].filter((r) => r !== row);
      out.sections[to].push(row);
    }

    // Bloque B item 3.11 — Marcos 2026-06-09: sort each section by
    // creation date desc (newest first). Cancelled rows stay sorted
    // along with the rest — the red badge already calls them out;
    // re-ordering would hide buyer-cancellations under the fold.
    for (const s of SECTION_ORDER) {
      out.sections[s].sort((a, b) => {
        if (!a.createdAtIso) return 1;
        if (!b.createdAtIso) return -1;
        return b.createdAtIso.localeCompare(a.createdAtIso);
      });
    }
    stamp('mergeArmado', tMerge);

    // Marcos 2026-06-30: stamp resolvedCarrier en cada row.
    // Cascade replica la regla del panel "Despachos por mensajería":
    //   flexCourier (operator pick) > Order.carrier > fallback
    //   condicional (Despachos Online SOLO si label es out-of-zone;
    //   CABA/GBA descriptors quedan Sin asignar hasta que el
    //   operador pique o se aplique el default-per-zona).
    const tCarrier = Date.now();
    const summaryByCarrier = new Map<string, { pending: number; listas: number }>();
    // Marcos 2026-06-30: RETIRA_CASEROS no es mensajería — es una
    // sección donde caen los pedidos que el comprador pasa a buscar
    // al local. Marcos: "recordá que retira caseros ya existe como
    // segmentación, sería simplemente que la orden vaya ahí". Esos
    // rows YA se ven en su sección; incluirlos en el chip strip de
    // mensajerías arriba del panel los cuenta doble como si fueran
    // laburo de courier — confunde el conteo real de despachos +
    // infla la proyección de "estimado a pagar". Excluir por
    // sección, no por resolvedCarrier — los 105 rows de hoy se
    // reparten entre 4 buckets distintos (Andreani 48, Servifibras
    // propio 40, ML 9, Sin asignar 8), filtrar por label pierde 65.
    const EXCLUDE_FROM_CARRIER_SUMMARY = new Set<DailySection>(['RETIRA_CASEROS']);
    for (const s of SECTION_ORDER) {
      for (const r of out.sections[s]) {
        // ML rows ya vienen rotulados Mercado Libre en _cliente_,
        // pero acá normalizamos por carrier explícito. PRFV /
        // Servifibras propio idem.
        let raw: string | null = r.flexCourier || null;
        if (!raw) {
          if (r.rowKey.startsWith('ml:')) raw = 'Mercado Libre';
          else if (r.rowKey.startsWith('prfv:')) raw = 'Servifibras propio';
          else raw = (r as { _carrier?: string | null })._carrier ?? null;
        }
        let resolved = normaliseCarrier(raw);
        resolved = applyOutsideZoneFallback({
          currentCarrier: resolved,
          rawCarrier: raw,
          shippingLabel: (r as { _carrier?: string | null })._carrier ?? null,
        });
        r.resolvedCarrier = resolved;
        delete (r as { _carrier?: string | null })._carrier;
        // Skip carrier summary contribution for section-managed rows.
        // La row sigue apareciendo en su sección con su chip
        // resolvedCarrier — solo no cuenta en el strip agregado.
        if (EXCLUDE_FROM_CARRIER_SUMMARY.has(s)) continue;
        const bucket = summaryByCarrier.get(resolved) ?? { pending: 0, listas: 0 };
        if (r.isDispatched) {
          // Despachadas — no entran al summary "pending" del día.
        } else if (r.state === 'LISTO') {
          bucket.listas += 1;
        } else {
          bucket.pending += 1;
        }
        summaryByCarrier.set(resolved, bucket);
      }
    }
    // Marcos 2026-06-30: avg-cost-per-package por mensajería para
    // proyectar el costo total del día. Las tarifas vienen por
    // (carrier, zone); como el aggregator no tiene zone resuelto
    // per-row, usamos el promedio de zonas como proxy. Match
    // case-insensitive (DispatchTariff almacena MAYÚSCULAS, el
    // normalise devuelve "JyJ" / "M2" / etc).
    const avgByCarrier = new Map<string, number>();
    if (this.dispatchTariff) {
      try {
        const tariffs = await this.dispatchTariff.listActive();
        const grouped = new Map<string, number[]>();
        for (const t of tariffs) {
          const key = normaliseCarrier(t.carrier);
          (grouped.get(key) ?? grouped.set(key, []).get(key))!.push(t.costPerPackage);
        }
        for (const [k, vs] of grouped) {
          if (vs.length > 0) avgByCarrier.set(k, vs.reduce((a, b) => a + b, 0) / vs.length);
        }
      } catch (err: any) {
        out.notes.push({ source: 'dispatch-tariffs', message: `cost projection skipped: ${err?.message ?? err}` });
      }
    }
    out.carrierSummary = Array.from(summaryByCarrier.entries())
      .map(([carrier, v]) => {
        const total = v.pending + v.listas;
        const perPack = avgByCarrier.get(carrier) ?? null;
        return {
          carrier,
          pending: v.pending,
          listas: v.listas,
          total,
          estimatedCostPerPackage: perPack !== null ? Math.round(perPack) : null,
          estimatedCostTotal: perPack !== null ? Math.round(perPack * total) : null,
        };
      })
      .filter((b) => b.total > 0)
      .sort((a, b) => b.total - a.total);
    stamp('carrierResolve', tCarrier);

    const totalMs = Date.now() - tAll;
    const rowsTotal = SECTION_ORDER.reduce((acc, s) => acc + out.sections[s].length, 0);
    this.logger.log(
      `aggregate timing date=${isoDay} total=${totalMs}ms rows=${rowsTotal} ${Object.entries(timings).map(([k, v]) => `${k}=${v}ms`).join(' ')}`,
    );

    return out;
  }

  // ─── Formatters ───────────────────────────────────────────────────

  private formatMlCliente(o: {
    id: string;
    buyerNickname: string | null;
    shippingId: string | null;
    shippingStatus: string | null;
  }): string {
    const name = o.buyerNickname || 'Comprador';
    const parts = [name, `#${o.id}`];
    if (o.shippingStatus) parts.push(`(${o.shippingStatus})`);
    return parts.join(' ');
  }

  /**
   * Bloque B item 3.5 — pack-grouped cliente label. Adds the pack
   * marker ("paquete N items") so the picker sees at a glance that
   * this row covers multiple underlying orders that ship in one
   * box. The base buyer + pack id are preserved.
   */
  private formatMlPackCliente(
    head: {
      id: string;
      buyerNickname: string | null;
      shippingId: string | null;
      shippingStatus: string | null;
      packId: string | null;
    },
    orderCount: number,
    itemCount: number,
  ): string {
    const name = head.buyerNickname || 'Comprador';
    const parts = [
      name,
      head.packId ? `pack #${head.packId}` : `#${head.id}`,
      `(${orderCount} orden${orderCount === 1 ? '' : 'es'} · ${itemCount} item${itemCount === 1 ? '' : 's'})`,
    ];
    if (head.shippingStatus) parts.push(`(${head.shippingStatus})`);
    return parts.join(' ');
  }

  /**
   * Pack-grouped producto column. Reuses the same alias logic as
   * `formatMlProducto` but operates over an already-flattened items
   * array so multiple orders' items appear together — "armadorAlias1
   * + 2 x armadorAlias2 + armadorAlias3" — exactly how Marcos's
   * Excel column D reads carts today.
   */
  private async formatMlProductoFromItems(
    items: Array<{ itemId: string; title: string; sku: string | null; quantity: number }>,
    aliasMap?: Map<string, { alias: string; warehouseLocation: string | null }>,
  ): Promise<string> {
    return this.formatMlProducto({ items }, aliasMap);
  }

  /**
   * Marcos 2026-06-29 (perf): el aggregator estaba haciendo 2 queries
   * Prisma por cada pack ML (uno para producto-string, otro para
   * items expandidos) × ~1200 packs = 2400 round-trips por load del
   * panel — pesaba ~12-20s del total. Esta función carga UNA sola
   * vez todos los SKUs del set y devuelve un map compartido que
   * formatMlProducto + expandMlItems usan para resolver alias sin
   * tocar la DB en el per-pack loop.
   */
  private async loadProductAliasMap(skus: string[]): Promise<Map<string, {
    alias: string;
    warehouseLocation: string | null;
  }>> {
    const map = new Map<string, { alias: string; warehouseLocation: string | null }>();
    const unique = Array.from(new Set(skus.filter((s) => !!s)));
    if (unique.length === 0) return map;
    try {
      const rows = await this.prisma.product.findMany({
        where: { sku: { in: unique } },
        select: { sku: true, armadorAlias: true, name: true, warehouseLocation: true },
      });
      for (const r of rows) {
        map.set(r.sku, {
          alias: r.armadorAlias || (r.name ?? '').slice(0, 40),
          warehouseLocation: r.warehouseLocation ?? null,
        });
      }
    } catch {
      /* DB issue — caller falls back to ML titles */
    }
    return map;
  }

  private async formatMlProducto(o: {
    items: Array<{ itemId: string; title: string; sku: string | null; quantity: number }>;
  }, aliasMap?: Map<string, { alias: string; warehouseLocation: string | null }>): Promise<string> {
    if (o.items.length === 0) return '';
    // Use the catalog `armadorAlias` per SKU when we have a matching
    // Product row in our DB (sync'd from TN). Falls back to the
    // shortened ML title when no match. Marcos 2026-06-29: ahora
    // recibe el aliasMap pre-cargado del caller — si está, evita la
    // Prisma query y solo lee del map. Si NO está (uso standalone),
    // hace la query como antes.
    if (!aliasMap) {
      const skus = o.items.map((it) => it.sku).filter((s): s is string => !!s);
      aliasMap = await this.loadProductAliasMap(skus);
    }
    return o.items
      .map((it) => {
        const aliasInfo = it.sku ? aliasMap!.get(it.sku) : null;
        const label = aliasInfo?.alias || (it.title ? it.title.slice(0, 40) : 'producto');
        return it.quantity > 1 ? `${it.quantity} x ${label}` : label;
      })
      .join(' + ');
  }

  private formatLocalCliente(o: {
    orderNumber: string;
    carrier: string | null;
    notes: string | null;
    contact?: { name: string | null } | null;
  }): string {
    const name = o.contact?.name?.trim() || 'Cliente';
    const parts = [`${name} #${o.orderNumber}`];
    if (o.carrier) parts.push(`/${o.carrier}`);
    if (o.notes) parts.push(`##${o.notes.slice(0, 50)}`);
    return parts.join(' ');
  }

  private async formatLocalProducto(o: { products: any }): Promise<string> {
    const items = Array.isArray(o.products) ? o.products : [];
    if (items.length === 0) return '';
    // products is a free Json bag — Marcos's existing OrderManagement
    // schema doesn't enforce a shape. We try a few common shapes
    // ({sku, name, quantity} | {productId, qty} | string) before
    // giving up to the bare JSON string.
    const skus: string[] = [];
    for (const p of items) {
      const sku = (typeof p === 'object' && (p?.sku || p?.SKU)) || null;
      if (sku) skus.push(String(sku));
    }
    let aliasMap: Map<string, string> = new Map();
    if (skus.length > 0) {
      try {
        const rows = await this.prisma.product.findMany({
          where: { sku: { in: skus } },
          select: { sku: true, armadorAlias: true, name: true },
        });
        for (const r of rows) {
          aliasMap.set(r.sku, r.armadorAlias || (r.name ?? '').slice(0, 40));
        }
      } catch {
        /* non-fatal */
      }
    }
    return items
      .map((p: any) => {
        if (typeof p === 'string') return p.slice(0, 40);
        if (typeof p !== 'object' || !p) return 'item';
        const sku = (p?.sku || p?.SKU) ? String(p.sku || p.SKU) : null;
        const aliasFromSku = sku ? aliasMap.get(sku) : null;
        const qty = Number(p?.quantity ?? p?.qty ?? 1) || 1;
        const label =
          aliasFromSku ||
          (typeof p?.name === 'string' && p.name.slice(0, 40)) ||
          (typeof p?.title === 'string' && p.title.slice(0, 40)) ||
          (sku ?? 'item');
        return qty > 1 ? `${qty} x ${label}` : label;
      })
      .join(' + ');
  }

  /**
   * Bloque B item 2 — Marcos 2026-06-07 PM: build the itemised list
   * the in-CRM expand-in-place panel renders. ML orders carry items
   * with sku + title + quantity + unit_price; we layer the
   * `armadorAlias` from the catalog on top so the picker sees the
   * same shorthand they're used to in the Excel column D.
   */

  /**
   * Marcos 2026-06-10: hydrate the post-venta unread flag on every
   * ML row that's currently in the pendientes view. The check hits
   * `fetchPostVentaMessage(packId, cuenta)` which returns non-null
   * iff there's a buyer message awaiting reply. Results are cached
   * in-process for `LOGISTICA_UNREAD_CACHE_TTL_SECONDS` so cross-tab
   * navigation reuses the lookup.
   */
  private unreadCache = new Map<string, { hasUnread: boolean; expiresAt: number }>();
  private async hydrateMlUnreadFlags(out: AggregatedDay): Promise<void> {
    if (!this.mercadolibre) return;
    const ttlMs =
      (Number(process.env.LOGISTICA_UNREAD_CACHE_TTL_SECONDS) || 120) * 1000;
    const concurrency =
      Number(process.env.LOGISTICA_UNREAD_LOOKUP_CONCURRENCY) || 8;
    type Target = {
      packOrOrderId: string;
      accountKey: 'mercadolibre' | 'mercadolibre_cuenta2';
      row: DailySectionRow;
    };
    const targets: Target[] = [];
    const now = Date.now();
    for (const section of SECTION_ORDER) {
      for (const row of out.sections[section]) {
        if (row.source !== 'ML_CUENTA_1' && row.source !== 'ML_CUENTA_2') continue;
        if (row.isDispatched || row.isCancelled) continue;
        const accountKey: 'mercadolibre' | 'mercadolibre_cuenta2' =
          row.source === 'ML_CUENTA_2' ? 'mercadolibre_cuenta2' : 'mercadolibre';
        const id = String(row.sourceId);
        const cacheKey = `${accountKey}:${id}`;
        const cached = this.unreadCache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
          row.hasUnreadMessage = cached.hasUnread;
          continue;
        }
        targets.push({ packOrOrderId: id, accountKey, row });
      }
    }
    if (targets.length === 0) return;
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const t = targets[cursor++];
        try {
          const hasUnread = await this.mercadolibre!.hasUnreadPostVenta(
            t.packOrOrderId,
            t.accountKey,
          );
          t.row.hasUnreadMessage = hasUnread;
          this.unreadCache.set(`${t.accountKey}:${t.packOrOrderId}`, {
            hasUnread,
            expiresAt: Date.now() + ttlMs,
          });
        } catch {
          // non-fatal — leave hasUnreadMessage at its initial value
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()),
    );
  }

  private async expandMlItems(
    items: Array<{
      itemId: string;
      title: string;
      sku: string | null;
      quantity: number;
      unitPrice: number | null;
    }>,
    sharedAliasMap?: Map<string, { alias: string; warehouseLocation: string | null }>,
  ): Promise<DailySectionRow['items']> {
    if (!Array.isArray(items) || items.length === 0) return [];
    // Marcos 2026-06-29 (perf): si el caller pre-cargó el aliasMap
    // compartido para toda la batch (común desde processCuenta),
    // usamos eso y skipeamos la query. Si NO está, fall back a la
    // query per-pack del comportamiento original (preserva uso
    // standalone). Antes este path tiraba ~1200 queries por load.
    const aliasMap = sharedAliasMap
      ?? (await this.loadProductAliasMap(items.map((it) => it.sku).filter((s): s is string => !!s)));
    const mapped = items.map((it) => {
      const info = it.sku ? aliasMap.get(it.sku) ?? null : null;
      return {
        sku: it.sku,
        name: it.title || (it.sku ?? 'producto'),
        quantity: it.quantity,
        alias: info?.alias ?? null,
        imageUrl: null,
        unitPrice: it.unitPrice ?? null,
        warehouseLocation: info?.warehouseLocation ?? null,
      };
    });
    // Marcos 2026-06-30: ML /packs/{id} devuelve los items en orden
    // NO-determinístico entre requests. Eso hace que el índice del
    // item en el array (que se usa como parte de la key
    // <sku>:<idx> en itemsChecked) drift entre loads del panel, y
    // la key stampeada al tildar deja de matchear la posición
    // actual del item — bug del pack #2000013761318639 (5/5 en base
    // pero panel mostraba 1/5 en un tab y 3/5 en otro). Sort
    // determinístico acá elimina la fuente del drift; el reader
    // tolerante en el frontend (74a95f7) queda como safety net
    // para datos históricos.
    return sortItemsStable(mapped);
  }

  /**
   * Same idea for CRM (WhatsApp / mayorista) orders. `products` is a
   * free-shape Json bag on the Order row, so we tolerate a handful of
   * known shapes ({sku, name, quantity} | string | etc.) and layer
   * the alias on whichever SKUs we can recognise.
   */
  private async expandLocalItems(products: any): Promise<DailySectionRow['items']> {
    const items = Array.isArray(products) ? products : [];
    if (items.length === 0) return [];
    const skus: string[] = [];
    for (const p of items) {
      const sku = (typeof p === 'object' && (p?.sku || p?.SKU)) || null;
      if (sku) skus.push(String(sku));
    }
    const aliasMap = new Map<string, string>();
    const locationMap = new Map<string, string>();
    if (skus.length > 0) {
      try {
        const rows = await this.prisma.product.findMany({
          where: { sku: { in: skus } },
          select: { sku: true, armadorAlias: true, name: true, warehouseLocation: true },
        });
        for (const r of rows) {
          aliasMap.set(r.sku, r.armadorAlias || (r.name ?? '').slice(0, 40));
          if (r.warehouseLocation) locationMap.set(r.sku, r.warehouseLocation);
        }
      } catch {
        /* non-fatal */
      }
    }
    const mapped = items.map((p: any) => {
      if (typeof p === 'string') {
        return { sku: null, name: p, quantity: 1, alias: null, imageUrl: null, unitPrice: null, warehouseLocation: null };
      }
      if (typeof p !== 'object' || !p) {
        return { sku: null, name: 'item', quantity: 1, alias: null, imageUrl: null, unitPrice: null, warehouseLocation: null };
      }
      const sku = (p?.sku || p?.SKU) ? String(p.sku || p.SKU) : null;
      const qty = Number(p?.quantity ?? p?.qty ?? 1) || 1;
      const name =
        (typeof p?.name === 'string' && p.name) ||
        (typeof p?.title === 'string' && p.title) ||
        (sku ?? 'item');
      const unitPrice =
        typeof p?.unitPrice === 'number'
          ? p.unitPrice
          : typeof p?.price === 'number'
            ? p.price
            : null;
      return {
        sku,
        name,
        quantity: qty,
        alias: sku ? (aliasMap.get(sku) ?? null) : null,
        imageUrl: typeof p?.imageUrl === 'string' ? p.imageUrl : null,
        unitPrice,
        warehouseLocation: sku ? (locationMap.get(sku) ?? null) : null,
      };
    });
    // Marcos 2026-06-30: same stable-sort discipline as expandMlItems
    // — mantenemos orden determinístico entre requests para que las
    // keys <sku>:<idx> de itemsChecked no drifteen.
    return sortItemsStable(mapped);
  }
}

/**
 * Marcos 2026-06-30: stable ordering para items dentro de un pack —
 * ordena por SKU asc (items con SKU primero, alfabéticos), luego
 * por name asc (items sin SKU al final). Determinístico entre
 * requests, así el índice del item en el array se mantiene estable
 * y las keys stampeadas en itemsChecked siguen matcheando la
 * posición actual en la próxima carga del panel.
 */
function sortItemsStable<T extends { sku: string | null; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aHas = !!(a.sku && a.sku.length > 0);
    const bHas = !!(b.sku && b.sku.length > 0);
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    if (aHas && bHas) {
      const cmp = a.sku!.localeCompare(b.sku!);
      if (cmp !== 0) return cmp;
    }
    return a.name.localeCompare(b.name);
  });
}
