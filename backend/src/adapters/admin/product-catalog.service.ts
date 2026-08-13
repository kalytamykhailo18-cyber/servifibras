/**
 * ADAPTERS LAYER — Product catalog service.
 *
 * Backbone of the Claude-grounded answer set. Marcos's brief: the AI must
 * not hallucinate SKUs or prices, so structured product rows go into the
 * system prompt instead of free text.
 *
 * The service is intentionally narrow:
 *   - CRUD (admin-only at the controller layer)
 *   - `formatForAI()` — pulls active products and renders a compact
 *     section the KnowledgeRepository can splice into Claude's system
 *     context.
 *   - `bulkUpsertFromExternal(rows, source)` — used by both the CSV
 *     import and (future) TiendaNube sync. Upsert by externalId when
 *     present, otherwise by SKU.
 *
 * Tunable in `.env`:
 *   PRODUCT_CATALOG_AI_LIMIT — max products to embed into the AI system
 *     prompt (default 200). Caps token cost on big catalogs.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient, ProductSource } from '@prisma/client';

export interface ProductInput {
  sku: string;
  name: string;
  category: string;
  description?: string | null;
  baseUnit?: string;
  basePriceArs?: number | null;
  basePriceUsd?: number | null;
  inStock?: boolean;
  stockQuantity?: number | null;
  // Per-product threshold for the low-stock alert; null falls back to the
  // global PRODUCT_LOW_STOCK_DEFAULT_THRESHOLD.
  lowStockThreshold?: number | null;
  attributes?: Record<string, unknown> | null;
  active?: boolean;
  url?: string | null;
  // Short alias the warehouse picker sees on the daily logistics file.
  // Marcos 2026-06-06 (Bloque C). On create with no alias supplied, we
  // auto-seed from the first 40 chars of `name` (cleaned). The operator
  // can edit it afterwards from the products admin UI.
  armadorAlias?: string | null;
}

/**
 * Default alias-for-armador: first N chars of the cleaned name with
 * collapsed whitespace. Marcos's picker scans these rapidly on the
 * daily Excel; 40 chars is the column width that lets the high-signal
 * tokens (resin family + presentation + size) fit on one line. Per-
 * product editing overrides this default whenever Marcos needs tighter
 * abbreviation.
 */
function defaultArmadorAlias(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 40).trim();
}

export interface ExternalProductRow extends ProductInput {
  externalId?: string | null;
}

