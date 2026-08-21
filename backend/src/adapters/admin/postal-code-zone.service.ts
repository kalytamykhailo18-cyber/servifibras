/**
 * ADAPTERS LAYER — localidad+CP → zona del courier.
 *
 * Marcos 2026-06-22 (revised spec): cuando un envio TN llega con un
 * label custom que no trae zona embebida, derivamos zona desde la
 * direccion del comprador. La cadena de resolucion es:
 *
 *   1) localidad exacta (case-insensitive)
 *   2) localidad normalizada (sin tildes + lowercase + un espacio)
 *   3) CP (4 digitos)
 *   4) default config (env LOGISTICA_DEFAULT_ZONE)
 *
 * Si (1)/(2) y (3) devuelven zonas distintas, gana la mas cara segun
 * el tier ordering del env LOGISTICA_ZONE_TIER_ORDER (default
 * 'CABA,GBA1,GBA2,GBA3,Nacional' — ascendente por precio).
 *
 * Marcos's reasoning: el CP argentino de 4 digitos es impreciso —
 * varios CPs comparten codigo entre localidades de distinto precio
 * (ej. 1768 cubre Almirante Brown + La Matanza, distinta tarifa).
 * Solo-CP cobraba mal en esos casos. Ahora la localidad es el
 * matcher primario y el CP es validacion/fallback.
 *
 * Range CPs (formato 'NNNN-NNNN') se expanden en applyMapping a una
 * fila por CP individual asi el lookup queda O(1) por hash. CABA
 * llega como '1000-1499' (500 filas en DB despues del import).
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient, PostalCodeZone } from '@prisma/client';
import * as XLSX from 'xlsx';

export interface PostalCodeZoneUploadResult {
  parsedRows: number;
  expandedRows: number;
  inserted: number;
  updated: number;
  unchanged: number;
  invalid: number;
  /** Top 10 filas rechazadas — para que Marcos pueda corregir el archivo. */
  invalidSamples: Array<{ rowIndex: number; reason: string }>;
}

export interface ResolverInput {
  locality?: string | null;
  cp?: string | null;
}

export type ResolverSource = 'locality_exact' | 'locality_normalized' | 'cp' | 'default' | 'none';

export interface ResolverResult {
  zone: string | null;
  locality: string | null;
  source: ResolverSource;
  /**
   * Marcos 2026-06-29: la fila resuelta (si la hay) trae también la
   * mensajería default cargada por el admin. El analytics service
   * (Despachos por mensajería) la usa como fallback antes de mandar
   * filas a "Sin asignar" — flexCourier del operador > source carrier
   * conocido > defaultCarrier del mapping CP/localidad > "Sin asignar".
   */
  defaultCarrier: string | null;
}

export interface ZoneCache {
  byLocalityExact: Map<string, PostalCodeZone>;
  byLocalityNormalized: Map<string, PostalCodeZone>;
  byCp: Map<string, PostalCodeZone>;
  /**
   * Marcos 2026-06-29: zone → mensajería default (resuelto por
   * majority vote sobre las filas con defaultCarrier seteado de esa
   * zona). El analytics service lo usa en la cascada cuando el
   * resolveZone por CP/localidad no devolvió hit (común para TN
   * orders sin postalCode en contact.metadata).
   */
  defaultCarrierByZone: Map<string, string>;
}

/** Normalizacion canonica para CPs — uppercase + sin guiones/espacios. */
function normaliseCp(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase().replace(/[\s\-]/g, '');
  return s.length > 0 ? s : null;
}

/** Normalizacion para locality — lowercase + sin tildes + un espacio. */
function normaliseLocality(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > 0 ? s : null;
}

/**
 * Si `raw` es un range del estilo '1000-1499' devuelve la lista de
 * todos los CPs entre los extremos (inclusive). Sino devuelve null.
 * Rangos con > 1000 elementos se rechazan para evitar bombas de
 * datos por error de tipeo (ej. '1-9999').
 */
function expandCpRange(raw: string): string[] | null {
  const m = /^(\d{3,5})\s*-\s*(\d{3,5})$/.exec(raw.trim());
  if (!m) return null;
  const from = Number(m[1]);
  const to = Number(m[2]);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  if (to - from > 1000) return null;
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(String(i));
  return out;
}

@Injectable()
export class PostalCodeZoneService {
  private readonly logger = new Logger(PostalCodeZoneService.name);
  private readonly prisma: PrismaClient;

