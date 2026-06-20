/**
 * ADAPTERS LAYER — Ventas unificadas (Bloque B item 4).
 *
 * Marcos 2026-06-06 ask: a single panel that rolls up sales across
 * every channel — ML cuenta 1, ML cuenta 2, TiendaNube checkout,
 * WhatsApp / mayorista manual — so he sees the full business
 * volume of the day / week / month at a glance instead of jumping
 * between the ML dashboard, TN admin and our CRM orders list.
 *
 * Data sources:
 *   - ML orders   → live fetch per cuenta via MercadoLibreService.
 *   - TN orders   → local Order table (source=TIENDANUBE), kept in
 *                   sync by TiendaNubeOrdersSyncCron every 30 min.
 *   - CRM manual  → local Order table (source=MANUAL) — the
 *                   "Registrar pedido" path from the operator panel.
 *
 * Currency: we never convert. Each cell carries its native
 * currency (ARS / USD / EUR) so the dashboard can render
 * per-currency totals when they coexist. In practice ML + TN are
 * always ARS; the only USD/EUR rows are legacy CRM entries.
 *
 * Cache: results cached in-process for ML_VENTAS_UNIFICADAS_CACHE_MS
 * (default 5 min) per range. Avoids re-fetching ~1500 ML orders
 * each time the dashboard refreshes.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient, OrderSource, OrderStatus } from '@prisma/client';
import type { MercadoLibreService } from '../mercadolibre/mercadolibre.service';
import { MERCADOLIBRE_SERVICE } from '../../use-cases/mercadolibre/mercadolibre.token';

export type VentasRange = 'today' | 'week' | 'month';

export type VentasSource =
  | 'ML_CUENTA_1'
  | 'ML_CUENTA_2'
  | 'TIENDANUBE'
  | 'MANUAL';

export interface VentasSourceCell {
  source: VentasSource;
  label: string;
  /** Per-currency breakdown — most sources are pure ARS but legacy
   *  CRM rows include USD/EUR. */
  byCurrency: Array<{ currency: string; count: number; amount: number }>;
  /** Convenience total (sum across currencies as if all ARS). null
   *  when more than one currency is present and a single number is
   *  ambiguous — the UI then renders the per-currency list. */
  totalArsLike: number | null;
  count: number;
}

export interface VentasRangePayload {
  range: VentasRange;
  fromIso: string;
  toIso: string;
  sources: VentasSourceCell[];
  /** Per-day total revenue across all sources (ARS-like). Useful for
   *  the trend chart. Buckets the time range by local-day. */
  daily: Array<{ date: string; sources: Record<VentasSource, number> }>;
  /** Notes the dashboard renders as soft footer text (e.g. "cuenta 2
   *  not connected"). */
  notes: string[];
}

interface CacheEntry {
  at: number;
  payload: VentasRangePayload;
}

@Injectable()
export class VentasUnificadasService {
  private readonly logger = new Logger(VentasUnificadasService.name);
  private readonly prisma = new PrismaClient();
  private readonly cache = new Map<VentasRange, CacheEntry>();

  constructor(
    @Optional()
    @Inject(MERCADOLIBRE_SERVICE)
    private readonly mercadolibre?: MercadoLibreService,
  ) {}

  private cacheTtlMs(): number {
    const n = Number(process.env.ML_VENTAS_UNIFICADAS_CACHE_MS);
    return Number.isFinite(n) && n > 0 ? n : 5 * 60 * 1000;
  }

  async get(range: VentasRange): Promise<VentasRangePayload> {
    const cached = this.cache.get(range);
    if (cached && Date.now() - cached.at < this.cacheTtlMs()) {
      return cached.payload;
    }
    const payload = await this.compute(range);
    this.cache.set(range, { at: Date.now(), payload });
    return payload;
  }

  /** Force-recompute, bypassing the cache. Used by the admin
   *  "refrescar" button + by tests. */
  async refresh(range: VentasRange): Promise<VentasRangePayload> {
    this.cache.delete(range);
    return this.get(range);
  }