function num(envKey: string, fallback: number): number {
  const v = process.env[envKey];
  const n = v != null ? Number(v) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Bidirectional alias map for fuzzy product intent matching. Marcos's
 * 2026-05-27 ask: "muchas veces la persona no sabe el nombre del
 * producto que busca. tiene que darle productos útiles a la persona y
 * concretar ventas". The map turns buyer-side intent terms ("para
 * piso", "almohadilla térmica", "mesa de río") into the canonical
 * product keywords the catalog ILIKE search recognises.
 *
 * Loaded from PRODUCT_SEARCH_ALIASES (JSON env). Shape:
 *   { "almohadilla térmica": ["almohadilla calefactor"], ... }
 * Each key is matched as a phrase (case-insensitive); on hit, its
 * synonyms are unioned into the token set before the SQL search runs.
 *
 * Defaults shipped here cover the patterns surfaced in the 65-grave
 * audit. Marcos can extend via .env without a deploy.
 */
const DEFAULT_PRODUCT_ALIASES: Record<string, string[]> = {
  'almohadilla térmica': ['almohadilla calefactor'],
  'almohadilla termica': ['almohadilla calefactor'],
  'calefactor lumbar': ['almohadilla calefactor'],
  'manta térmica': ['almohadilla calefactor'],
  'para piso': ['alto tránsito', 'porcelanato líquido'],
  'piso de taller': ['alto tránsito', 'porcelanato líquido'],
  'piso garage': ['alto tránsito', 'porcelanato líquido'],
  'piso garaje': ['alto tránsito', 'porcelanato líquido'],
  'mesa de río': ['altos espesores', 'epoxi mesa'],
  'mesa rio': ['altos espesores', 'epoxi mesa'],
  'rio table': ['altos espesores', 'epoxi mesa'],
  'arte epoxi': ['cristal artesanos', 'epoxi cristal'],
  'joyería resina': ['cristal artesanos', 'filtro uv'],
  'molde silicona': ['silicona platino'],
  'molde de silicona': ['silicona platino'],
  'fibra para barco': ['mat 300', 'fibra vidrio'],
  'fibra náutica': ['mat 300', 'fibra vidrio'],
  'parche tanque': ['mat 300', 'resina poliéster náutica'],
  'sellar tanque': ['mat 300', 'resina poliéster náutica'],
  // UV-cure path. Marcos's 2026-05-30 audit: customer asked "se seca
  // con lámpara UV?" on the Cristal-con-filtro-UV publication. That
  // "filtro UV" is photostabilizer (anti-yellowing), NOT UV curing.
  // The actual UV-cure product in catalog is RUV-50 ("Resina de
  // secado UV con Pico Vertedor"). When customer intent matches
  // UV-light curing, the search must lift onto the resina UV line.
  'lámpara uv': ['resina uv', 'curado uv'],
  'lampara uv': ['resina uv', 'curado uv'],
  'se cura con uv': ['resina uv', 'curado uv'],
  'curado uv': ['resina uv'],
  'cura por luz': ['resina uv', 'curado uv'],
  'fotocurado': ['resina uv', 'curado uv'],
  'resina fotocurable': ['resina uv'],
  'resina de secado uv': ['resina uv'],
};

let _aliasMapCache: Record<string, string[]> | null = null;
function loadAliasMap(): Record<string, string[]> {
  if (_aliasMapCache) return _aliasMapCache;
  const raw = process.env.PRODUCT_SEARCH_ALIASES;
  if (!raw) {
    _aliasMapCache = DEFAULT_PRODUCT_ALIASES;
    return _aliasMapCache;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const norm: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof k !== 'string') continue;
        const list = Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
        if (list.length > 0) norm[k.toLowerCase()] = list;
      }
      _aliasMapCache = { ...DEFAULT_PRODUCT_ALIASES, ...norm };
      return _aliasMapCache;
    }
  } catch {
    // fall through to defaults
  }
  _aliasMapCache = DEFAULT_PRODUCT_ALIASES;
  return _aliasMapCache;
}

/**
 * Expand a raw query into the original tokens plus alias-expansion
 * tokens. Phrase-matches first (so "almohadilla térmica" → "almohadilla
 * calefactor" doesn't get torn apart token-by-token), then per-token.
 * Returns deduped token list capped at 12 (the SQL already caps at 6,
 * but we surface more for the ranker).
 */
function expandQueryWithAliases(rawQuery: string): string[] {
  const aliases = loadAliasMap();
  const lower = rawQuery.toLowerCase();
  const expanded = new Set<string>();
  const tokens = lower
    .split(/[^a-záéíóúñü0-9]+/i)
    .filter((t) => t.length >= 2 && t.length < 40);
  for (const t of tokens) expanded.add(t);

  for (const [phrase, syns] of Object.entries(aliases)) {
    if (lower.includes(phrase)) {
      for (const syn of syns) {
        for (const t of syn.toLowerCase().split(/\s+/)) {
          if (t.length >= 2) expanded.add(t);
        }
      }
    }
  }
  return Array.from(expanded).slice(0, 12);
}

function trimmedOrNull(v: any): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function priceOrNull(v: any): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeSku(s: string): string {
  return s.trim().toUpperCase();
}

/**
 * Drop HTML tags + decode the most common entities, collapse whitespace,
 * trim to N chars with an ellipsis. Used to keep TiendaNube descriptions
 * (which arrive as full HTML) from blowing the Claude token budget when
 * 200+ products go into the system prompt.
 */
