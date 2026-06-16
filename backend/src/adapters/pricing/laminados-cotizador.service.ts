/**
 * ADAPTERS LAYER — Laminados PRFV cotizador.
 *
 * Marcos's 2026-06-03 ask: instead of silencing the agent on laminate
 * cotization questions and routing to a human, give the agent the same
 * pricing table the sales team uses and let it answer directly. The
 * Excel he shared (/home/overview/COTIZADOR LAMINADOS.xlsx) carries:
 *   - 11 laminate products keyed by "ancho - espesor" with a USD price
 *     per linear meter.
 *   - Tiered discounts by total m² ordered:
 *       0–21 m²:  no discount
 *       22–43 m²: 10% transferencia (≥ 10m on 2.2m wide)
 *       44–119 m²:15% transferencia (≥ 20m on 2.2m wide)
 *       ≥ 120 m²: 20% transferencia (rollo)
 *   - Two payment modes: transferencia (con IVA 21%) vs contado (sin IVA).
 *   - Pegamento (PRFV adhesive) at 2.083 m²/kg in 4 presentations:
 *       1.2 kg → 2.5 m², 6 kg → 12.5 m², 12 kg → 25 m², 24 kg → 50 m².
 *
 * The agent calls `cotizar_laminado(ancho, espesor, metros_lineales,
 * modo_pago)` as a tool; this service returns a structured quote with
 * the subtotal in USD, the tier applied, the ARS conversion against
 * the live blue-dollar rate, the IVA breakdown, and a pegamento
 * recommendation. The agent formats the reply.
 *
 * Pricelist itself lives in `LaminadosPriceConfigService` (DB-backed
 * `Configuration` row, baked-in defaults as fallback). Marcos uploads
 * the Excel from Settings → Laminados to update; the cotizador picks
 * up the new values on the next call (cache TTL 30s, invalidated
 * on save).
 */

import { Injectable, Logger } from '@nestjs/common';
import { ExchangeRateService } from './exchange-rate.service';
import {
  LaminadoProduct,
  LaminadosPriceConfigService,
} from './laminados-price-config.service';

export type { LaminadoProduct } from './laminados-price-config.service';

export interface CotizarLaminadoInput {
  /** Buyer-stated ancho in m. Approximate matching tolerated (±5%). */
  ancho: number;
  /** Buyer-stated espesor (e.g. "2mm", "1.5mm"). Free text matched
   *  against the product table. */
  espesor: string;
  /** Linear meters the buyer wants to purchase. */
  metrosLineales: number;
  /** "transferencia" → +IVA; "contado" → sin IVA. Defaults to
   *  "transferencia" because that's what most buyers ask about. */
  modoPago?: 'transferencia' | 'contado';
}

export interface CotizarLaminadoResult {
  ok: boolean;
  reason?: string;
  product?: {
    key: string;
    ancho: number;
    espesor: string;
    tipo: string;
    usdPorMetroLineal: number;
  };
  metrosLineales?: number;
  metrosCuadrados?: number;
  modoPago?: 'transferencia' | 'contado';
  /** Discount tier name + percent applied */
  descuento?: { tier: string; pct: number };
  /** USD subtotal (pre-discount), USD net after discount */
  usd?: { subtotal: number; conDescuento: number };
  /** Exchange rate used + source */
  cotizacion?: { arsPorUsd: number; fuente: 'blue' | 'cached' | 'env' };
  /** ARS breakdown. Note: post-2026-06-04 the per-m² USD rate already
   *  includes IVA, so `iva` is always 0 (kept for backwards-compat).
   *  `total` already includes IVA — the agent must NEVER re-add it. */
  ars?: {
    subtotal: number;
    iva: number;
    total: number;
  };
  /** Pegamento sugerido (m² → smallest combo of presentations) */
  pegamento?: {
    m2Cubiertos: number;
    presentaciones: Array<{ kg: number; cantidad: number }>;
  };
}

@Injectable()
export class LaminadosCotizadorService {
  private readonly logger = new Logger(LaminadosCotizadorService.name);

  constructor(
    private readonly exchangeRate: ExchangeRateService,
    private readonly priceConfig: LaminadosPriceConfigService,
  ) {}

  async listProducts(): Promise<LaminadoProduct[]> {
    const pl = await this.priceConfig.getPricelist();
    return pl.products;
  }

