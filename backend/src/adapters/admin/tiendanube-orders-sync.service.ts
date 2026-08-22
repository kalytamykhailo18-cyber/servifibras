/**
 * ADAPTERS LAYER — TiendaNube ORDERS sync (Bloque B item 3).
 *
 * Marcos 2026-06-08: until now the daily logistics aggregator wrote
 * an explicit note "TN sync no implementado" because product sync
 * was wired but order sync was deferred. This service pulls orders
 * from TN via `/v1/{store}/orders` and upserts them into the local
 * `Order` model with `source: TIENDANUBE`. The daily aggregator
 * picks them up alongside the WhatsApp/mayorista CRM orders so the
 * 6-section panel shows real TN volume in MOTOS/MICROS.
 *
 * Idempotency: every TN order has a stable `id`. We upsert by the
 * (source=TIENDANUBE, externalId=tn_order.id) compound key. Re-runs
 * are safe — second pass updates instead of duplicating.
 *
 * Contact resolution: TN customers carry `id` + `name` + `email` +
 * `phone`. We look up the local Contact by phone (preferred — same
 * key WhatsApp uses) and fall back to (name, email). If no match,
 * we create a stub Contact tagged metadata.tiendanubeCustomerId so
 * subsequent syncs reattach.
 *
 * Env knobs:
 *   TIENDANUBE_ORDERS_SYNC_ENABLED      default true
 *   TIENDANUBE_ORDERS_LOOKBACK_DAYS     default 14
 *   TIENDANUBE_ORDERS_PAGE_SIZE         default 50
 *   TIENDANUBE_ORDERS_MAX_PAGES         default 20
 *   TIENDANUBE_ORDERS_TIMEOUT_MS        default 15000
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient, OrderSource, OrderStatus } from '@prisma/client';
import { TiendaNubeAuthResolver } from '../oauth/tiendanube-auth.resolver';

import { PrismaService } from '../repositories/prisma.service';
export type TiendaNubeFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface TnOrderProduct {
  id?: number | string;
  variant_id?: number | string;
  sku?: string | null;
  name?: string;
  price?: string | number | null;
  quantity?: number;
  image?: { src?: string | null } | null;
}

export interface TnRawOrder {
  id: number | string;
  number?: number | string;
  status?: string;
  payment_status?: string;
  shipping_status?: string | null;
  total?: string | number;
  currency?: string;
  created_at?: string;
  updated_at?: string;
  customer?: {
    id?: number | string;
    name?: string;
    email?: string | null;
    phone?: string | null;
  };
  shipping_pickup_type?: string | null;
  shipping_tracking_number?: string | null;
  shipping_tracking_url?: string | null;
  shipping_option?: string | null;
  shipping_option_code?: string | null;
  shipping_carrier_name?: string | null;
  /** Marcos 2026-06-12: per-package fee the seller pays to the
   *  carrier (Andreani et al). The TN dashboard exposes this
   *  alongside `shipping_cost_customer` — what the buyer paid. The
   *  dispatch-stats card sums `shipping_cost_owner` per carrier so
   *  Marcos can cross-check the courier's monthly invoice. */
  shipping_cost_owner?: number | string | null;
  shipping_cost_customer?: number | string | null;
  /** Marcos 2026-06-12: destination address — TN already
   *  zonifies; we just lift the province/state through. */
  shipping_address?: {
    province?: string | null;
    state?: string | null;
    city?: string | null;
    /** Marcos 2026-06-30: TN devuelve zipcode / postal_code / cp
     *  según versión de la API. Lo capturamos al contact.metadata
     *  para que el cascade per-CP/zona del recommender + del panel
     *  Despachos resuelva al GBA específico en vez de colapsar todo
     *  a "Buenos Aires" sin granularidad. */
    zipcode?: string | null;
    postal_code?: string | null;
    cp?: string | null;
    locality?: string | null;
  } | null;
  /** Marcos 2026-06-10: TN stamps this when the seller cancels the
   *  order. Drives our CANCELLED bucketing alongside the legacy
   *  payment/shipping fields. */
  cancelled_at?: string | null;
  products?: TnOrderProduct[];
}

export interface TnOrdersSyncResult {
  enabled: boolean;
  reason?: string;
  pages: number;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

function envStr(key: string, fallback: string): string {
  const v = process.env[key];
  return v != null && v.length > 0 ? v : fallback;
}
function envNum(key: string, fallback: number): number {
  const v = process.env[key];
  const n = v != null ? Number(v) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v == null || v.trim().length === 0) return fallback;
  return v.trim().toLowerCase() === 'true';
}