  /**
   * Bloque B item 5 — Marcos 2026-06-08 ask: click-detail. From any
   * per-source cell on the dashboard, drill into the underlying
   * order list for that source + period. Always returns the rows
   * fresh (no cache) so the operator sees what just landed.
   *
   * Limit is clamped to [1, 200]; defaults to 50.
   */
  async drilldown(args: {
    range: VentasRange;
    source: VentasSource;
    limit?: number;
  }): Promise<{
    range: VentasRange;
    source: VentasSource;
    label: string;
    fromIso: string;
    toIso: string;
    orders: Array<{
      id: string;
      orderNumber: string;
      createdAt: string;
      customerName: string | null;
      amount: number;
      currency: string;
      carrier: string | null;
      itemsCount: number;
      itemsSummary: string;
    }>;
    truncated: boolean;
  }> {
    const { from, to } = this.rangeBounds(args.range);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    const limit = Math.max(1, Math.min(args.limit ?? 50, 200));
    const label = labelForSource(args.source);

    if (args.source === 'ML_CUENTA_1' || args.source === 'ML_CUENTA_2') {
      if (!this.mercadolibre) {
        return {
          range: args.range,
          source: args.source,
          label,
          fromIso,
          toIso,
          orders: [],
          truncated: false,
        };
      }
      const provider = args.source === 'ML_CUENTA_1' ? 'mercadolibre' : 'mercadolibre_cuenta2';
      const result = await this.mercadolibre.fetchOrdersForRange({
        fromIso,
        toIso,
        provider,
      });
      const orders = (result?.orders ?? []).map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        createdAt: o.dateCreated ?? fromIso,
        customerName: o.buyerNickname,
        amount: o.totalAmount ?? 0,
        currency: o.currencyId ?? 'ARS',
        carrier: o.shippingMode ?? o.logisticType ?? null,
        itemsCount: o.items?.length ?? 0,
        itemsSummary: summarizeMlItems(o.items),
      }));
      // Newest first.
      orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const truncated = orders.length > limit;
      return {
        range: args.range,
        source: args.source,
        label,
        fromIso,
        toIso,
        orders: orders.slice(0, limit),
        truncated,
      };
    }

    const localSource: OrderSource =
      args.source === 'TIENDANUBE' ? OrderSource.TIENDANUBE : OrderSource.MANUAL;
    const rows = await this.prisma.order.findMany({
      where: {
        source: localSource,
        createdAt: { gte: from, lte: to },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // +1 to detect truncation
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        amount: true,
        currency: true,
        carrier: true,
        products: true,
        contact: { select: { name: true } },
      },
    });
    const truncated = rows.length > limit;
    return {
      range: args.range,
      source: args.source,
      label,
      fromIso,
      toIso,
      orders: rows.slice(0, limit).map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        createdAt: o.createdAt.toISOString(),
        customerName: o.contact?.name ?? null,
        amount: Number(o.amount) || 0,
        currency: (o.currency || 'ARS').toUpperCase(),
        carrier: o.carrier,
        itemsCount: Array.isArray(o.products) ? (o.products as any[]).length : 0,
        itemsSummary: summarizeLocalProducts(o.products),
      })),
      truncated,
    };
  }

  /**
   * Marcos 2026-06-12 bugfix: the previous range bounds used the
   * server's local TZ (UTC in prod), so "today" was UTC midnight →
   * UTC midnight. From Marcos in AR (UTC-3) that meant the panel
   * showed orders from 21:00 yesterday-AR through 21:00 today-AR
   * and the daily bucket date was the calendar day of the order's
   * raw ISO timestamp — not Marcos's day. That's what he meant by
   * "no funciona correctamente". Now everything snaps to AR local
   * day boundaries via APP_TIMEZONE (default America/Argentina/
   * Buenos_Aires), and the daily ISO key is consistent between ML
   * + local sources.
   */
  private appTimezone(): string {
    const tz = (process.env.APP_TIMEZONE ?? '').trim();
    return tz.length > 0 ? tz : 'America/Argentina/Buenos_Aires';
  }
  /** YYYY-MM-DD of a Date as seen in the app timezone. */
  private localDateKey(d: Date): string {
    const tz = this.appTimezone();
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(d);
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '01';
      return `${get('year')}-${get('month')}-${get('day')}`;
    } catch {
      return d.toISOString().slice(0, 10);
    }
  }
  /** YYYY-MM-DD of an ISO-string as seen in the app timezone.
   *  Safe for ML's `-04:00` / `-03:00` / `Z` shapes. */
  private localDateKeyOfIso(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return this.localDateKey(d);
  }
  /** First/last instant of the given local day, expressed as UTC
   *  Date instances. Uses the AR timezone offset at the supplied
   *  date so DST (irrelevant in AR but cheap to keep correct)
   *  doesn't drift. */
  private dayBoundsLocal(localDay: Date): { from: Date; to: Date } {
    const y = localDay.getUTCFullYear();
    const m = localDay.getUTCMonth();
    const d = localDay.getUTCDate();
    // Build a UTC anchor for that day, then compute the AR offset
    // at that anchor and shift. AR is fixed UTC-3 (no DST), so this
    // is effectively a constant +3h shift — but using
    // `Intl.DateTimeFormat`'s timeZoneName='longOffset' would let us
    // generalise for other clients later.
    const utcMidnight = Date.UTC(y, m, d, 0, 0, 0, 0);
    const from = new Date(utcMidnight + this.appTzOffsetMs(utcMidnight));
    const toAnchor = Date.UTC(y, m, d, 23, 59, 59, 999);
    const to = new Date(toAnchor + this.appTzOffsetMs(toAnchor));
    return { from, to };
  }
  /** Milliseconds of `(UTC - localTz)` for the supplied instant — so
   *  adding it to a UTC instant shifts to the same wall-clock time
   *  in the local tz. AR returns +3 * 3_600_000 (UTC is 3h ahead of
   *  AR-local clock). */
  private appTzOffsetMs(atMs: number): number {
    const tz = this.appTimezone();
    try {
      const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
      const parts = dtf.formatToParts(new Date(atMs));
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
      const localUtcMs = Date.UTC(
        get('year'), get('month') - 1, get('day'),
        get('hour') === 24 ? 0 : get('hour'),
        get('minute'), get('second'),
      );
      // UTC - local; positive when local is behind UTC (AR).
      return atMs - localUtcMs;
    } catch {
      // Fallback to fixed AR offset (-3h ⇒ +3h shift).
      return 3 * 60 * 60 * 1000;
    }
  }
  private rangeBounds(range: VentasRange): { from: Date; to: Date } {
    // Marcos 2026-06-12 bugfix: snap the bounds to AR-local day
    // boundaries (not the server's UTC midnight) so "today" matches
    // what the operator sees on their wall clock + the daily
    // chart's date keys.
    const todayKey = this.localDateKey(new Date());
    const [yy, mm, dd] = todayKey.split('-').map((n) => Number(n));
    const days = range === 'today' ? 1 : range === 'week' ? 7 : 30;
    const startKeyDate = new Date(Date.UTC(yy, mm - 1, dd - (days - 1)));
    const endKeyDate = new Date(Date.UTC(yy, mm - 1, dd));
    const { from } = this.dayBoundsLocal(startKeyDate);
    const { to } = this.dayBoundsLocal(endKeyDate);
    return { from, to };
  }

  private async compute(range: VentasRange): Promise<VentasRangePayload> {
    const { from, to } = this.rangeBounds(range);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    const notes: string[] = [];

    // ML rolls up via the existing fetcher per cuenta.
    const mlCells: VentasSourceCell[] = [];
    const mlDaily = new Map<string, Map<VentasSource, number>>();
    if (!this.mercadolibre) {
      notes.push('MercadoLibreService no disponible — métricas ML omitidas.');
    } else {
      const cuentas: Array<{ provider: string; source: VentasSource; label: string }> = [
        { provider: 'mercadolibre', source: 'ML_CUENTA_1', label: 'ML Cuenta 1' },
        { provider: 'mercadolibre_cuenta2', source: 'ML_CUENTA_2', label: 'ML Cuenta 2' },
      ];
      for (const { provider, source, label } of cuentas) {
        try {
          const result = await this.mercadolibre.fetchOrdersForRange({
            fromIso,
            toIso,
            provider,
          });
          if (!result) {
            mlCells.push({
              source,
              label,
              byCurrency: [],
              totalArsLike: 0,
              count: 0,
            });
            notes.push(`${label} sin credenciales OAuth conectadas — sección vacía.`);
            continue;
          }
          const byCurrency = new Map<string, { count: number; amount: number }>();
          // Marcos 2026-06-20: restamos las canceladas/inválidas para
          // que el headline refleje ventas reales (no carritos que
          // después se cayeron). El conteo de excluidas se acumula en
          // `cancelledCount` y se surfaceará en notes para que el
          // operador sepa cuántas filas se filtraron.
          let cancelledCount = 0;
          for (const o of result.orders) {
            const st = (o.status ?? '').toLowerCase();
            if (st === 'cancelled' || st === 'invalid') {
              cancelledCount++;
              continue;
            }
            const cur = o.currencyId ?? 'ARS';
            const cell = byCurrency.get(cur) ?? { count: 0, amount: 0 };
            cell.count++;
            // Marcos 2026-06-19 (vista unificada): floats acumulaban
            // hasta "41276932.00000003". Redondeo a centavos por suma
            // para que el headline no exponga ese ruido — sigue siendo
            // exacto al centavo.
            cell.amount = Math.round((cell.amount + (o.totalAmount ?? 0)) * 100) / 100;
            byCurrency.set(cur, cell);
            // Daily bucket — keyed by AR-local day so it matches the
            // local-orders side + the chart axis.
            const day = o.dateCreated
              ? this.localDateKeyOfIso(o.dateCreated)
              : this.localDateKey(new Date());
            const dayMap = mlDaily.get(day) ?? new Map<VentasSource, number>();
            const prev = dayMap.get(source) ?? 0;
            dayMap.set(source, prev + (o.totalAmount ?? 0));
            mlDaily.set(day, dayMap);
          }
          const arsCell = byCurrency.get('ARS');
          mlCells.push({
            source,
            label,
            byCurrency: Array.from(byCurrency.entries()).map(([currency, c]) => ({
              currency,
              count: c.count,
              amount: c.amount,
            })),
            totalArsLike: byCurrency.size === 1 ? (arsCell?.amount ?? 0) : null,
            count: Array.from(byCurrency.values()).reduce((s, c) => s + c.count, 0),
          });
          if (cancelledCount > 0) {
            notes.push(`${label}: ${cancelledCount} pedido${cancelledCount === 1 ? '' : 's'} cancelado/inválido${cancelledCount === 1 ? '' : 's'} restado${cancelledCount === 1 ? '' : 's'} del total.`);
          }
        } catch (err: any) {
          notes.push(`${label}: ${err.message?.slice(0, 120) ?? 'error desconocido'}.`);
          mlCells.push({
            source,
            label,
            byCurrency: [],
            totalArsLike: null,
            count: 0,
          });
        }
      }
    }

    // Local orders — TN + MANUAL via the shared Order table.
    // Marcos 2026-06-20: las CANCELLED se restan del headline para
    // que el reporte sea de ventas reales, no de carritos que después
    // se cayeron. Contamos cuántas se excluyeron para mostrarlo como
    // nota al pie por source.
    const localOrdersAll = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        source: { in: [OrderSource.TIENDANUBE, OrderSource.MANUAL] },
      },
      select: {
        source: true,
        status: true,
        currency: true,
        amount: true,
        createdAt: true,
      },
    });
    const localCancelledBySource = new Map<VentasSource, number>();
    const localOrders = localOrdersAll.filter((o) => {
      if (o.status === OrderStatus.CANCELLED) {
        const key: VentasSource = o.source === OrderSource.TIENDANUBE ? 'TIENDANUBE' : 'MANUAL';
        localCancelledBySource.set(key, (localCancelledBySource.get(key) ?? 0) + 1);
        return false;
      }
      return true;
    });
    const localBuckets = new Map<
      VentasSource,
      { byCurrency: Map<string, { count: number; amount: number }>; count: number }
    >();
    const localDaily = new Map<string, Map<VentasSource, number>>();
    for (const o of localOrders) {
      const source: VentasSource = o.source === OrderSource.TIENDANUBE ? 'TIENDANUBE' : 'MANUAL';
      const bucket = localBuckets.get(source) ?? {
        byCurrency: new Map(),
        count: 0,
      };
      const cur = (o.currency || 'ARS').toUpperCase();
      const cell = bucket.byCurrency.get(cur) ?? { count: 0, amount: 0 };
      cell.count++;
      // Marcos 2026-06-19: round to cents per add — los TN floats
      // (ej. 47883414.68) son exactos; los manuales podían arrastrar
      // residuos de float si la suma se acumulaba sin redondeo.
      cell.amount = Math.round((cell.amount + (Number(o.amount) || 0)) * 100) / 100;
      bucket.byCurrency.set(cur, cell);
      bucket.count++;
      localBuckets.set(source, bucket);
      const day = this.localDateKey(o.createdAt);
      const dayMap = localDaily.get(day) ?? new Map<VentasSource, number>();
      const prev = dayMap.get(source) ?? 0;
      // ARS-like sum — we don't FX-convert; legacy USD/EUR rows show
      // as a separate currency in the per-source cell but get summed
      // raw in the daily total (acceptable for ARS-dominant data).
      dayMap.set(source, prev + (Number(o.amount) || 0));
      localDaily.set(day, dayMap);
    }
    const localCells: VentasSourceCell[] = (['TIENDANUBE', 'MANUAL'] as VentasSource[]).map(
      (source) => {
        const bucket = localBuckets.get(source);
        const label = source === 'TIENDANUBE' ? 'TiendaNube' : 'Manual / WhatsApp';
        if (!bucket || bucket.byCurrency.size === 0) {
          return { source, label, byCurrency: [], totalArsLike: 0, count: 0 };
        }
        const arsCell = bucket.byCurrency.get('ARS');
        return {
          source,
          label,
          byCurrency: Array.from(bucket.byCurrency.entries()).map(([currency, c]) => ({
            currency,
            count: c.count,
            amount: c.amount,
          })),
          totalArsLike: bucket.byCurrency.size === 1 ? (arsCell?.amount ?? 0) : null,
          count: bucket.count,
        };
      },
    );

    // Marcos 2026-06-20: footer notes con cuántas filas se restaron
    // por canceladas en cada source local. ML emite su nota desde
    // arriba en el loop por cuenta.
    for (const [source, count] of localCancelledBySource.entries()) {
      const label = source === 'TIENDANUBE' ? 'TiendaNube' : 'Manual / WhatsApp';
      notes.push(`${label}: ${count} pedido${count === 1 ? '' : 's'} cancelado${count === 1 ? '' : 's'} restado${count === 1 ? '' : 's'} del total.`);
    }

    // Combine daily buckets for the trend chart.
    const dailyKeys = new Set<string>();
    for (const k of mlDaily.keys()) dailyKeys.add(k);
    for (const k of localDaily.keys()) dailyKeys.add(k);
    const daily = Array.from(dailyKeys)
      .sort()
      .map((day) => {
        const sources: Record<VentasSource, number> = {
          ML_CUENTA_1: 0,
          ML_CUENTA_2: 0,
          TIENDANUBE: 0,
          MANUAL: 0,
        };
        for (const s of ['ML_CUENTA_1', 'ML_CUENTA_2'] as VentasSource[]) {
          sources[s] = mlDaily.get(day)?.get(s) ?? 0;
        }
        for (const s of ['TIENDANUBE', 'MANUAL'] as VentasSource[]) {
          sources[s] = localDaily.get(day)?.get(s) ?? 0;
        }
        return { date: day, sources };
      });

    return {
      range,
      fromIso,
      toIso,
      sources: [...mlCells, ...localCells],
      daily,
      notes,
    };
  }
}

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function labelForSource(s: VentasSource): string {
  if (s === 'ML_CUENTA_1') return 'ML Cuenta 1';
  if (s === 'ML_CUENTA_2') return 'ML Cuenta 2';
  if (s === 'TIENDANUBE') return 'TiendaNube';
  return 'Manual / WhatsApp';
}