  /**
   * Match the buyer's ancho/espesor strings to a product row. Tolerant
   * matching: ancho ±5cm, espesor normalised ("2" → "2mm").
   */
  private matchProduct(
    products: LaminadoProduct[],
    ancho: number,
    espesor: string,
  ): LaminadoProduct | null {
    const espesorNorm = espesor
      .toString()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/,/g, '.')
      .replace(/milimetros|mm/g, 'mm')
      .trim();
    const normalisedEspesor = espesorNorm.endsWith('mm')
      ? espesorNorm
      : `${espesorNorm}mm`;
    const candidates = products.filter((p) => {
      const productEspesorNorm = p.espesor.toLowerCase().replace(/\s+/g, '');
      const espesorMatches =
        productEspesorNorm === normalisedEspesor ||
        productEspesorNorm.startsWith(normalisedEspesor);
      const anchoMatches = Math.abs(p.ancho - ancho) <= 0.05;
      return anchoMatches && espesorMatches;
    });
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.espesor.length - b.espesor.length);
    return candidates[0];
  }

  private tierForM2(
    tiers: Array<{ tier: string; m2Min: number; pct: number }>,
    m2: number,
  ): { tier: string; pct: number } {
    let chosen = tiers[0];
    for (const t of tiers) {
      if (m2 >= t.m2Min) chosen = t;
    }
    return { tier: chosen.tier, pct: chosen.pct };
  }

  /**
   * Match Marcos's Excel pegamento strategy: pick the SMALLEST single
   * envase whose rinde (m² coverage) is ≥ the required m². When no
   * single envase is big enough, use multiples of the LARGEST envase
   * (24 kg) until coverage is met. The Excel never returns mixed
   * packs (e.g. it would never say "1×6kg + 2×1.2kg"), so neither
   * should we — Marcos's screenshot for 6 m² shows "6 kg", not the
   * old greedy-packed "3×1.2 kg".
   */
  private pegamentoForM2(
    presentations: Array<{ kg: number; rindeM2: number }>,
    m2PerKg: number,
    m2: number,
  ): {
    m2Cubiertos: number;
    presentaciones: Array<{ kg: number; cantidad: number }>;
  } {
    const asc = [...presentations].sort((a, b) => a.kg - b.kg);
    // Smallest single envase that fully covers the requested m².
    const singleCover = asc.find((p) => p.rindeM2 >= m2);
    let out: Array<{ kg: number; cantidad: number }> = [];
    if (singleCover) {
      out = [{ kg: singleCover.kg, cantidad: 1 }];
    } else {
      // Need more than the largest envase — use N copies of it.
      const largest = asc[asc.length - 1];
      const cantidad = Math.max(1, Math.ceil(m2 / largest.rindeM2));
      out = [{ kg: largest.kg, cantidad }];
    }
    const totalKg = out.reduce((s, p) => s + p.kg * p.cantidad, 0);
    return {
      m2Cubiertos: +(totalKg * m2PerKg).toFixed(2),
      presentaciones: out,
    };
  }

  async cotizar(input: CotizarLaminadoInput): Promise<CotizarLaminadoResult> {
    const { ancho, espesor, metrosLineales } = input;
    const modoPago = input.modoPago ?? 'transferencia';

    if (!Number.isFinite(ancho) || ancho <= 0) {
      return { ok: false, reason: 'ancho_invalido' };
    }
    if (!Number.isFinite(metrosLineales) || metrosLineales <= 0) {
      return { ok: false, reason: 'metros_invalido' };
    }

    const pl = await this.priceConfig.getPricelist();

    const product = this.matchProduct(pl.products, ancho, espesor);
    if (!product) {
      return { ok: false, reason: 'producto_no_encontrado' };
    }
    if (product.usdPorMetroLineal == null) {
      return { ok: false, reason: 'precio_a_definir', product: { ...product, usdPorMetroLineal: 0 } };
    }

    const m2 = +(metrosLineales * product.ancho).toFixed(2);
    const tier = this.tierForM2(pl.discountTiers, m2);

    // 2026-06-04: Marcos surfaced that the price field in the Excel
    // — although labeled "USD/m lineal" in the Configuración sheet —
    // actually represents **USD per m²** in the Cotización formula.
    // Total = m² × USD/m² × ARS/USD = price INCLUDING IVA. The IVA is
    // already baked into the per-m² rate, so we don't add it on top.
    // Example: 2.0m × 3m linear = 6 m² × 27.70 × 1450 = ARS 240,990
    // (= "PRECIO REAL / TRANSFERENCIA con IVA" in his Excel).
    //
    // For "contado" the Excel applies a 10.5% discount off the
    // transferencia total — that's a payment-method incentive, not a
    // tax removal. Configurable via env LAMINADOS_CONTADO_DISCOUNT.
    const usdPorM2 = product.usdPorMetroLineal; // misleading field name; will rename in a follow-up
    // Keep intermediates in full precision; only round at the final
    // ARS display. Rounding USD to cents before the rate multiply was
    // drifting the total by a few ARS vs Marcos's Excel.
    const subtotalUsdRaw = m2 * usdPorM2;
    const conDescuentoUsdRaw = subtotalUsdRaw * (1 - tier.pct);
    const subtotalUsd = +subtotalUsdRaw.toFixed(2);
    const conDescuentoUsd = +conDescuentoUsdRaw.toFixed(2);

    // Rate source: Marcos's Excel sets the ARS/USD value he wants the
    // cotizador to use (1450 in the current sheet). His USD/m² prices
    // are tuned to that rate — using live blue would silently shift
    // the totals away from what his Excel shows. So we PREFER the
    // Excel-configured rate; live blue is only a fallback for ops
    // checks (env override LAMINADOS_USE_LIVE_BLUE=true forces live).
    let arsPorUsd: number;
    let fuente: 'blue' | 'cached' | 'env' = 'env';
    const preferLiveBlue =
      (process.env.LAMINADOS_USE_LIVE_BLUE || 'false').toLowerCase() === 'true';
    if (preferLiveBlue) {
      try {
        const rate = await this.exchangeRate.getCurrentBlueRate();
        arsPorUsd = rate.rate;
        fuente = 'blue';
      } catch (err: any) {
        arsPorUsd = pl.fallbackArsPorUsd;
        this.logger.warn(`Falling back to Excel ARS/USD ${arsPorUsd} after blue error: ${err?.message ?? err}`);
      }
    } else {
      arsPorUsd = Number(process.env.LAMINADOS_FALLBACK_RATE) || pl.fallbackArsPorUsd;
      fuente = 'env';
    }

    const totalConIvaArs = +(conDescuentoUsdRaw * arsPorUsd).toFixed(2);
    // Contado discount: 10.5% off transferencia (matches Marcos's
    // Excel — TRANSFERENCIA 240,990 → CONTADO 215,686 for the 6 m²
    // sample). Override with env LAMINADOS_CONTADO_DISCOUNT (decimal,
    // e.g. "0.105") if Marcos changes the policy.
    const contadoDiscountPct = Number(process.env.LAMINADOS_CONTADO_DISCOUNT) || 0.105;
    const subtotalArs =
      modoPago === 'transferencia'
        ? totalConIvaArs
        : +(totalConIvaArs * (1 - contadoDiscountPct)).toFixed(2);
    // IVA reporting only — the per-m² rate already includes it. We
    // surface the breakdown so the agent can answer "y el IVA?" but
    // never add it on top of the total.
    const ivaArs = 0; // never added on top — kept in the response shape for backwards-compat
    const totalArs = +(subtotalArs + ivaArs).toFixed(2);

    return {
      ok: true,
      product: {
        key: product.key,
        ancho: product.ancho,
        espesor: product.espesor,
        tipo: product.tipo,
        usdPorMetroLineal: product.usdPorMetroLineal,
      },
      metrosLineales,
      metrosCuadrados: m2,
      modoPago,
      descuento: tier,
      usd: { subtotal: subtotalUsd, conDescuento: conDescuentoUsd },
      cotizacion: { arsPorUsd, fuente },
      // NOTE: `ivaIncluida` deliberately NOT exposed to the agent —
      // experiment 2026-06-04 showed Claude reads any extra IVA field
      // as additive ("Total $240,990 + IVA $41,824 = $282,814"). The
      // IVA is already baked into `total`; the agent only needs that.
      ars: { subtotal: subtotalArs, iva: ivaArs, total: totalArs },
      pegamento: this.pegamentoForM2(pl.pegamentoPresentaciones, pl.pegamentoM2PerKg, m2),
    };
  }
}
