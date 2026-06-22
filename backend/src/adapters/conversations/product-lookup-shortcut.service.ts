/**
 * ADAPTERS LAYER — Pre-AI Product lookup shortcut (precio / stock).
 *
 * Bloque E item 1 (Marcos 2026-06-06 cost optimisation): when a
 * customer asks something simple-and-unambiguous like "precio?" or
 * "¿hay stock?" on a known product, answer from the local catalog
 * without burning a Claude call. The agent still handles anything
 * with extra intent (cotización por volumen, uso técnico,
 * combinación), this is the cheap fast path for single-shot price /
 * availability questions.
 *
 * Two contexts:
 *   1. MercadoLibre pre-venta — the publication context is already
 *      attached to the turn (mlListing has price + availableQuantity
 *      + title). If the question matches a simple price/stock
 *      pattern, render a templated answer; the channel's greeting /
 *      signoff wrapper runs upstream as usual.
 *   2. WhatsApp / Webchat — the customer typed a product name or
 *      SKU. We try an exact + fuzzy match against the local Product
 *      catalog. Only fires when the match is unambiguous (exactly
 *      one row) — otherwise we fall through to Claude so the agent
 *      can disambiguate.
 *
 * Returns `null` when no shortcut applies and the conversation
 * handler should fall through to the AI pipeline. Returns the
 * canned reply string otherwise.
 *
 * Tunable via `.env`:
 *   PRODUCT_LOOKUP_SHORTCUT_ENABLED — 'true' / 'false' (default true)
 */

import { Injectable, Logger } from '@nestjs/common';
import { Channel, PrismaClient, Product } from '@prisma/client';

function isEnabled(): boolean {
  const raw = process.env.PRODUCT_LOOKUP_SHORTCUT_ENABLED;
  if (raw == null || raw.trim().length === 0) return true;
  return raw.trim().toLowerCase() === 'true';
}

/**
 * Marcos 2026-06-22 — kill switch separado para el atajo ML.
 *
 * Root cause de un patrón de bugs recurrente: tryMlReply matcheaba
 * `tenés` (intent=stock) y devolvía "Sí, [PUBLICACIÓN ACTUAL] está
 * con stock disponible" — Claude nunca veía la pregunta. Funcionaba
 * bien para "¿tenés stock?" pero rompía en "¿tenés alcohol
 * isopropílico?" (MLA2602955662) y otros patrones donde el comprador
 * pide un PRODUCTO DIFERENTE. La regla BLOQUEO ABSOLUTO del prompt
 * habría manejado esto correctamente vía buscar_producto si el atajo
 * no lo hubiera interceptado.
 *
 * Ahorro de costo del atajo: marginal (Haiku $0.012/q × ~30 calls/día
 * = $0.36/mes). Costo de cada falso positivo: confianza del operador
 * + pérdida de venta. Default OFF; reactivable vía env si Marcos lo
 * pide después con reglas más estrictas.
 */
function isMlShortcutEnabled(): boolean {
  const raw = process.env.PRODUCT_LOOKUP_SHORTCUT_ML_ENABLED;
  if (raw == null || raw.trim().length === 0) return false;
  return raw.trim().toLowerCase() === 'true';
}

// Lightweight intent detector. Targets the high-frequency one-liner
// shapes Marcos sees most: "precio?", "¿cuánto sale?", "tenés stock?".
// Anything that hints at extra reasoning (cantidad, dimensiones,
// proyecto, uso) trips one of the disqualifier regexes and we punt
// to the AI so the agent can reason properly.
const PRICE_INTENT_RE =
  /\b(precio|cu[aá]nto\s+(?:sale|cuesta|me\s+sale|cobran|sale\s+ahora)|cu[aá]l\s+es\s+el\s+precio|valor|cu[aá]nto\s+vale)\b/i;