/** Build a short summary like "nacar + 1904 + ganarx20plata" the
 *  drilldown modal renders next to each order. Caps at 80 chars. */
function summarizeMlItems(
  items: Array<{ sku: string | null; title: string; quantity: number }>,
): string {
  if (!items || items.length === 0) return '';
  const parts = items.map((it) => {
    const label = (it.sku || it.title || 'item').slice(0, 24);
    return it.quantity > 1 ? `${it.quantity}x${label}` : label;
  });
  let out = parts.join(' + ');
  if (out.length > 80) out = out.slice(0, 77) + '...';
  return out;
}

function summarizeLocalProducts(products: any): string {
  const arr = Array.isArray(products) ? products : [];
  if (arr.length === 0) return '';
  const parts: string[] = [];
  for (const p of arr) {
    if (typeof p === 'string') {
      parts.push(p.slice(0, 24));
      continue;
    }
    if (typeof p !== 'object' || !p) {
      parts.push('item');
      continue;
    }
    const sku = (p?.sku || p?.SKU || '') as string;
    const name = (p?.name || p?.title || '') as string;
    const qty = Number(p?.quantity ?? p?.qty ?? 1) || 1;
    const label = (sku || name || 'item').slice(0, 24);
    parts.push(qty > 1 ? `${qty}x${label}` : label);
  }
  let out = parts.join(' + ');
  if (out.length > 80) out = out.slice(0, 77) + '...';
  return out;
}