function mapStatus(
  payment: string | undefined,
  shipping: string | null | undefined,
  orderStatus?: string | null,
  cancelledAt?: string | null,
): OrderStatus {
  // TN distinguishes payment + shipping status + an order-level
  // `status` field. Map to our 5-state OrderStatus enum so the
  // aggregator's filter (CONFIRMED | PROCESSING | DISPATCHED |
  // CANCELLED) sees TN orders the same way it sees CRM ones.
  //
  // Marcos 2026-06-10: order-level cancellation MUST win over the
  // legacy payment/shipping mapping. TN-14093 was cancelled at the
  // order level but had payment_status=paid (buyer paid before the
  // seller pulled the order), so the panel kept showing it as
  // PROCESSING for armado. Now we check order.status === 'cancelled'
  // and `cancelled_at` first.
  const o = (orderStatus ?? '').toLowerCase();
  if (o === 'cancelled' || (cancelledAt && String(cancelledAt).trim().length > 0)) {
    return OrderStatus.CANCELLED;
  }
  const p = (payment ?? '').toLowerCase();
  // Marcos 2026-06-11: TN's shipping_status='shipped' is the operator
  // marking the order for label-printing — NOT the carrier actually
  // taking it. Mapping that to our DISPATCHED state was masking a
  // real failure mode (carrier didn't pick up, theft, lost package
  // — see #2000016880649372 / TN-14208 today). Local DISPATCHED is
  // an operator action from our logistica panel, not a source-side
  // inference. Only `delivered` (carrier confirmed delivery) gets
  // promoted automatically — and even that is conservative.
  // The shipping arg is intentionally ignored for the auto-promote
  // path; kept in the signature so callers don't have to change.
  void shipping;
  if (p === 'refunded' || p === 'cancelled' || p === 'voided') return OrderStatus.CANCELLED;
  if (p === 'paid' || p === 'authorized') return OrderStatus.CONFIRMED;
  if (p === 'pending') return OrderStatus.PROCESSING;
  return OrderStatus.CONFIRMED;
}

@Injectable()
export class TiendaNubeOrdersSyncService {
  private readonly logger = new Logger(TiendaNubeOrdersSyncService.name);
  private readonly prisma: PrismaClient;
  private fetcher: TiendaNubeFetcher = (url, init) => fetch(url, init);

