/**
 * ADAPTERS LAYER — Shared carrier + zone cascade for the logística
 * panels. Marcos 2026-08-19 (Ustym report Frente D1): las tarjetas de
 * "Logística diaria" (daily-logistica-aggregator) y de "Despachos por
 * mensajería" (analytics) hacían resolución de mensajería con reglas
 * diferentes — el mismo paquete quedaba "Sin asignar" en un panel y
 * atribuido a una mensajería concreta en el otro. Este módulo es la
 * cascada única que ambos consumen para que el resultado sea el mismo.
 *
 * Cascada (en orden de prioridad):
 *   1) rawCarrier normalizado por CarrierAliasMap        (flexCourier + Order.carrier)
 *   2) source+zone default                                (D0: TN + AMBA → JYJ)
 *   3) cp/localidad → PostalCodeZone.defaultCarrier
 *   4) zone-majority default                              (getDefaultCarrierForZone)
 *   5) applyOutsideZoneFallback                           (Despachos Online out-of-zone)
 *   6) "Sin asignar"
 *
 * También devuelve la zona resuelta (label TN → CP/localidad → provincia
 * → shippingZone raw), así el aggregator puede reemplazar el promedio
 * de tarifas por la tarifa real (carrier, zone).
 */

import type { PostalCodeZoneService, ZoneCache } from './postal-code-zone.service';
import {
  normaliseCarrier,
  applyOutsideZoneFallback,
  type CarrierAliasMap,
} from './carrier-normalize.util';

/** Grafía de la zona canonical para hacer keys de defaults por source. */
function normalizeZoneKey(zone: string | null): string | null {
  if (!zone) return null;
  const s = zone.replace(/\s+/g, '').toUpperCase();
  return s.length > 0 ? s : null;
}

export interface CarrierResolverInput {
  /** flexCourier del operador o Order.carrier (whatever la caller
   *  quiera priorizar). Puede ser null. */
  rawCarrier: string | null;
  /** Etiqueta cruda del método TN/ML (ej. "GBA 1 GRATIS", "CABA
   *  GRATUITO", "DESPACHO A TERMINAL DE MICRO"). */
  shippingLabel: string | null;
  cp: string | null;
  locality: string | null;
  /** `Order.shippingZone`, que hoy contiene la provincia (Marcos
   *  2026-08-19 flag D4). */
  shippingZone: string | null;
  /** Fuente del pedido — 'TIENDANUBE', 'MERCADOLIBRE', 'MANUAL',
   *  'PRFV', etc. Usada para el paso 2 de la cascada (defaults por
   *  source+zone). Null → salteamos el paso. */
  source?: string | null;
}

export interface CarrierResolverContext {
  aliases: CarrierAliasMap | undefined;
  postalZones: PostalCodeZoneService | null;
  cpZoneCache: ZoneCache | null;
  /** Map de "SOURCE:ZONA" → mensajería default. Ej. TIENDANUBE:CABA
   *  → JyJ. Usar `carrier-defaults.service` para hidratarlo. Null →
   *  salteamos ese paso. */
  sourceZoneDefaults?: Map<string, string> | null;
}

export type CarrierResolveSource =
  | 'rawCarrier'
  | 'sourceZoneDefault'
  | 'cpDefault'
  | 'zoneDefault'
  | 'outsideZoneFallback'
  | 'unassigned';

export interface CarrierResolverResult {
  /** Nombre canonical de la mensajería (post alias + normalise) o
   *  "Sin asignar". */
  carrier: string;
  /** Zona resuelta (CABA / GBA 1/2/3 / Interior (micro) / Nacional /
   *  ...). Null si no pudimos derivar ninguna. */
  zone: string | null;
  /** Qué paso de la cascada resolvió el carrier — útil para el
   *  panel de auditoría y para logs. */
  source: CarrierResolveSource;
}

/**
 * Deriva la zona de courier del label crudo TN/ML. TN labels típicos:
 *   "CABA GRATUITO", "GBA 1 GRATIS (15hs a 21hs)", "GBA 3", "Tarifa
 *   Nacional encomienda a terminal", "Despacho a terminal de micro".
 * Devuelve null cuando el label no tiene pista de zona (ej. "JyJ" a
 * secas, ya normalizado por el operador).
 */
