/**
 * ADAPTERS LAYER — ML competitor tracking (Bloque A item 3).
 *
 * Marcos 2026-06-06 ask: for each Servifibras product, surface the
 * competing ML listings so Marcos can see who's selling the same
 * thing, at what price, and how much they've moved.
 *
 * Data source pivot (2026-06-08): ML locked down their public site
 * search (`/sites/MLA/search` → HTTP 403 with or without auth).
 * Catalog product search (`/products/search`) returns metadata but
 * not seller-level price/stock data without buy_box_winners (which
 * are sparsely populated). The reliable path that's still open is
 * the per-item endpoint `/items/{itemId}` — works with any
 * authenticated ML token and returns full listing data.
 *
 * So the watch-list model: the operator pastes one or more
 * competitor item IDs (MLA...) per Servifibras product from the
 * panel; we fetch their live data on demand. No background sync
 * for v1 — refreshes happen on dashboard load (with a short cache).
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { MlCompetitorWatch, PrismaClient } from '@prisma/client';
import type { MercadoLibreService } from '../mercadolibre/mercadolibre.service';
import { MERCADOLIBRE_SERVICE } from '../../use-cases/mercadolibre/mercadolibre.token';

export interface MlCompetitorLive {
  watchId: string;
  itemId: string;
  label: string | null;
  title: string | null;
  sellerId: string | null;
  sellerNickname: string | null;
  price: number | null;
  currencyId: string | null;
  soldQuantity: number | null;
  availableQuantity: number | null;
  condition: string | null;
  status: string | null;
  permalink: string | null;
  thumbnail: string | null;
  isFreeShipping: boolean;
  hasMercadoFull: boolean;
  fetchedAt: string;
  fetchError: string | null;
}

export interface MlCompetitorsSnapshot {
  productId: string;
  productSku: string;
  productName: string;
  productPriceArs: number | null;
  ourStock: number | null;
  watches: MlCompetitorLive[];
}

@Injectable()
export class MlCompetitorsService {
  private readonly logger = new Logger(MlCompetitorsService.name);
  private readonly prisma = new PrismaClient();
  // Per-itemId cache so dashboard reloads don't hammer ML when the
  // operator adds 10 watches and opens the product detail twice.
  private readonly itemCache = new Map<string, { at: number; data: any | null; error: string | null }>();

  constructor(
    @Optional() @Inject(MERCADOLIBRE_SERVICE)
    private readonly mercadolibre?: MercadoLibreService,
  ) {}

  private cacheTtlMs(): number {
    const n = Number(process.env.ML_COMPETITORS_CACHE_MS);
    return Number.isFinite(n) && n > 0 ? n : 10 * 60 * 1000;
  }

  async addWatch(args: {
    productId: string;
    itemId: string;
    label?: string | null;
    createdById: string | null;
  }): Promise<MlCompetitorWatch> {
    const itemId = args.itemId.trim();
    if (!/^MLA\d{6,15}$/i.test(itemId)) {
      throw new Error('itemId must look like "MLA<numbers>"');
    }
    const productExists = await this.prisma.product.findUnique({
      where: { id: args.productId },
      select: { id: true },
    });
    if (!productExists) throw new Error(`Product ${args.productId} not found`);
    const existing = await this.prisma.mlCompetitorWatch.findUnique({
      where: { productId_itemId: { productId: args.productId, itemId: itemId.toUpperCase() } },
    });
    if (existing) return existing;
    return this.prisma.mlCompetitorWatch.create({
      data: {
        productId: args.productId,
        itemId: itemId.toUpperCase(),
        label: args.label?.trim()?.slice(0, 120) || null,
        createdById: args.createdById ?? null,
      },
    });
  }

  async removeWatch(watchId: string): Promise<boolean> {
    try {
      await this.prisma.mlCompetitorWatch.delete({ where: { id: watchId } });
      return true;
    } catch (err: any) {
      if (err?.code === 'P2025') return false;
      throw err;
    }
  }

  /**
   * Marcos 2026-06-24: vista agregada — todos los productos con
   * algún competidor cargado + sus watches en vivo. Sirve para la
   * página /competidores centralizada. No incluye productos sin
   * watches (la lista es de "qué estoy siguiendo").
   */
  async listAll(args: { force?: boolean } = {}): Promise<MlCompetitorsSnapshot[]> {
    const watches = await this.prisma.mlCompetitorWatch.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        product: {
          select: { id: true, sku: true, name: true, basePriceArs: true, stockQuantity: true },
        },
      },
    });
    if (watches.length === 0) return [];
    // Group por producto preservando el orden de inserción del primer watch.
    const byProduct = new Map<string, {
      product: typeof watches[number]['product'];
      watches: typeof watches;
    }>();
    for (const w of watches) {
      if (!w.product) continue;
      const g = byProduct.get(w.product.id) ?? { product: w.product, watches: [] };
      g.watches.push(w);
      byProduct.set(w.product.id, g);
    }
    const out: MlCompetitorsSnapshot[] = [];
    for (const { product, watches: ws } of byProduct.values()) {
      const live: MlCompetitorLive[] = [];
      for (const w of ws) {
        const fetched = await this.fetchItem(w.itemId, args.force === true);
        live.push(this.mapWatch(w, fetched));
      }
      out.push({
        productId: product.id,
        productSku: product.sku,
        productName: product.name,
        productPriceArs: product.basePriceArs ? Number(product.basePriceArs) : null,
        ourStock: product.stockQuantity ?? null,
        watches: live,
      });
    }
    return out;
  }

  async listForProduct(args: {
    productId: string;
    force?: boolean;
  }): Promise<MlCompetitorsSnapshot> {
    const product = await this.prisma.product.findUnique({
      where: { id: args.productId },
      select: {
        id: true,
        sku: true,
        name: true,
        basePriceArs: true,
        stockQuantity: true,
      },
    });
    if (!product) throw new Error(`Product ${args.productId} not found`);
    const watches = await this.prisma.mlCompetitorWatch.findMany({
      where: { productId: args.productId },
      orderBy: { createdAt: 'asc' },
    });
    const live: MlCompetitorLive[] = [];
    for (const w of watches) {
      const fetched = await this.fetchItem(w.itemId, args.force === true);
      live.push(this.mapWatch(w, fetched));
    }
    return {
      productId: product.id,
      productSku: product.sku,
      productName: product.name,
      productPriceArs: product.basePriceArs ? Number(product.basePriceArs) : null,
      ourStock: product.stockQuantity ?? null,
      watches: live,
    };
  }

  private mapWatch(
    w: MlCompetitorWatch,
    fetched: { at: number; data: any | null; error: string | null },
  ): MlCompetitorLive {
    const item = fetched.data;
    return {
      watchId: w.id,
      itemId: w.itemId,
      label: w.label,
      title: typeof item?.title === 'string' ? item.title : null,
      sellerId: item?.seller_id != null ? String(item.seller_id) : null,
      sellerNickname:
        (typeof item?.seller_address?.city?.name === 'string' && null) ||
        (typeof item?.seller?.nickname === 'string' && item.seller.nickname) ||
        null,
      price: typeof item?.price === 'number' ? item.price : null,
      currencyId: typeof item?.currency_id === 'string' ? item.currency_id : null,
      soldQuantity: typeof item?.sold_quantity === 'number' ? item.sold_quantity : null,
      availableQuantity:
        typeof item?.available_quantity === 'number' ? item.available_quantity : null,
      condition: typeof item?.condition === 'string' ? item.condition : null,
      status: typeof item?.status === 'string' ? item.status : null,
      permalink: typeof item?.permalink === 'string' ? item.permalink : null,
      thumbnail:
        typeof item?.thumbnail === 'string'
          ? item.thumbnail
          : Array.isArray(item?.pictures) && typeof item.pictures[0]?.url === 'string'
            ? item.pictures[0].url
            : null,
      isFreeShipping: Boolean(item?.shipping?.free_shipping),
      hasMercadoFull: item?.shipping?.logistic_type === 'fulfillment',
      fetchedAt: new Date(fetched.at).toISOString(),
      fetchError: fetched.error,
    };
  }

  private async fetchItem(
    itemId: string,
    force: boolean,
  ): Promise<{ at: number; data: any | null; error: string | null }> {
    if (!force) {
      const cached = this.itemCache.get(itemId);
      if (cached && Date.now() - cached.at < this.cacheTtlMs()) {
        return cached;
      }
    }
    const apiUrl = process.env.MERCADOLIBRE_API_URL || 'https://api.mercadolibre.com';
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.mercadolibre) {
      try {
        const auth = await this.mercadolibre.resolveAuthFor('mercadolibre');
        if (auth?.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`;
      } catch {
        /* non-fatal — request goes anonymous and may 401 */
      }
    }
    try {
      const r = await fetch(`${apiUrl}/items/${itemId}`, { method: 'GET', headers });
      if (!r.ok) {
        const entry = {
          at: Date.now(),
          data: null,
          error: `HTTP ${r.status}`,
        };
        this.itemCache.set(itemId, entry);
        return entry;
      }
      const data = await r.json();
      const entry = { at: Date.now(), data, error: null };
      this.itemCache.set(itemId, entry);
      return entry;
    } catch (err: any) {
      const entry = { at: Date.now(), data: null, error: err?.message ?? 'fetch failed' };
      this.itemCache.set(itemId, entry);
      return entry;
    }
  }
}