const STOCK_INTENT_RE =
  /\b(stock|disponib(?:le|ilidad)|hay|ten[eé]s|qued(?:a|an)|disponen|disponible)\b/i;
const DISQUALIFIER_RE =
  /\b(\d+\s*(?:m\s*[²2]|metros?|mts?|kg|kilo|kilos|litros?|lts?|unidad(?:es)?)|presupuest(?:o|ar|ame)|cotizac?[io]n|cotiz[aá]me|para\s+(?:hacer|reparar|recubrir|sellar|mesa|piso|pileta|barco|n[aá]utica|laminar|laminado)|combo|kit|por\s+volumen|mayorista|descuento|env[ií]o\s+a)\b/i;

function classifyIntent(text: string): 'price' | 'stock' | 'price+stock' | null {
  if (!text) return null;
  const t = text.trim();
  if (t.length === 0 || t.length > 280) return null;
  // Disqualifiers — any hint of extra reasoning → no shortcut.
  if (DISQUALIFIER_RE.test(t)) return null;
  const hasPrice = PRICE_INTENT_RE.test(t);
  const hasStock = STOCK_INTENT_RE.test(t);
  if (hasPrice && hasStock) return 'price+stock';
  if (hasPrice) return 'price';
  if (hasStock) return 'stock';
  return null;
}

function formatArs(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  // Argentina convention: "$1.234,56" — same format Marcos's UI uses.
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  })
    .format(amount)
    .replace(/ /g, ' ');
}

function stockSummary(qty: number | null | undefined, inStock: boolean): string {
  if (!inStock) return 'sin stock por ahora';
  if (qty == null || !Number.isFinite(qty)) return 'con stock disponible';
  if (qty <= 0) return 'sin stock por ahora';
  if (qty < 5) return `pocas unidades disponibles (${Math.floor(qty)})`;
  return 'con stock disponible';
}

@Injectable()
export class ProductLookupShortcutService {
  private readonly logger = new Logger(ProductLookupShortcutService.name);
  private readonly prisma = new PrismaClient();

  /**
   * ML pre-venta variant. Caller provides the mercadolibreListing
   * already fetched for the turn (title + price + availableQuantity
   * + permalink). Returns a templated answer when the question is
   * unambiguous price/stock, else null.
   */
  async tryMlReply(args: {
    text: string;
    listing: {
      title: string | null;
      price: number | null;
      availableQuantity: number | null;
      currencyId: string | null;
    } | null;
  }): Promise<string | null> {
    // Marcos 2026-06-22: kill switch separado. El atajo intercepta
    // preguntas que parecen "stock?" pero son cross-producto y rompe
    // la respuesta. Hasta que tengamos un classifier más estricto se
    // queda OFF y Claude maneja todo el tráfico ML.
    if (!isMlShortcutEnabled()) return null;
    if (!isEnabled()) return null;
    if (!args.listing) return null;
    const intent = classifyIntent(args.text);
    if (!intent) return null;
    // Only emit the shortcut when we have what the intent asks for.
    // Missing price for a price question → fall through to AI so it
    // can search the catalog or apologise.
    if ((intent === 'price' || intent === 'price+stock') && args.listing.price == null) {
      return null;
    }

    const titlePart = args.listing.title?.trim().slice(0, 80) ?? 'esta publicación';
    const stock = stockSummary(args.listing.availableQuantity, (args.listing.availableQuantity ?? 0) > 0);

    if (intent === 'price') {
      this.logger.log(`📌 Pre-AI product shortcut (ML): price for "${titlePart.slice(0, 40)}"`);
      return `El precio de ${titlePart} es ${formatArs(args.listing.price)}.`;
    }
    if (intent === 'stock') {
      this.logger.log(`📌 Pre-AI product shortcut (ML): stock for "${titlePart.slice(0, 40)}"`);
      return `Sí, ${titlePart} está ${stock}.`;
    }
    // price + stock
    this.logger.log(`📌 Pre-AI product shortcut (ML): price+stock for "${titlePart.slice(0, 40)}"`);
    return `${titlePart}: ${formatArs(args.listing.price)} y está ${stock}.`;
  }