  constructor(
    @Optional() prismaShared?: import('../repositories/prisma.service').PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  /**
   * Marcos 2026-06-22: tier ordering del env. Cualquier zona no
   * listada queda con tier=0 (fallback prioridad mas baja). El
   * resolver pickea el tier MAS ALTO cuando hay multiples hits.
   */
  private zoneTier(zone: string): number {
    const order = (process.env.LOGISTICA_ZONE_TIER_ORDER || 'CABA,GBA1,GBA2,GBA3,Nacional')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const idx = order.indexOf(zone.trim().toUpperCase());
    return idx >= 0 ? idx + 1 : 0;
  }

  /** Zona default cuando nada matchea. null si no esta configurada. */
  private defaultZone(): string | null {
    const raw = (process.env.LOGISTICA_DEFAULT_ZONE || '').trim();
    return raw.length > 0 ? raw : null;
  }

  /**
   * Parsea el workbook (XLSX o CSV-as-XLSX). Devuelve filas
   * (cp, locality, zone, province?). NO expande ranges aca — eso
   * pasa en applyMapping para que el resumen muestre 'parsedRows: 133'
   * + 'expandedRows: 632' separadamente.
   */
  parseBuffer(buf: Buffer): {
    rows: Array<{ cp: string; locality: string; zone: string; province: string | null; defaultCarrier: string | null }>;
    invalid: Array<{ rowIndex: number; reason: string }>;
  } {
    const wb = XLSX.read(buf, { type: 'buffer', codepage: 65001 });
    const firstSheet = wb.SheetNames[0];
    if (!firstSheet) throw new Error('workbook has no sheets');
    const ws = wb.Sheets[firstSheet];
    const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
    if (grid.length < 2) throw new Error('expected at least a header row + one data row');
    const headers = grid[0].map((c) => String(c ?? '').trim().toLowerCase());
    const cpCol = headers.findIndex((h) => h === 'cp' || h === 'codigo postal' || h === 'código postal' || h === 'zip' || h === 'zipcode');
    const zoneCol = headers.findIndex((h) => h === 'zona' || h === 'zone');
    const locCol = headers.findIndex((h) => h === 'localidad' || h === 'locality' || h === 'ciudad' || h === 'partido');
    const provCol = headers.findIndex((h) => h === 'provincia' || h === 'province' || h === 'estado');
    // Marcos 2026-06-29: columna opcional para el default mensajería
    // por CP/localidad. El analytics lo usa como fallback cuando el
    // operador no setea manualmente el courier en /logistica-diaria.
    const carrierCol = headers.findIndex((h) => h === 'mensajeria' || h === 'mensajería' || h === 'carrier' || h === 'courier');
    if (cpCol < 0 || zoneCol < 0 || locCol < 0) {
      throw new Error(`columnas minimas (localidad, cp, zona) no encontradas — headers leidos: ${headers.join(', ')}`);
    }

    const rows: Array<{ cp: string; locality: string; zone: string; province: string | null; defaultCarrier: string | null }> = [];
    const invalid: Array<{ rowIndex: number; reason: string }> = [];
    for (let i = 1; i < grid.length; i++) {
      const r = grid[i];
      const cpRaw = String(r[cpCol] ?? '').trim();
      const locality = String(r[locCol] ?? '').trim();
      const zone = String(r[zoneCol] ?? '').trim();
      if (!locality) { invalid.push({ rowIndex: i + 1, reason: 'Localidad vacia' }); continue; }
      if (!cpRaw) { invalid.push({ rowIndex: i + 1, reason: `${locality} sin CP asignado` }); continue; }
      if (!zone) { invalid.push({ rowIndex: i + 1, reason: `${locality} (${cpRaw}) sin zona asignada` }); continue; }
      const defaultCarrier = carrierCol >= 0
        ? (String(r[carrierCol] ?? '').trim().slice(0, 60) || null)
        : null;
      rows.push({
        cp: cpRaw,
        locality: locality.slice(0, 120),
        zone: zone.slice(0, 40),
        province: provCol >= 0 ? (String(r[provCol] ?? '').trim().slice(0, 120) || null) : null,
        defaultCarrier,
      });
    }
    return { rows, invalid };
  }

  /**
   * Wipe + reload del mapping completo. Marcos siempre carga el
   * archivo entero (no patches), asi que la operacion es atomica:
   * DELETE all → INSERT expanded. Si el insert falla a mitad, la
   * transaccion roll-back y el panel sigue con el mapping anterior.
   */
  async applyMapping(
    rows: Array<{ cp: string; locality: string; zone: string; province: string | null; defaultCarrier?: string | null }>,
    invalid: Array<{ rowIndex: number; reason: string }> = [],
  ): Promise<PostalCodeZoneUploadResult> {
    const result: PostalCodeZoneUploadResult = {
      parsedRows: rows.length + invalid.length,
      expandedRows: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      invalid: invalid.length,
      invalidSamples: invalid.slice(0, 10),
    };
    if (rows.length === 0) return result;

    // Expandir ranges. CABA = '1000-1499' → 500 filas. Cada fila
    // resultante hereda locality + zone + province del row origen.
    type ExpandedRow = { cp: string; locality: string; localityNormalized: string; zone: string; province: string | null; defaultCarrier: string | null };
    const expanded: ExpandedRow[] = [];
    const seen = new Set<string>(); // (cp, localityNormalized) dedup
    for (const r of rows) {
      const localityNormalized = normaliseLocality(r.locality);
      if (!localityNormalized) {
        result.invalid++;
        result.invalidSamples.push({ rowIndex: -1, reason: `locality '${r.locality}' no normalizable` });
        continue;
      }
      const cps = expandCpRange(r.cp) ?? [normaliseCp(r.cp) ?? r.cp];
      for (const cp of cps) {
        const key = `${cp}|${localityNormalized}`;
        if (seen.has(key)) continue;
        seen.add(key);
        expanded.push({
          cp,
          locality: r.locality,
          localityNormalized,
          zone: r.zone,
          province: r.province,
          defaultCarrier: r.defaultCarrier ?? null,
        });
      }
    }
    result.expandedRows = expanded.length;

    // Wipe + bulk insert en transaccion. Si algo falla, el panel
    // sigue funcionando con el mapping previo.
    await this.prisma.$transaction(async (tx) => {
      await tx.postalCodeZone.deleteMany({});
      // createMany es 1 round-trip para todos. ~600 filas entran
      // bien en un solo INSERT.
      await tx.postalCodeZone.createMany({
        data: expanded.map((e) => ({
          cp: e.cp,
          locality: e.locality,
          localityNormalized: e.localityNormalized,
          zone: e.zone,
          province: e.province,
          defaultCarrier: e.defaultCarrier,
          active: true,
        })),
        skipDuplicates: true,
      });
    });
    result.inserted = expanded.length;

    this.logger.log(
      `postal-code-zones reloaded: parsed=${result.parsedRows} expanded=${result.expandedRows} ` +
      `inserted=${result.inserted} invalid=${result.invalid}`,
    );
    return result;
  }

  /**
   * Pre-carga TODO el mapping en tres mapas indexados para que el
   * resolver no haga round-trips. Llamala 1x por request en el
   * caller (analytics aggregator).
   */
  async loadCache(): Promise<ZoneCache> {
    const rows = await this.prisma.postalCodeZone.findMany({ where: { active: true } });
    const cache: ZoneCache = {
      byLocalityExact: new Map(),
      byLocalityNormalized: new Map(),
      byCp: new Map(),
      defaultCarrierByZone: new Map(),
    };
    // Marcos 2026-06-29: agregamos un mapa zone → defaultCarrier
    // derivado del set de filas. Usamos majority vote por zona —
    // si el admin marcó "CABA → JyJ" en la mayoría de las CABA rows
    // (esperado uso normal: bulk upload con la columna mensajeria
    // poblada uniformemente), gana JyJ. Si hay empate o vacío, no
    // hay default y los packs sin metadata caen en "Sin asignar"
    // como antes.
    const tally = new Map<string, Map<string, number>>(); // zone → carrier → count
    for (const r of rows) {
      const exactKey = r.locality.toLowerCase().trim();
      cache.byLocalityExact.set(exactKey, r);
      cache.byLocalityNormalized.set(r.localityNormalized, r);
      const existing = cache.byCp.get(r.cp);
      if (!existing || this.zoneTier(r.zone) > this.zoneTier(existing.zone)) {
        cache.byCp.set(r.cp, r);
      }
      const dc = (r as any).defaultCarrier as string | null | undefined;
      if (dc && dc.trim().length > 0) {
        const zoneKey = r.zone;
        const carrierKey = dc.trim();
        const inner = tally.get(zoneKey) ?? new Map<string, number>();
        inner.set(carrierKey, (inner.get(carrierKey) ?? 0) + 1);
        tally.set(zoneKey, inner);
      }
    }
    for (const [zone, inner] of tally) {
      let bestCarrier: string | null = null;
      let bestCount = 0;
      for (const [carrier, count] of inner) {
        if (count > bestCount) { bestCarrier = carrier; bestCount = count; }
      }
      if (bestCarrier) {
        // Marcos 2026-06-29: normalizamos la clave (sin espacios,
        // uppercase) porque el zone derivado del shipping-label TN
        // viene como "GBA 1 GRATIS" → "GBA 1" mientras que la DB
        // tiene "GBA1". El lookup en getDefaultCarrierForZone usa
        // la misma normalización.
        const normZone = zone.replace(/\s+/g, '').toUpperCase();
        cache.defaultCarrierByZone.set(normZone, bestCarrier);
      }
    }
    return cache;
  }

  /**
   * Marcos 2026-06-29: lookup zone → mensajería default. Devuelve el
   * carrier que está marcado como default en la mayoría de las filas
   * de esa zona. Null cuando no hay default cargado o cuando la
   * zona es desconocida. Lo usa el analytics para rellenar "Sin
   * asignar" cuando ni flexCourier ni source carrier resolvieron.
   */
  getDefaultCarrierForZone(zone: string, cache: ZoneCache): string | null {
    if (!zone) return null;
    const normZone = zone.replace(/\s+/g, '').toUpperCase();
    return cache.defaultCarrierByZone.get(normZone) ?? null;
  }

  /**
   * Cascada: locality_exact → locality_normalized → cp → default.
   * Cuando varios paths matchean, gana la zona de tier mas alto.
   */
  resolveZone(input: ResolverInput, cache: ZoneCache): ResolverResult {
    const hits: Array<{ row: PostalCodeZone; source: ResolverSource }> = [];

    if (input.locality && input.locality.trim().length > 0) {
      const exactKey = input.locality.trim().toLowerCase();
      const exact = cache.byLocalityExact.get(exactKey);
      if (exact) hits.push({ row: exact, source: 'locality_exact' });

      const normKey = normaliseLocality(input.locality);
      if (normKey) {
        const norm = cache.byLocalityNormalized.get(normKey);
        if (norm && (!exact || norm.id !== exact.id)) {
          hits.push({ row: norm, source: 'locality_normalized' });
        }
      }
    }
    if (input.cp) {
      const cpKey = normaliseCp(input.cp);
      if (cpKey) {
        const cpHit = cache.byCp.get(cpKey);
        if (cpHit && !hits.some((h) => h.row.id === cpHit.id)) {
          hits.push({ row: cpHit, source: 'cp' });
        }
      }
    }

    if (hits.length === 0) {
      const def = this.defaultZone();
      return def
        ? { zone: def, locality: null, source: 'default', defaultCarrier: null }
        : { zone: null, locality: null, source: 'none', defaultCarrier: null };
    }

    // Tie-break: tier mas alto gana. En caso de empate, gana
    // locality_exact > locality_normalized > cp (orden de insercion).
    hits.sort((a, b) => {
      const ta = this.zoneTier(a.row.zone);
      const tb = this.zoneTier(b.row.zone);
      if (tb !== ta) return tb - ta;
      const sourceOrder: Record<ResolverSource, number> = {
        locality_exact: 0,
        locality_normalized: 1,
        cp: 2,
        default: 3,
        none: 4,
      };
      return sourceOrder[a.source] - sourceOrder[b.source];
    });
    const winner = hits[0];
    return {
      zone: winner.row.zone,
      locality: winner.row.locality,
      source: winner.source,
      defaultCarrier: (winner.row as any).defaultCarrier ?? null,
    };
  }

  /** Lookup async on-demand — para callers fuera del aggregator. */
  async resolveZoneAsync(input: ResolverInput): Promise<ResolverResult> {
    const cache = await this.loadCache();
    return this.resolveZone(input, cache);
  }

  /** Lista para el admin panel. Default 200 filas (operador
   *  raramente necesita scrollear las 600+ expandidas). */
  async list(opts?: { activeOnly?: boolean; limit?: number }): Promise<PostalCodeZone[]> {
    return this.prisma.postalCodeZone.findMany({
      where: opts?.activeOnly ? { active: true } : undefined,
      orderBy: [{ zone: 'asc' }, { locality: 'asc' }, { cp: 'asc' }],
      take: opts?.limit ? Math.max(1, Math.min(5000, opts.limit)) : 200,
    });
  }

  async stats(): Promise<{ total: number; byZone: Array<{ zone: string; count: number }> }> {
    const total = await this.prisma.postalCodeZone.count({ where: { active: true } });
    const grouped = await this.prisma.postalCodeZone.groupBy({
      by: ['zone'],
      where: { active: true },
      _count: { _all: true },
    });
    return {
      total,
      byZone: grouped
        .map((g) => ({ zone: g.zone, count: g._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /**
   * Marcos 2026-06-30: minar el histórico de despachos (90d default)
   * para derivar el `defaultCarrier` más probable por zona basado en
   * lo que el equipo viene picando. El operator-pick history es la
   * fuente más fuerte porque refleja la decisión real (flexCourier
   * cuando hay; Order.carrier en su defecto). Resultado: una lista
   * de recomendaciones que el cascade del panel "Despachos por
   * mensajería" + Listas puede consumir sin que Marcos llene el
   * Excel a mano.
   *
   * Filtros configurables vía env (todos con defaults razonables):
   *   RECOMMEND_MIN_SAMPLES (default 5) — N mínimo de picks por zona
   *   RECOMMEND_MIN_CONFIDENCE (default 0.60) — ratio del top sobre el total
   *   RECOMMEND_WINDOW_DAYS (default 90)
   *
   * Una zona con menos de min_samples o donde el top no supera el
   * umbral queda como "sin recomendación" — significa que la
   * operatoria es mixta y conviene que el operador siga picando
   * fila por fila.
   */
  async recommendZoneDefaults(): Promise<Array<{
    zone: string;
    recommendedCarrier: string;
    confidence: number;
    sampleSize: number;
    runnersUp: Array<{ carrier: string; count: number }>;
    currentDefault: string | null;
  }>> {
    const minSamples = (() => {
      const n = Number(process.env.RECOMMEND_MIN_SAMPLES);
      return Number.isFinite(n) && n > 0 ? n : 5;
    })();
    const minConfidence = (() => {
      const n = Number(process.env.RECOMMEND_MIN_CONFIDENCE);
      return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.60;
    })();
    const windowDays = (() => {
      const n = Number(process.env.RECOMMEND_WINDOW_DAYS);
      return Number.isFinite(n) && n > 0 ? n : 90;
    })();

    const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000);
    const stamps = await this.prisma.logisticaArmado.findMany({
      where: { manuallyDispatchedAt: { gte: since } },
      select: { rowKey: true, flexCourier: true },
    });

    // Carga lazy del normaliser para evitar import circular.
    const { normaliseCarrier } = await import('./carrier-normalize.util');
    // Marcos 2026-06-30: la cascade locality→CP solo va a empezar a
    // matchear cuando la sync de TN orders empiece a poblar el
    // postalCode/locality en contact.metadata (ver fix de la sync
    // separado en este mismo push). Por ahora la mayoría de los
    // contactos histórico tienen meta sólo con tiendanubeCustomerId,
    // así que la cascade cae a shippingZone literal. Cargamos el
    // cache igual — habilita el path GBA1/2/3 apenas haya CPs/
    // localidades populadas.
    const cache = await this.loadCache();

    const byZone = new Map<string, Map<string, number>>();
    for (const s of stamps) {
      if (!/^(tn|crm):/.test(s.rowKey)) continue;
      const id = s.rowKey.replace(/^(tn|crm):/, '');
      const o = await this.prisma.order.findFirst({
        where: { OR: [{ id }, { externalId: id }] },
        select: { carrier: true, shippingZone: true, contact: { select: { metadata: true } } },
      });
      if (!o) continue;
      const rawCarrier = s.flexCourier || o.carrier;
      if (!rawCarrier) continue;
      const carrier = normaliseCarrier(rawCarrier);
      if (carrier === 'Sin asignar') continue;
      // Cascade preferida: resolver via postal_code_zones (locality
      // exacto / normalizado / CP). Si no hay match, caemos al
      // shippingZone literal de Order (provincia); último recurso
      // CABA por prefijo C1XXX.
      let zone: string | null = null;
      const meta = (o.contact?.metadata ?? {}) as any;
      const locality = meta?.locality ?? meta?.localidad ?? meta?.city ?? meta?.ciudad ?? null;
      const cp = meta?.postalCode ?? meta?.cp ?? null;
      if (locality || cp) {
        const resolved = this.resolveZone(
          { locality: locality != null ? String(locality) : null, cp: cp != null ? String(cp) : null },
          cache,
        );
        if (resolved.zone) zone = resolved.zone.replace(/\s+/g, '').toUpperCase();
      }
      if (!zone && o.shippingZone) {
        zone = o.shippingZone.replace(/\s+/g, '').toUpperCase();
      }
      if (!zone && cp && /^C?1\d{3}/.test(String(cp))) {
        zone = 'CABA';
      }
      if (!zone) continue;
      const slot = byZone.get(zone) ?? new Map<string, number>();
      slot.set(carrier, (slot.get(carrier) ?? 0) + 1);
      byZone.set(zone, slot);
    }

    // Pull current postal_code_zones.defaultCarrier per zone (modal —
    // la zona puede tener filas con defaults divergentes si el admin
    // las cargó parcialmente; tomamos el más frecuente como referencia).
    const currentRows = await this.prisma.postalCodeZone.findMany({
      where: { defaultCarrier: { not: null } },
      select: { zone: true, defaultCarrier: true },
    });
    const currentByZone = new Map<string, Map<string, number>>();
    for (const r of currentRows) {
      const z = (r.zone ?? '').replace(/\s+/g, '').toUpperCase();
      const c = r.defaultCarrier!;
      const slot = currentByZone.get(z) ?? new Map<string, number>();
      slot.set(c, (slot.get(c) ?? 0) + 1);
      currentByZone.set(z, slot);
    }
    function modalCurrent(zone: string): string | null {
      const slot = currentByZone.get(zone);
      if (!slot) return null;
      let top: [string, number] | null = null;
      for (const e of slot) if (!top || e[1] > top[1]) top = [e[0], e[1]];
      return top?.[0] ?? null;
    }

    const out: Array<{
      zone: string;
      recommendedCarrier: string;
      confidence: number;
      sampleSize: number;
      runnersUp: Array<{ carrier: string; count: number }>;
      currentDefault: string | null;
    }> = [];
    for (const [zone, freq] of byZone) {
      const sorted = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
      const total = sorted.reduce((acc, [, n]) => acc + n, 0);
      if (total < minSamples) continue;
      const [topCarrier, topCount] = sorted[0];
      const conf = topCount / total;
      if (conf < minConfidence) continue;
      out.push({
        zone,
        recommendedCarrier: topCarrier,
        confidence: Math.round(conf * 100) / 100,
        sampleSize: total,
        runnersUp: sorted.slice(1, 4).map(([carrier, count]) => ({ carrier, count })),
        currentDefault: modalCurrent(zone),
      });
    }
    return out.sort((a, b) => b.sampleSize - a.sampleSize);
  }

  /**
   * Marcos 2026-06-30: aplicar las recomendaciones aceptadas como
   * defaultCarrier en cada fila de postal_code_zones que matchee la
   * zona. updateMany por zona — si la zona no tiene filas (Marcos
   * todavía no las cargó), seguimos al siguiente sin error.
   *
   * Retorna cuántas filas se afectaron + cuáles se ignoraron por no
   * tener match en la tabla.
   */
  async applyZoneDefaults(
    selections: Array<{ zone: string; carrier: string }>,
  ): Promise<{ updated: number; zonesWithoutMatch: string[] }> {
    let updated = 0;
    const zonesWithoutMatch: string[] = [];
    for (const sel of selections) {
      const zone = sel.zone.trim();
      const carrier = sel.carrier.trim();
      if (!zone || !carrier) continue;
      const res = await this.prisma.postalCodeZone.updateMany({
        where: { zone: { equals: zone, mode: 'insensitive' } },
        data: { defaultCarrier: carrier },
      });
      if (res.count === 0) {
        zonesWithoutMatch.push(zone);
      } else {
        updated += res.count;
        this.logger.log(`recommendZoneDefaults applied: ${zone} → ${carrier} (${res.count} rows)`);
      }
    }
    return { updated, zonesWithoutMatch };
  }

  async deleteAll(): Promise<number> {
    const r = await this.prisma.postalCodeZone.deleteMany({});
    this.logger.warn(`postal-code-zones: TODA la tabla borrada (n=${r.count})`);
    return r.count;
  }
}
