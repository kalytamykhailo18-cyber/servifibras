/**
 * ADAPTERS LAYER — TiendaNube product sync.
 *
 * Pulls products from TiendaNube and pipes them through
 * `ProductCatalogService.bulkUpsertFromExternal()` so Marcos's online store
 * stays in sync with what the AI sees in its system prompt.
 *
 * Scope (v1):
 *   - Read-only sync (TiendaNube → us). The other direction (creating
 *     products on TiendaNube from the panel) lives outside this scope.
 *   - Source of truth: `externalId` on the Product row maps to TiendaNube's
 *     product `id`. Updates re-find by `externalId+source=TIENDANUBE`.
 *   - Multi-language: TiendaNube returns name/description as objects keyed
 *     by language (e.g. `{es:"Resina"}`). We pick `TIENDANUBE_LOCALE`
 *     (default "es") and fall back to whatever locale is present.
 *   - Categories: TiendaNube nests categories on each product variant. We
 *     flatten to the first category name; admin can re-categorize manually
 *     after sync if needed.
 *   - Pagination: walks `Link: next` headers until exhausted, capped by
 *     `TIENDANUBE_SYNC_MAX_PAGES` to avoid runaway pulls during testing.
 *
 * Tunable in `.env`:
 *   TIENDANUBE_API_URL          — base URL (default https://api.tiendanube.com/v1)
 *   TIENDANUBE_STORE_ID         — required; service short-circuits when blank
 *   TIENDANUBE_ACCESS_TOKEN     — required; same
 *   TIENDANUBE_SYNC_ENABLED     — kill switch (default 'true')
 *   TIENDANUBE_SYNC_PAGE_SIZE   — items per page (default 50, max 200)
 *   TIENDANUBE_SYNC_MAX_PAGES   — hard ceiling (default 50)
 *   TIENDANUBE_SYNC_TIMEOUT_MS  — per-request timeout (default 10000)
 *   TIENDANUBE_LOCALE           — preferred locale for name/description (default 'es')
 *   TIENDANUBE_USER_AGENT       — UA string the API requires (default 'Servifibras-Backend (servifibrasbuenosaires@gmail.com)')
 *
 * The fetcher is overridable via the constructor for E2E testing.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ProductSource } from '@prisma/client';
import {
  ExternalProductRow,
  ProductCatalogService,
} from './product-catalog.service';
import { TiendaNubeAuthResolver } from '../oauth/tiendanube-auth.resolver';

export type TiendaNubeFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface TiendaNubeRawProduct {
  id: number | string;
  name: Record<string, string> | string;
  description?: Record<string, string> | string | null;
  variants?: Array<{
    id?: number | string;
    sku?: string | null;
    price?: string | number | null;
    stock?: number | null;
    stock_management?: boolean | null;
    promotional_price?: string | number | null;
  }>;
  categories?: Array<{ name: Record<string, string> | string | null } | string>;
  published?: boolean;
}

export interface SyncRunResult {
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

function pickLocale(value: TiendaNubeRawProduct['name'] | TiendaNubeRawProduct['description']): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  const preferred = envStr('TIENDANUBE_LOCALE', 'es');
  if (typeof value === 'object') {
    if (typeof (value as any)[preferred] === 'string' && (value as any)[preferred].trim().length > 0) {
      return (value as any)[preferred].trim();
    }
    for (const k of Object.keys(value)) {
      const v = (value as any)[k];
      if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    }
  }
  return null;
}

function pickCategory(p: TiendaNubeRawProduct): string {
  if (Array.isArray(p.categories) && p.categories.length > 0) {
    const first = p.categories[0];
    if (typeof first === 'string') return first;
    if (first && (first as any).name) {
      const name = pickLocale((first as any).name);
      if (name) return name;
    }
  }
  return 'Sin categoría';
}

function priceOrNull(v: any): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

@Injectable()
export class TiendaNubeSyncService {
  private readonly logger = new Logger(TiendaNubeSyncService.name);

  /**
   * Resolved at construction time. Nest doesn't inject the fetcher
   * (no provider for it) — direct callers (tests) can pass an override
   * via `setFetcher()` instead.
   */
  private fetcher: TiendaNubeFetcher;

  constructor(
    private readonly catalog: ProductCatalogService,
    private readonly auth: TiendaNubeAuthResolver,
  ) {
    this.fetcher = (typeof fetch !== 'undefined'
      ? fetch.bind(globalThis)
      : (async () => { throw new Error('fetch unavailable'); })) as TiendaNubeFetcher;
  }

  /** Test seam: replace the fetch implementation with a stub. */
  setFetcher(fn: TiendaNubeFetcher) {
    this.fetcher = fn;
  }

  /**
   * Pull every active product from TiendaNube and upsert into the catalog.
   * Returns counts even when the sync is disabled / unconfigured so the
   * cron logger and admin trigger can show why nothing happened.
   */
  async runSync(): Promise<SyncRunResult> {
    const result: SyncRunResult = {
      enabled: false,
      reason: undefined,
      pages: 0, fetched: 0, created: 0, updated: 0, skipped: 0, errors: [],
    };

    if (!envBool('TIENDANUBE_SYNC_ENABLED', true)) {
      result.reason = 'TIENDANUBE_SYNC_ENABLED=false';
      return result;
    }
    const auth = await this.auth.resolve();
    if (!auth) {
      result.reason = 'TiendaNube credentials not present (DB or env)';
      return result;
    }
    const { storeId, accessToken: token } = auth;
    result.enabled = true;

    const baseUrl   = envStr('TIENDANUBE_API_URL', 'https://api.tiendanube.com/v1');
    const userAgent = envStr('TIENDANUBE_USER_AGENT',
      'Servifibras-Backend (servifibrasbuenosaires@gmail.com)');
    const pageSize  = Math.min(envNum('TIENDANUBE_SYNC_PAGE_SIZE', 50), 200);
    const maxPages  = envNum('TIENDANUBE_SYNC_MAX_PAGES', 50);
    const timeoutMs = envNum('TIENDANUBE_SYNC_TIMEOUT_MS', 10_000);

    const collected: ExternalProductRow[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const url = `${baseUrl}/${storeId}/products?per_page=${pageSize}&page=${page}`;
      let resp: Response;
      try {
        resp = await this.timed(this.fetcher(url, {
          headers: {
            'Authentication': `bearer ${token}`,
            'User-Agent': userAgent,
            'Accept': 'application/json',
          },
        }), timeoutMs);
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
      try { body = await resp.json(); }
      catch (e: any) { result.errors.push(`page ${page}: ${e.message}`); break; }

      if (!Array.isArray(body) || body.length === 0) break;

      for (const p of body as TiendaNubeRawProduct[]) {
        const row = this.normalize(p);
        if (row) collected.push(row);
        else     result.skipped++;
      }
      result.fetched += body.length;

      // TiendaNube paginates via Link header; if there's no next link we're done.
      const link = resp.headers.get('link') ?? resp.headers.get('Link') ?? '';
      if (!/rel="next"/.test(link) && body.length < pageSize) break;
    }

    if (collected.length > 0) {
      const upsert = await this.catalog.bulkUpsertFromExternal(collected, ProductSource.TIENDANUBE);
      result.created += upsert.created;
      result.updated += upsert.updated;
      result.skipped += upsert.skipped;
      for (const e of upsert.errors) result.errors.push(e);
    }

    this.logger.log(
      `TiendaNube sync: pages=${result.pages} fetched=${result.fetched} created=${result.created} updated=${result.updated} skipped=${result.skipped} errors=${result.errors.length}`,
    );
    return result;
  }

  /**
   * Fetch a single product from TiendaNube by id and upsert it into the
   * catalog. Used by the real-time webhook handler so a price change in
   * TN reflects in the CRM immediately, instead of waiting for the daily
   * cron. Returns the upsert outcome (created/updated/skipped flags).
   */
  async syncOneById(productId: string | number): Promise<{
    ok: boolean;
    reason?: string;
    created?: boolean;
    updated?: boolean;
  }> {
    const auth = await this.auth.resolve();
    if (!auth) return { ok: false, reason: 'no_credentials' };

    const baseUrl = envStr('TIENDANUBE_API_URL', 'https://api.tiendanube.com/v1');
    const userAgent = envStr(
      'TIENDANUBE_USER_AGENT',
      'Servifibras-Backend (servifibrasbuenosaires@gmail.com)',
    );
    const timeoutMs = envNum('TIENDANUBE_SYNC_TIMEOUT_MS', 10_000);
    const url = `${baseUrl}/${auth.storeId}/products/${productId}`;

    let resp: Response;
    try {
      resp = await this.timed(this.fetcher(url, {
        headers: {
          'Authentication': `bearer ${auth.accessToken}`,
          'User-Agent': userAgent,
          'Accept': 'application/json',
        },
      }), timeoutMs);
    } catch (err: any) {
      this.logger.warn(`syncOneById ${productId} fetch failed: ${err.message}`);
      return { ok: false, reason: err.message };
    }

    if (resp.status === 404) {
      // TN says the product is gone — treat as a delete.
      await this.markInactiveById(productId);
      return { ok: true, updated: true };
    }
    if (!resp.ok) {
      this.logger.warn(`syncOneById ${productId}: HTTP ${resp.status}`);
      return { ok: false, reason: `HTTP ${resp.status}` };
    }

    const body = await resp.json().catch(() => null);
    if (!body) return { ok: false, reason: 'invalid JSON from TN' };

    const row = this.normalize(body as TiendaNubeRawProduct);
    if (!row) return { ok: false, reason: 'normalize returned null' };

    const out = await this.catalog.bulkUpsertFromExternal([row], ProductSource.TIENDANUBE);
    return {
      ok: true,
      created: out.created > 0,
      updated: out.updated > 0,
    };
  }

  /**
   * Flip the catalog row matching this TiendaNube product id to
   * `active = false`. We don't hard-delete so that historical orders
   * referencing the product keep their join intact.
   */
  async markInactiveById(productId: string | number): Promise<{ found: boolean }> {
    const updated = await this.catalog.deactivateByExternalId(
      String(productId),
      ProductSource.TIENDANUBE,
    );
    return { found: updated };
  }

  /**
   * Convert one TiendaNube product into our `ExternalProductRow` shape.
   * Picks the first variant for the SKU/price/stock; multi-variant
   * products land as a single row using variant 0 (Marcos can reorganize
   * the catalog manually if a SKU split is ever needed).
   */
  private normalize(p: TiendaNubeRawProduct): ExternalProductRow | null {
    const name = pickLocale(p.name);
    if (!name) return null;
    const variants = Array.isArray(p.variants) && p.variants.length > 0 ? p.variants : [{}];
    const v = variants[0] ?? {};
    // SKU: prefer variant.sku; fall back to "TN-{productId}-{variantId|0}"
    const sku = (v.sku && String(v.sku).trim().length > 0)
      ? String(v.sku).trim()
      : `TN-${p.id}${v.id != null ? '-' + v.id : ''}`;
    const description = pickLocale(p.description);
    const inStock = v.stock_management === false
      ? true
      : (v.stock == null || (typeof v.stock === 'number' && v.stock > 0));
    // Build the public storefront URL. TiendaNube ships `handle` (slug)
    // and sometimes `permalink` directly on the product payload — prefer
    // those; only fall back to `?p=<id>` if the store base URL is set
    // but the API didn't return a slug. The catalog service will
    // overwrite this with a base+id fallback if we leave it null, so
    // worst case the agent still has *a* working link.
    const base = (process.env.TIENDANUBE_STORE_BASE_URL || '').replace(/\/+$/, '');
    const handle = pickLocale((p as any).handle);
    const permalink = typeof (p as any).permalink === 'string' && (p as any).permalink.length > 0
      ? (p as any).permalink
      : null;
    let url: string | null = null;
    if (permalink) url = permalink;
    else if (base && handle) url = `${base}/productos/${handle}`;
    else if (base) url = `${base}/productos/${p.id}`;
    return {
      sku,
      name,
      category: pickCategory(p),
      description,
      baseUnit: 'unidad',
      basePriceArs: priceOrNull(v.promotional_price ?? v.price),
      basePriceUsd: null,
      inStock,
      stockQuantity: typeof v.stock === 'number' ? v.stock : null,
      attributes: { tiendanubeProductId: p.id, tiendanubeVariantId: v.id ?? null },
      active: p.published !== false,
      externalId: String(p.id),
      url,
    };
  }

  private async timed<T>(p: Promise<T>, ms: number): Promise<T> {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`tiendanube-timeout ${ms}ms`)), ms),
      ),
    ]);
  }
}