function stripHtmlAndTruncate(raw: string, maxChars: number): string {
  let s = raw
    .replace(/<[^>]+>/g, ' ')                 // strip tags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í').replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú').replace(/&ntilde;/gi, 'ñ')
    .replace(/&Aacute;/g, 'Á').replace(/&Eacute;/g, 'É')
    .replace(/&Iacute;/g, 'Í').replace(/&Oacute;/g, 'Ó')
    .replace(/&Uacute;/g, 'Ú').replace(/&Ntilde;/g, 'Ñ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > maxChars) s = s.slice(0, maxChars - 1).trimEnd() + '…';
  return s;
}

@Injectable()
export class ProductCatalogService {
  private readonly logger = new Logger(ProductCatalogService.name);
  private readonly prisma = new PrismaClient();

  async list(opts?: { activeOnly?: boolean; category?: string; search?: string }) {
    const where: Prisma.ProductWhereInput = {};
    if (opts?.activeOnly) where.active = true;
    if (opts?.category) where.category = opts.category;
    if (opts?.search && opts.search.trim().length > 0) {
      const q = opts.search.trim();
      // Match SKU + name only. Description matching seemed useful in
      // theory but the TiendaNube sync ships products with rich
      // descriptions that mention common terms ("resina", "epoxi",
      // "kit") in passing, so a search for "resina" was returning
      // 500+ items where most had the word only inside an unrelated
      // accessory description. Targeted SKU+name matches make the
      // register-pedido picker actually useful.
      where.OR = [
        { sku: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.product.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      take: 500,
    });
  }

  async getById(id: string) {
    return this.prisma.product.findUnique({ where: { id } });
  }

  async create(input: ProductInput) {
    const sku = normalizeSku(this.requireString(input.sku, 'sku'));
    const name = this.requireString(input.name, 'name').trim();
    const category = this.requireString(input.category, 'category').trim();
    try {
      const aliasInput = trimmedOrNull(input.armadorAlias);
      return await this.prisma.product.create({
        data: {
          sku,
          name,
          category,
          description: trimmedOrNull(input.description),
          baseUnit: input.baseUnit?.trim() || 'unidad',
          basePriceArs: priceOrNull(input.basePriceArs),
          basePriceUsd: priceOrNull(input.basePriceUsd),
          inStock: input.inStock !== false,
          stockQuantity: input.stockQuantity != null ? Number(input.stockQuantity) : null,
          lowStockThreshold: input.lowStockThreshold != null ? Number(input.lowStockThreshold) : null,
          attributes: (input.attributes ?? null) as any,
          active: input.active !== false,
          source: ProductSource.MANUAL,
          // Auto-seed the picker alias on creation when the operator
          // didn't supply one explicitly — Marcos's preferred default
          // is the first 40 chars of the clean name.
          armadorAlias: aliasInput ?? defaultArmadorAlias(name),
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new Error(`SKU "${sku}" already exists`);
      }
      throw err;
    }
  }

  async update(id: string, input: Partial<ProductInput>) {
    const data: Prisma.ProductUpdateInput = {};
    if (input.sku != null)             data.sku = normalizeSku(input.sku);
    if (input.name != null)            data.name = input.name.trim();
    if (input.category != null)        data.category = input.category.trim();
    if (input.description !== undefined) data.description = trimmedOrNull(input.description);
    if (input.baseUnit != null)        data.baseUnit = input.baseUnit.trim() || 'unidad';
    if (input.basePriceArs !== undefined) data.basePriceArs = priceOrNull(input.basePriceArs);
    if (input.basePriceUsd !== undefined) data.basePriceUsd = priceOrNull(input.basePriceUsd);
    if (input.inStock != null)         data.inStock = input.inStock;
    if (input.stockQuantity !== undefined) data.stockQuantity = input.stockQuantity != null ? Number(input.stockQuantity) : null;
    if (input.lowStockThreshold !== undefined) data.lowStockThreshold = input.lowStockThreshold != null ? Number(input.lowStockThreshold) : null;
    if (input.attributes !== undefined) data.attributes = (input.attributes ?? null) as any;
    if (input.active != null)          data.active = input.active;
    if (input.armadorAlias !== undefined) data.armadorAlias = trimmedOrNull(input.armadorAlias);
    try {
      const updated = await this.prisma.product.update({ where: { id }, data });
      // Hand off to whoever wired the stock-update hook (LowStockAlertService
      // in production). Fire-and-forget so the operator's PUT response doesn't
      // wait on the alert path.
      if (this.stockHook && (input.stockQuantity !== undefined || input.lowStockThreshold !== undefined || input.active != null)) {
        void Promise.resolve(this.stockHook([id])).catch(() => {});
      }
      return updated;
    } catch (err: any) {
      if (err?.code === 'P2002') throw new Error('SKU already in use');
      if (err?.code === 'P2025') return null;
      throw err;
    }
  }

  // ─── Stock-update hook ────────────────────────────────────────────────
  // The catalog service stays free of any AI/notification dependency; the
  // module wires an external listener (LowStockAlertService) here at boot.
  private stockHook: ((productIds: string[]) => void | Promise<void>) | null = null;
  setOnStockUpdated(hook: (productIds: string[]) => void | Promise<void>): void {
    this.stockHook = hook;
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.product.delete({ where: { id } });
      return true;
    } catch (err: any) {
      if (err?.code === 'P2025') return false;
      throw err;
    }
  }

  /**
   * Soft-delete by external id (TN product id, ML item id, etc.). Flips
   * `active=false` and updates `lastSyncedAt`. Returns whether a row
   * matched. Hard delete would orphan order/quote line-items that point
   * at this product id.
   */
  async deactivateByExternalId(externalId: string, source: ProductSource): Promise<boolean> {
    const r = await this.prisma.product.updateMany({
      where: { externalId, source },
      data: { active: false, lastSyncedAt: new Date() },
    });
    return r.count > 0;
  }

  /**
   * Render the active catalog into a compact Markdown block for Claude's
   * system prompt. Trimmed to PRODUCT_CATALOG_AI_LIMIT rows so a 5000-SKU
   * catalog doesn't blow the token budget. Descriptions are stripped of
   * HTML and capped at PRODUCT_CATALOG_AI_DESC_CHARS chars per row —
   * TiendaNube exports long HTML-laden descriptions that quickly push
   * the prompt past Anthropic's 1M-token cap.
   */
  /**
   * Whitelist of public product URLs that the agent is allowed to
   * include in customer-facing replies. Used by `ClaudeService` to
   * strip any URL that Claude hallucinates (e.g. fabricating a slug
   * that "sounds right" but doesn't map to a real TiendaNube product).
   * Cheap to compute, refreshed alongside the catalog block.
   *
   * Marcos's 2026-05-18 brief: "está inventando links!" — concretely,
   * the agent improvised tiendaservifibras.com/productos/resina-epoxi-cristal
   * which doesn't exist. This is the server-side defence so even when
   * the prompt rule isn't respected, the fabricated link never reaches
   * the customer.
   */
  /**
   * Marcos 2026-08-13 (WhatsApp 13:12 AR — caso "kit 6L $58.500"):
   * el agente inventó un precio ($58.500) para un producto cuyo
   * precio real en el catálogo es $198.999. El guard de salida sólo
   * miraba URLs, no números. Este método expone el set de precios
   * válidos del catálogo (basePriceArs de productos activos) para
   * que ClaudeService lo use como whitelist de la nueva capa de
   * guard de precios: si el mensaje del agente contiene un número
   * en pesos que no coincide con ninguno de estos, se strippea.
   * Redondeamos a peso entero — la agente nunca escribe centavos.
   */
  async getActiveCatalogPrices(): Promise<Set<number>> {
    const rows = await this.prisma.product.findMany({
      where: { active: true, basePriceArs: { not: null } },
      select: { basePriceArs: true },
    });
    const set = new Set<number>();
    for (const r of rows) {
      const raw = r.basePriceArs as any;
      const num = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(num) || num <= 0) continue;
      set.add(Math.round(num));
    }
    return set;
  }

  async getActiveCatalogUrls(): Promise<Set<string>> {
    const rows = await this.prisma.product.findMany({
      where: { active: true, url: { not: null } },
      select: { url: true },
    });
    const set = new Set<string>();
    for (const r of rows) {
      if (!r.url) continue;
      set.add(r.url);
      // Tolerate trailing-slash variants — the agent occasionally
      // appends or drops a slash. Both forms should resolve as valid.
      if (r.url.endsWith('/')) set.add(r.url.slice(0, -1));
      else set.add(r.url + '/');
    }
    return set;
  }

  /**
   * Map of TiendaNube product URL → MercadoLibre article permalink for
   * every active product where both exist. Used by the ML output
   * scrubber to swap a TN URL the agent emitted for the per-product
   * ML article URL — matches Prometheo's old behaviour of dropping
   * the article link directly into the answer. Marcos's 2026-06-01
   * ask: "esto hacía PROMETHEO! enviaba links de mercadolibre".
   */
  async getCatalogUrlToMlPermalinkMap(): Promise<Map<string, string>> {
    const rows = await this.prisma.product.findMany({
      where: { active: true, url: { not: null }, mlPermalink: { not: null } },
      select: { url: true, mlPermalink: true },
    });
    const map = new Map<string, string>();
    for (const r of rows) {
      if (!r.url || !r.mlPermalink) continue;
      map.set(r.url, r.mlPermalink);
      if (r.url.endsWith('/')) map.set(r.url.slice(0, -1), r.mlPermalink);
      else map.set(r.url + '/', r.mlPermalink);
    }
    return map;
  }

  /**
   * Marcos 2026-07-13 (A2 refinamiento): además del mapeo TN→ML,
   * necesitamos la lista COMPLETA de permalinks ML válidos para el
   * whitelist post-scrub. La versión anterior sólo aprobaba URLs que
   * matcheaban con productos que tenían BOTH TN y ML — dejaba afuera
   * los productos que están SOLO en ML (varios de catálogo interno).
   */
  async getAllMlPermalinks(): Promise<Set<string>> {
    const rows = await this.prisma.product.findMany({
      where: { mlPermalink: { not: null } },
      select: { mlPermalink: true },
    });
    const set = new Set<string>();
    for (const r of rows) {
      if (!r.mlPermalink) continue;
      const norm = r.mlPermalink.replace(/\/$/, '');
      set.add(norm);
      set.add(norm + '/');
    }
    return set;
  }

  /**
   * Marcos 2026-07-13 (A2 seguimiento): además del set de permalinks
   * completos, exponemos el set de itemIds (`MLA<digits>`) que sabemos
   * que son publicaciones reales. Fuente = ml_publication_knowledge
   * (734+ itemIds a la fecha). El scrub de URLs va a matchear la parte
   * numerica del URL (MLA-XXXX del permalink) contra este set — cubre
   * publicaciones nuestras aunque no estén en el catálogo (Prod) local.
   */
  async getAllMlItemIds(): Promise<Set<string>> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ itemId: string }>>(
      `SELECT DISTINCT "itemId" FROM ml_publication_knowledge WHERE "itemId" IS NOT NULL`,
    );
    return new Set(rows.map((r) => r.itemId).filter(Boolean));
  }

  /**
   * Marcos 2026-07-14 (C2 del documento): mapa SKU → URLs por canal.
   * El agente emite un marcador `{{link:SKU-XXX}}` en la respuesta;
   * el post-procesador lo reemplaza por la URL correcta del catálogo
   * (TN para canales privados, ML para MercadoLibre). Como el link
   * final SIEMPRE viene del catálogo — nunca lo escribe el modelo —
   * inventar un link se vuelve imposible por construcción.
   */
  async getSkuToUrlMap(): Promise<Map<string, { tn: string | null; ml: string | null }>> {
    const rows = await this.prisma.product.findMany({
      where: { active: true },
      select: { sku: true, url: true, mlPermalink: true },
    });
    const map = new Map<string, { tn: string | null; ml: string | null }>();
    for (const r of rows) {
      if (!r.sku) continue;
      map.set(r.sku, { tn: r.url ?? null, ml: r.mlPermalink ?? null });
      // Also index by lowercased SKU for tolerant match — agents
      // sometimes lowercase the marker.
      const lower = r.sku.toLowerCase();
      if (lower !== r.sku) {
        map.set(lower, { tn: r.url ?? null, ml: r.mlPermalink ?? null });
      }
    }
    return map;
  }

  /**
   * Search the active catalog by free-text query — used by the AI tool
   * `buscar_producto`. Replaces the "dump every product into the system
   * prompt" approach (~20k tokens per turn) with on-demand retrieval
   * (~500-1500 tokens per turn, only when the agent actually needs
   * catalog data). Marcos's 2026-05-18 brief: the CRM consumes more
   * than prometheo because we dump the whole catalog every turn —
   * this is the fix.
   *
   * Strategy: tokenise the query, score each product by:
   *   - exact SKU match           (highest signal, end-customer almost
   *                                never types these but the agent does
   *                                when echoing the catalog)
   *   - name ILIKE '%token%'      (primary signal)
   *   - category ILIKE '%token%'  (secondary — "para artesanías")
   *   - description ILIKE '%token%' (fallback for technical specs)
   *
   * Returns the top N products with the same compact shape the prompt
   * block used so the agent can paste fields verbatim. Out-of-stock
   * rows are included but flagged so the agent can mention they're
   * unavailable without inventing alternatives.
   */
  async searchForAI(
    query: string,
    limit: number = 20,
  ): Promise<string> {
    const trimmed = (query ?? '').trim();
    if (!trimmed) return '';
    const descChars = num('PRODUCT_CATALOG_AI_DESC_CHARS', 500);
    // Tokenise + alias-expand. Alias expansion lifts buyer-side intent
    // phrases ("almohadilla térmica", "piso de taller", "mesa de río")
    // onto canonical product terms so the existing ILIKE scorer fires.
    const tokens = expandQueryWithAliases(trimmed);
    // Build an OR group across SKU exact + name/category/description
    // ILIKE per token. Prisma can handle this via raw — easier than
    // composing nested AND/OR shapes.
    const exactSku = trimmed.toUpperCase();
    // Use the raw form for case-insensitive prefix/contains across
    // multiple columns. Each token adds 4 OR-clauses; cap tokens at 6
    // so an essay-length query doesn't blow up the planner.
    const useTokens = tokens.slice(0, 6);
    if (useTokens.length === 0 && !exactSku) return '';

    // Raw SQL gives us tighter control over scoring + caps the result
    // set at the DB layer. Score = sum of per-token hits weighted by
    // column importance. Higher score = better match.
    const params: any[] = [];
    const tokenClauses: string[] = [];
    for (const t of useTokens) {
      const like = `%${t}%`;
      params.push(like, like, like);
      tokenClauses.push(
        `(LOWER(name) LIKE $${params.length - 2} ` +
        `OR LOWER(category) LIKE $${params.length - 1} ` +
        `OR LOWER(COALESCE(description, '')) LIKE $${params.length})`,
      );
    }
    params.push(exactSku);
    const skuParamIdx = params.length;
    params.push(limit);
    const limitParamIdx = params.length;

    const where = tokenClauses.length > 0
      ? `(active = true AND (${tokenClauses.join(' OR ')} OR sku = $${skuParamIdx}))`
      : `(active = true AND sku = $${skuParamIdx})`;

    const scoreExpr = useTokens
      .map((t, i) => {
        const nameIdx = params.indexOf(`%${t}%`, i * 3) + 1;
        // Each token contributes: 3 pts for name match, 1 pt for
        // category match, 1 pt for description match.
        return (
          `(CASE WHEN LOWER(name) LIKE $${nameIdx} THEN 3 ELSE 0 END) + ` +
          `(CASE WHEN LOWER(category) LIKE $${nameIdx + 1} THEN 1 ELSE 0 END) + ` +
          `(CASE WHEN LOWER(COALESCE(description, '')) LIKE $${nameIdx + 2} THEN 1 ELSE 0 END)`
        );
      })
      .join(' + ');
    const scoreSql = scoreExpr.length > 0
      ? `${scoreExpr} + (CASE WHEN sku = $${skuParamIdx} THEN 100 ELSE 0 END)`
      : `(CASE WHEN sku = $${skuParamIdx} THEN 100 ELSE 0 END)`;

    const sql = `
      SELECT id, sku, name, category, description, "baseUnit",
             "basePriceArs", "basePriceUsd", "inStock", "stockQuantity",
             url, "mlPermalink", ${scoreSql} AS _score
      FROM products
      WHERE ${where}
      ORDER BY _score DESC, name ASC
      LIMIT $${limitParamIdx}
    `;

    const rows = await this.prisma.$queryRawUnsafe<Array<any>>(sql, ...params);
    if (rows.length === 0) {
      return `(sin resultados para "${trimmed}")`;
    }

    // Marcos's rule (2026-05-20): SKU is internal — never echoed to the
    // customer. Customers see name + presentation/unidad + price + link.
    // Removing SKU from the tool result entirely is the root-cause fix:
    // if the agent doesn't see it, it can't leak it. Server-side audit
    // tables / order systems still join on Product.sku via name lookup,
    // so we lose nothing on the back-of-house side.
    let out = `Resultados para "${trimmed}":\n\n`;
    for (const p of rows) {
      const price = p.basePriceArs != null
        ? `ARS ${p.basePriceArs}`
        : p.basePriceUsd != null
          ? `USD ${p.basePriceUsd}`
          : 'precio a confirmar';
      const stock = p.inStock ? 'en stock' : 'SIN STOCK';
      out += `- ${p.name} (presentación: ${p.baseUnit}) — ${price} — ${stock}`;
      // Surface BOTH links when present. The TiendaNube URL is used on
      // webchat / WhatsApp (where external domains are allowed). The
      // ML article permalink (mlPermalink) is used on the ML channel —
      // ML permits its own mercadolibre.com.ar links and the agent is
      // encouraged to drop the article link directly so the buyer can
      // click into the listing. Tagging each link distinctly lets the
      // channel guardrail prompt pick the right one without the agent
      // having to introspect channel state.
      if (p.url) out += ` — link: ${p.url}`;
      if (p.mlPermalink) out += ` — link ML: ${p.mlPermalink}`;
      if (p.description) {
        const cleaned = stripHtmlAndTruncate(p.description, descChars);
        if (cleaned) out += `\n  ${cleaned}`;
      }
      out += '\n';
    }
    return out;
  }

  async formatForAI(): Promise<string> {
    const limit = num('PRODUCT_CATALOG_AI_LIMIT', 200);
    const descChars = num('PRODUCT_CATALOG_AI_DESC_CHARS', 160);
    const items = await this.prisma.product.findMany({
      where: { active: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      take: limit,
    });
    if (items.length === 0) return '';

    let out = '## Catálogo de productos\n\n';
    out += 'Estos son los productos reales con precio actual. ';
    out += 'No inventes precios ni stock — usá EXACTAMENTE los datos de esta tabla. ';
    out += 'Mostrale al cliente el NOMBRE + PRESENTACIÓN/UNIDAD + PRECIO + LINK, nunca un código interno.\n\n';

    const byCat = new Map<string, typeof items>();
    for (const p of items) {
      const arr = byCat.get(p.category) ?? [];
      arr.push(p); byCat.set(p.category, arr);
    }
    for (const [cat, prods] of byCat) {
      out += `### ${cat}\n`;
      for (const p of prods) {
        const price = p.basePriceArs != null ? `ARS ${p.basePriceArs}` : (p.basePriceUsd != null ? `USD ${p.basePriceUsd}` : 'precio a confirmar');
        const stock = p.inStock ? 'en stock' : 'sin stock';
        out += `- ${p.name} (presentación: ${p.baseUnit}) — ${price} — ${stock}`;
        // Public URL stays on a `link:` token at the END of the row so
        // Claude can copy it verbatim into a customer reply when asked.
        // Prompted explicitly in Lucas v5: "si el cliente pide link,
        // pegá el link que figura en el catálogo".
        if (p.url) out += ` — link: ${p.url}`;
        if (p.description) {
          const cleaned = stripHtmlAndTruncate(p.description, descChars);
          if (cleaned) out += ` — ${cleaned}`;
        }
        out += '\n';
      }
      out += '\n';
    }
    return out;
  }

  /**
   * Bulk upsert path used by CSV import and TiendaNube sync. Upserts by
   * `externalId` when provided (sync use case) and falls back to SKU
   * (CSV use case). Returns counts: created / updated / skipped.
   *
   * `source` is stamped on every row so we can tell at-a-glance which
   * products are owner-managed vs sync-managed.
   */
  async bulkUpsertFromExternal(
    rows: ExternalProductRow[],
    source: ProductSource,
  ): Promise<{ created: number; updated: number; skipped: number; errors: string[] }> {
    let created = 0, updated = 0, skipped = 0;
    const errors: string[] = [];
    const touchedIds: string[] = [];

    for (const raw of rows) {
      try {
        const sku = trimmedOrNull(raw.sku);
        const name = trimmedOrNull(raw.name);
        const category = trimmedOrNull(raw.category);
        if (!sku || !name || !category) {
          skipped++;
          errors.push(`Skipped row missing sku/name/category: ${JSON.stringify(raw).slice(0, 80)}`);
          continue;
        }
        const externalId = trimmedOrNull(raw.externalId);
        // URL: prefer what the sync caller already resolved (TN handle ⇒
        // permalink). Fall back to a constructed link from
        // TIENDANUBE_STORE_BASE_URL + externalId so we never leave the
        // field empty for sync products — the agent's "no tengo link"
        // failure mode is specifically what this guards against.
        let url = trimmedOrNull(raw.url);
        if (!url && externalId && source === ProductSource.TIENDANUBE) {
          const base = (process.env.TIENDANUBE_STORE_BASE_URL || '').replace(/\/+$/, '');
          if (base) url = `${base}/productos/${externalId}`;
        }
        const data = {
          sku: normalizeSku(sku),
          name,
          category,
          description: trimmedOrNull(raw.description),
          baseUnit: raw.baseUnit?.trim() || 'unidad',
          basePriceArs: priceOrNull(raw.basePriceArs),
          basePriceUsd: priceOrNull(raw.basePriceUsd),
          inStock: raw.inStock !== false,
          stockQuantity: raw.stockQuantity != null ? Number(raw.stockQuantity) : null,
          lowStockThreshold: raw.lowStockThreshold != null ? Number(raw.lowStockThreshold) : null,
          attributes: (raw.attributes ?? null) as any,
          active: raw.active !== false,
          source,
          externalId,
          url,
          lastSyncedAt: source === ProductSource.MANUAL ? null : new Date(),
        };

        // Find existing row by externalId first (sync), then by SKU
        // (manual / csv).
        const existing = externalId
          ? await this.prisma.product.findFirst({ where: { externalId, source } })
          : await this.prisma.product.findUnique({ where: { sku: data.sku } });

        if (existing) {
          const row = await this.prisma.product.update({ where: { id: existing.id }, data });
          updated++;
          if (data.stockQuantity != null) touchedIds.push(row.id);
        } else {
          const row = await this.prisma.product.create({ data });
          created++;
          if (data.stockQuantity != null) touchedIds.push(row.id);
        }
      } catch (err: any) {
        skipped++;
        errors.push(err.message);
      }
    }

    this.logger.log(
      `Bulk upsert (${source}): created=${created} updated=${updated} skipped=${skipped}`,
    );
    if (this.stockHook && touchedIds.length > 0) {
      void Promise.resolve(this.stockHook(touchedIds)).catch(() => {});
    }
    return { created, updated, skipped, errors };
  }

  private requireString(v: any, field: string): string {
    if (typeof v !== 'string' || v.trim().length === 0) {
      throw new Error(`${field} is required`);
    }
    return v;
  }
}