  /**
   * WhatsApp / Webchat variant. Looks up Product rows by SKU or
   * name-token match against the inbound text. Fires only when the
   * search produces exactly one active match — otherwise the agent
   * gets the turn so it can disambiguate.
   */
  async tryGenericReply(args: {
    text: string;
    channel: Channel;
  }): Promise<string | null> {
    if (!isEnabled()) return null;
    // ML uses the publication-context variant; skip here.
    if (args.channel === Channel.MERCADOLIBRE) return null;
    const intent = classifyIntent(args.text);
    if (!intent) return null;

    // Pull the most-distinctive tokens out of the text (length > 3,
    // alphanumeric, lowercased). Marcos's customer base uses SKUs
    // sparingly so name tokens are the realistic match path.
    const tokens = Array.from(
      new Set(
        args.text
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, ' ')
          .split(/\s+/)
          .filter((t) => t.length >= 4),
      ),
    );
    if (tokens.length === 0) return null;

    try {
      // Score candidates: count of token hits across name + sku.
      // Pull a small page (top 50 by createdAt) and rank in JS — the
      // catalog is ~700 rows so this is cheap and keeps the SQL
      // simple. Larger catalogs would push this to a tsvector index.
      const candidates = await this.prisma.product.findMany({
        where: { active: true },
        select: {
          id: true,
          sku: true,
          name: true,
          basePriceArs: true,
          stockQuantity: true,
          inStock: true,
          url: true,
        },
      });
      const scored = candidates
        .map((p: Pick<Product, 'id' | 'sku' | 'name' | 'basePriceArs' | 'stockQuantity' | 'inStock' | 'url'>) => {
          const hay = `${p.sku} ${p.name}`.toLowerCase();
          let score = 0;
          for (const t of tokens) {
            if (hay.includes(t)) score++;
          }
          return { p, score };
        })
        .filter((x: { score: number }) => x.score > 0)
        .sort((a: { score: number }, b: { score: number }) => b.score - a.score);

      // Require a clear winner: top hit beats the runner-up by ≥1
      // token. Ambiguous matches → punt to AI.
      const top = scored[0];
      const second = scored[1];
      if (!top) return null;
      if (second && top.score - second.score < 1) return null;
      // Sanity floor: at least 2 hits OR a token ≥6 chars hit
      // (single-word matches on common short tokens are too risky).
      if (top.score < 2 && !tokens.some((t) => t.length >= 6 && top.p.name.toLowerCase().includes(t))) {
        return null;
      }

      const product = top.p;
      const titlePart = product.name.slice(0, 80);
      const stock = stockSummary(product.stockQuantity, product.inStock);
      const linkTail = product.url ? `\nLink: ${product.url}` : '';

      if (intent === 'price') {
        if (product.basePriceArs == null) return null;
        this.logger.log(
          `📌 Pre-AI product shortcut (${args.channel}): price for ${product.sku}`,
        );
        return `${titlePart}: ${formatArs(product.basePriceArs)}.${linkTail}`;
      }
      if (intent === 'stock') {
        this.logger.log(
          `📌 Pre-AI product shortcut (${args.channel}): stock for ${product.sku}`,
        );
        return `${titlePart} está ${stock}.${linkTail}`;
      }
      // price + stock
      if (product.basePriceArs == null) return null;
      this.logger.log(
        `📌 Pre-AI product shortcut (${args.channel}): price+stock for ${product.sku}`,
      );
      return `${titlePart}: ${formatArs(product.basePriceArs)}, ${stock}.${linkTail}`;
    } catch (err: any) {
      this.logger.warn(`Product lookup shortcut failed (non-fatal): ${err.message}`);
      return null;
    }
  }
}