export function deriveZoneFromShippingLabel(raw: string | null | undefined): string | null {
  const lc = (raw ?? '').trim().toLowerCase();
  if (!lc) return null;
  if (/\bgba\s*1\b/.test(lc)) return 'GBA 1';
  if (/\bgba\s*2\b/.test(lc)) return 'GBA 2';
  if (/\bgba\s*3\b/.test(lc)) return 'GBA 3';
  if (/\bcaba\b/.test(lc)) return 'CABA';
  if (/tarifa\s+nacional\s+gran\s*tama/.test(lc)) return 'Nacional Gran Tamaño';
  if (/tarifa\s+nacional/.test(lc)) return 'Nacional';
  if (/despacho\s+a?\s*terminal/.test(lc) || /\bmicro\b/.test(lc)) return 'Interior (micro)';
  return null;
}

/**
 * Colapsa "Capital Federal" a CABA para el matching contra las tarifas.
 * "Buenos Aires" queda sin resolver porque abarca GBA 1/2/3 + Interior
 * y el operador tiene que picar.
 */
export function provinceToZone(province: string | null | undefined): string | null {
  const lc = (province ?? '').trim().toLowerCase();
  if (!lc) return null;
  if (/^(capital federal|caba|c\.a\.b\.a\.?)$/.test(lc)) return 'CABA';
  return null;
}

/**
 * Cascada única de carrier + zone. Ambos paneles (Logística diaria +
 * Despachos analytics) llaman esto para que la mensajería/zona por fila
 * sea consistente.
 */
export function resolveCarrierAndZone(
  input: CarrierResolverInput,
  ctx: CarrierResolverContext,
): CarrierResolverResult {
  // Zona — se resuelve siempre (aunque el carrier ya venga picked)
  // porque el aggregator la necesita para elegir tarifa exacta y
  // porque los defaults por source usan zona.
  const postalResolved =
    ctx.postalZones && ctx.cpZoneCache
      ? ctx.postalZones.resolveZone(
          { locality: input.locality, cp: input.cp },
          ctx.cpZoneCache,
        )
      : null;
  const zone =
    deriveZoneFromShippingLabel(input.shippingLabel) ??
    deriveZoneFromShippingLabel(input.rawCarrier) ??
    (postalResolved && postalResolved.zone ? postalResolved.zone : null) ??
    provinceToZone(input.shippingZone) ??
    (typeof input.shippingZone === 'string' && input.shippingZone.length > 0
      ? input.shippingZone
      : null);

  // Paso 1: normalizar rawCarrier (flexCourier / Order.carrier / ML tag).
  let carrier = normaliseCarrier(input.rawCarrier, ctx.aliases);
  let resolveSource: CarrierResolveSource =
    carrier === 'Sin asignar' ? 'unassigned' : 'rawCarrier';

  // Paso 2: source+zone default (Marcos 2026-08-19 Frente D0: TN + AMBA → JYJ).
  if (carrier === 'Sin asignar' && input.source && zone && ctx.sourceZoneDefaults) {
    const zk = normalizeZoneKey(zone);
    if (zk) {
      const key = `${input.source.toUpperCase()}:${zk}`;
      const def = ctx.sourceZoneDefaults.get(key);
      if (def) {
        carrier = normaliseCarrier(def, ctx.aliases);
        if (carrier !== 'Sin asignar') resolveSource = 'sourceZoneDefault';
      }
    }
  }

  // Paso 3: cp/localidad default (defaultCarrier del row de postal_code_zones).
  if (
    carrier === 'Sin asignar' &&
    postalResolved &&
    postalResolved.defaultCarrier
  ) {
    carrier = normaliseCarrier(postalResolved.defaultCarrier, ctx.aliases);
    if (carrier !== 'Sin asignar') resolveSource = 'cpDefault';
  }

  // Paso 4: zone-majority default.
  if (
    carrier === 'Sin asignar' &&
    zone &&
    ctx.postalZones &&
    ctx.cpZoneCache
  ) {
    const zd = ctx.postalZones.getDefaultCarrierForZone(zone, ctx.cpZoneCache);
    if (zd) {
      carrier = normaliseCarrier(zd, ctx.aliases);
      if (carrier !== 'Sin asignar') resolveSource = 'zoneDefault';
    }
  }

  // Paso 5: outside-zone fallback (Despachos Online — sólo si el label
  // sugiere out-of-zone; CABA/GBA1-3 in-zone quedan "Sin asignar").
  const afterOutside = normaliseCarrier(
    applyOutsideZoneFallback({
      currentCarrier: carrier,
      rawCarrier: input.rawCarrier,
      shippingLabel: input.shippingLabel,
    }),
    ctx.aliases,
  );
  if (afterOutside !== carrier) {
    carrier = afterOutside;
    if (carrier !== 'Sin asignar') resolveSource = 'outsideZoneFallback';
  }

  return {
    carrier,
    zone,
    source: carrier === 'Sin asignar' ? 'unassigned' : resolveSource,
  };
}