  constructor(
    private readonly auth: TiendaNubeAuthResolver,
    @Optional() prismaShared?: PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  /** Test-only override hook so e2e/integration probes can inject a
   *  stub fetcher without going through Nest DI. */
  setFetcher(fetcher: TiendaNubeFetcher) {
    this.fetcher = fetcher;
  }

  async runSync(): Promise<TnOrdersSyncResult> {
    const result: TnOrdersSyncResult = {
      enabled: false,
      pages: 0,
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };
    if (!envBool('TIENDANUBE_ORDERS_SYNC_ENABLED', true)) {
      result.reason = 'TIENDANUBE_ORDERS_SYNC_ENABLED=false';
      return result;
    }
    const auth = await this.auth.resolve();
    if (!auth) {
      result.reason = 'TiendaNube credentials not present (DB or env)';
      return result;
    }
    const { storeId, accessToken: token } = auth;
    result.enabled = true;

    const baseUrl = envStr('TIENDANUBE_API_URL', 'https://api.tiendanube.com/v1');
    const userAgent = envStr(
      'TIENDANUBE_USER_AGENT',
      'Servifibras-Backend (servifibrasbuenosaires@gmail.com)',
    );
    const pageSize = Math.min(envNum('TIENDANUBE_ORDERS_PAGE_SIZE', 50), 200);
    const maxPages = envNum('TIENDANUBE_ORDERS_MAX_PAGES', 20);
    const timeoutMs = envNum('TIENDANUBE_ORDERS_TIMEOUT_MS', 15_000);
    const lookbackDays = envNum('TIENDANUBE_ORDERS_LOOKBACK_DAYS', 14);

    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
      .toISOString();

    for (let page = 1; page <= maxPages; page++) {
      const url =
        `${baseUrl}/${storeId}/orders` +
        `?per_page=${pageSize}&page=${page}` +
        `&created_at_min=${encodeURIComponent(since)}`;
      let resp: Response;
      try {
        resp = await this.timed(
          this.fetcher(url, {
            headers: {
              Authentication: `bearer ${token}`,
              'User-Agent': userAgent,
              Accept: 'application/json',
            },
          }),
          timeoutMs,
        );
      } catch (err: any) {
        result.errors.push(`page ${page}: ${err.message}`);
        break;
      }
      if (!resp.ok) {
        result.errors.push(`page ${page}: HTTP ${resp.status} ${resp.statusText}`);
        break;
      }
      result.pages++;
      let body: any;
      try {
        body = await resp.json();
      } catch (e: any) {
        result.errors.push(`page ${page}: ${e.message}`);
        break;
      }
      if (!Array.isArray(body) || body.length === 0) break;
      for (const raw of body as TnRawOrder[]) {
        try {
          const outcome = await this.upsertOrder(raw);
          if (outcome === 'created') result.created++;
          else if (outcome === 'updated') result.updated++;
          else result.skipped++;
        } catch (err: any) {
          result.errors.push(`order ${raw?.id}: ${err.message}`);
        }
        result.fetched++;
      }
      const link = resp.headers.get('link') ?? resp.headers.get('Link') ?? '';
      if (!/rel="next"/.test(link) && body.length < pageSize) break;
    }

    this.logger.log(
      `TiendaNube orders sync: pages=${result.pages} fetched=${result.fetched} created=${result.created} updated=${result.updated} skipped=${result.skipped} errors=${result.errors.length}`,
    );
    return result;
  }

  private async upsertOrder(raw: TnRawOrder): Promise<'created' | 'updated' | 'skipped'> {
    const externalId = raw?.id != null ? String(raw.id) : null;
    if (!externalId) return 'skipped';
    const contact = await this.resolveContact(raw);
    if (!contact) return 'skipped';

    const products = Array.isArray(raw.products)
      ? raw.products.map((p) => ({
          id: p.id != null ? String(p.id) : null,
          variantId: p.variant_id != null ? String(p.variant_id) : null,
          sku: p.sku ?? null,
          name: String(p.name ?? ''),
          quantity: Number(p.quantity ?? 1),
          unitPrice: p.price != null ? Number(p.price) : null,
          imageUrl: p.image?.src ?? null,
        }))
      : [];
    const amount = Number(raw.total ?? 0) || 0;
    const currency = String(raw.currency ?? 'ARS');
    const orderNumber = `TN-${raw.number ?? raw.id}`;
    // Marcos 2026-06-12: dispatch-stats card sums carrier fees per
    // mensajería so he can reconcile their monthly invoice. TN
    // exposes `shipping_cost_owner` (what we pay to the carrier)
    // and `shipping_cost_customer` (what the buyer paid). Prefer
    // owner; fall back to customer when owner is null. Zone comes
    // from the shipping address province — TN already returns it
    // pre-zonified.
    const shippingCostRaw =
      raw.shipping_cost_owner ??
      raw.shipping_cost_customer ??
      null;
    const shippingCost = (() => {
      const n = Number(shippingCostRaw);
      return Number.isFinite(n) && n > 0 ? n : null;
    })();
    const shippingZone = (() => {
      const province = raw.shipping_address?.province?.toString().trim();
      const state    = raw.shipping_address?.state?.toString().trim();
      return province || state || null;
    })();
    // Marcos 2026-06-30: capturar CP + localidad al contact.metadata
    // así el cascade per-CP/zona (recommender + panel Despachos) puede
    // resolver al GBA específico. Antes la metadata sólo guardaba
    // tiendanubeCustomerId, y BUENOS AIRES quedaba como bucket único
    // de provincia. updateMany para no romper si ya hay otra metadata.
    const cp = (
      raw.shipping_address?.zipcode ??
      raw.shipping_address?.postal_code ??
      raw.shipping_address?.cp ??
      null
    );
    const locality = (
      raw.shipping_address?.locality ??
      raw.shipping_address?.city ??
      null
    );
    if (contact?.id && (cp || locality)) {
      const existingContact = await this.prisma.contact.findUnique({
        where: { id: contact.id },
        select: { metadata: true },
      });
      const meta = (existingContact?.metadata ?? {}) as Record<string, any>;
      const patch: Record<string, any> = { ...meta };
      if (cp && !patch.postalCode) patch.postalCode = String(cp).trim();
      if (locality && !patch.locality) patch.locality = String(locality).trim();
      // Solo update si hay cambios reales — evita escrituras inútiles.
      if (patch.postalCode !== meta.postalCode || patch.locality !== meta.locality) {
        await this.prisma.contact.update({
          where: { id: contact.id },
          data: { metadata: patch as any },
        }).catch(() => {/* best-effort */});
      }
    }
    const data = {
      orderNumber,
      contactId: contact.id,
      amount,
      currency,
      products: products as any,
      status: mapStatus(raw.payment_status, raw.shipping_status, raw.status, raw.cancelled_at),
      trackingNumber: raw.shipping_tracking_number ?? null,
      // Surface the TN-resolved carrier name (Andreani, ViaCargo, etc.)
      // so the daily aggregator's MOTOS-vs-MICROS regex can route the
      // row correctly. Falls back to the shipping_option label.
      carrier:
        raw.shipping_carrier_name ??
        raw.shipping_option ??
        raw.shipping_option_code ??
        null,
      // Marcos 2026-06-25: shipping_pickup_type ahora vive en su propio
      // campo Order.shippingPickupType. Antes ensuciaba `notes` con
      // "TN pickup: ship/pickup" y eclipsaba las notas reales del
      // operador en el panel de logística. Por eso `notes` NO se setea
      // desde el sync — queda libre para el operador.
      shippingPickupType: raw.shipping_pickup_type ?? null,
      source: OrderSource.TIENDANUBE,
      externalId,
      shippingCost,
      shippingZone,
    };
    // Upsert by (source, externalId) — the compound unique index
    // makes this idempotent. We also re-key orderNumber if TN
    // reassigned the number (rare) to keep the @unique consistent.
    const existing = await this.prisma.order.findUnique({
      where: { source_externalId: { source: OrderSource.TIENDANUBE, externalId } },
    });
    if (existing) {
      // Marcos 2026-07-13 (A4 del documento): antes preservábamos SOLO
      // los timestamps dispatchedAt/deliveredAt pero dejábamos que TN
      // pisara el `status`. Consecuencia: un pedido marcado DISPATCHED
      // localmente volvía a CONFIRMED cuando TN llegaba con su
      // shipping_status="pending". Ahora bloqueamos también el
      // retroceso del status: si el estado local ya llegó a DISPATCHED
      // o DELIVERED, se preserva; si el local es CANCELLED, se preserva
      // (CANCELLED es terminal en el flujo interno).
      const RANK: Record<string, number> = {
        PENDING: 0, CONFIRMED: 1, PROCESSING: 2, DISPATCHED: 3, DELIVERED: 4, CANCELLED: 5,
      };
      const localRank = RANK[existing.status as string] ?? 0;
      const incomingRank = data.status ? (RANK[data.status as string] ?? 0) : 0;
      const preserveLocalStatus =
        existing.status === 'CANCELLED' ||
        (localRank >= RANK.DISPATCHED && incomingRank < localRank);
      const patch: any = {
        ...data,
        // Preserve dispatch/delivered timestamps already stamped
        // locally — TN sync shouldn't roll them back.
        dispatchedAt: existing.dispatchedAt,
        deliveredAt: existing.deliveredAt,
      };
      if (preserveLocalStatus) {
        patch.status = existing.status;
      }
      await this.prisma.order.update({
        where: { id: existing.id },
        data: patch,
      });
      return 'updated';
    }
    await this.prisma.order.create({ data });
    return 'created';
  }

  /**
   * Find the local Contact for a TN order. Priority:
   *   1. Existing contact matched by phone (the WhatsApp identifier).
   *   2. Existing contact matched by email.
   *   3. Existing contact matched by metadata.tiendanubeCustomerId.
   *   4. Create a stub contact tagged with the TN customer id so
   *      subsequent syncs reattach.
   * Returns null only when the TN order had no usable customer
   * record (rare — TN requires at least a name on checkout).
   */
  private async resolveContact(raw: TnRawOrder): Promise<{ id: string } | null> {
    const c = raw.customer;
    if (!c) return null;
    const tnId = c.id != null ? String(c.id) : null;
    const phone = c.phone?.trim() || null;
    const email = c.email?.trim().toLowerCase() || null;
    const name = (c.name || '').trim() || null;

    if (phone) {
      const byPhone = await this.prisma.contact.findUnique({ where: { phone } });
      if (byPhone) return { id: byPhone.id };
    }
    if (email) {
      const byEmail = await this.prisma.contact.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });
      if (byEmail) return { id: byEmail.id };
    }
    if (tnId) {
      const byMeta = await this.prisma.contact.findFirst({
        where: { metadata: { path: ['tiendanubeCustomerId'], equals: tnId } as any },
      });
      if (byMeta) return { id: byMeta.id };
    }
    // Create a stub so the order persists. The contact ends up in
    // the same shared inbox; the operator can merge later if it
    // matches an existing record.
    if (!name && !phone && !email) return null;
    const created = await this.prisma.contact.create({
      data: {
        name: name ?? `Cliente TN ${tnId ?? ''}`.trim(),
        phone: phone,
        email: email,
        metadata: tnId ? { tiendanubeCustomerId: tnId } : undefined,
      },
    });
    return { id: created.id };
  }

  private async timed<T>(p: Promise<T>, ms: number): Promise<T> {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) =>
        setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms),
      ),
    ]);
  }
}
