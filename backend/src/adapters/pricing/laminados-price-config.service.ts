/**
 * ADAPTERS LAYER — Laminados pricelist source-of-truth.
 *
 * Marcos's 2026-06-03 ask: instead of editing the table in code every
 * time he changes a price, give him a panel where he uploads the
 * `COTIZADOR LAMINADOS.xlsx` and the agent picks up the new values.
 *
 * Storage: a single `Configuration` row (type SYSTEM, key
 * `laminados.pricelist`) holds the full pricelist as JSON. When the
 * row is missing or unparseable we fall back to the baked-in defaults
 * (same numbers Marcos shipped in his first Excel) so the agent never
 * loses cotization ability if the DB row is wiped or the upload fails.
 *
 * The xlsx parser reads the `Configuración` sheet of his workbook —
 * that's where the products, discount tiers, pegamento presentations,
 * IVA, and fallback ARS/USD live. Other sheets (Cotización, MAS
 * detalles, Lista de Precios) are derived views and are ignored.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigurationType, PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';

export interface LaminadoProduct {
  key: string;
  ancho: number;
  espesor: string;
  tipo: 'Liso' | 'Reforzado';
  usdPorMetroLineal: number | null;
}

export interface DiscountTier {
  tier: string;
  m2Min: number;
  pct: number;
}

export interface PegamentoPresentacion {
  kg: number;
  rindeM2: number;
}

export interface LaminadosPricelist {
  products: LaminadoProduct[];
  discountTiers: DiscountTier[];
  pegamentoPresentaciones: PegamentoPresentacion[];
  pegamentoM2PerKg: number;
  iva: number;
  fallbackArsPorUsd: number;
  /** ISO when this pricelist was last written (server-side, set on save). */
  updatedAt?: string;
  /** Who uploaded the file (admin email/id), for audit. */
  updatedBy?: string;
}

const CONFIG_KEY = 'laminados.pricelist';

const DEFAULT_PRODUCTS: LaminadoProduct[] = [
  { key: '1.1m - 1.5mm',  ancho: 1.10, espesor: '1.5mm', tipo: 'Liso',      usdPorMetroLineal: 29.83 },
  { key: '1.22m - 2mm',   ancho: 1.22, espesor: '2mm',   tipo: 'Reforzado', usdPorMetroLineal: 28.95 },
  { key: '2.0m - 1.5mm',  ancho: 2.00, espesor: '1.5mm', tipo: 'Liso',      usdPorMetroLineal: 21.42 },
  { key: '2.0m - 2mm',    ancho: 2.00, espesor: '2mm',   tipo: 'Reforzado', usdPorMetroLineal: 27.70 },
  { key: '2.1m - 1.5mm',  ancho: 2.10, espesor: '1.5mm', tipo: 'Liso',      usdPorMetroLineal: 21.10 },
  { key: '2.2m - 2mm',    ancho: 2.20, espesor: '2mm',   tipo: 'Reforzado', usdPorMetroLineal: 25.54 },
  { key: '2.4m - 2mm',    ancho: 2.40, espesor: '2mm',   tipo: 'Reforzado', usdPorMetroLineal: 25.23 },
  { key: '2.4m - 2mm R',  ancho: 2.40, espesor: '2mm R', tipo: 'Reforzado', usdPorMetroLineal: 27.84 },
  { key: '2.5m - 2mm',    ancho: 2.50, espesor: '2mm',   tipo: 'Reforzado', usdPorMetroLineal: 25.23 },
  { key: '2.6m - 1.6mm',  ancho: 2.60, espesor: '1.6mm', tipo: 'Reforzado', usdPorMetroLineal: null },
  { key: '2.6m - 2mm',    ancho: 2.60, espesor: '2mm',   tipo: 'Reforzado', usdPorMetroLineal: 25.13 },
];

const DEFAULT_TIERS: DiscountTier[] = [
  { tier: 'Sin descuento', m2Min: 0,   pct: 0.00 },
  { tier: 'Tramo 1',       m2Min: 22,  pct: 0.10 },
  { tier: 'Tramo 2',       m2Min: 44,  pct: 0.15 },
  { tier: 'Rollo',         m2Min: 120, pct: 0.20 },
];

const DEFAULT_PEGAMENTO_PRESENTACIONES: PegamentoPresentacion[] = [
  { kg: 1.2, rindeM2: 2.5 },
  { kg: 6,   rindeM2: 12.5 },
  { kg: 12,  rindeM2: 25 },
  { kg: 24,  rindeM2: 50 },
];

const DEFAULT_PEGAMENTO_M2_PER_KG = 2.08333;
const DEFAULT_IVA = 0.21;
const DEFAULT_FALLBACK_RATE = 1450;

const BAKED_IN_DEFAULTS: LaminadosPricelist = {
  products: DEFAULT_PRODUCTS,
  discountTiers: DEFAULT_TIERS,
  pegamentoPresentaciones: DEFAULT_PEGAMENTO_PRESENTACIONES,
  pegamentoM2PerKg: DEFAULT_PEGAMENTO_M2_PER_KG,
  iva: DEFAULT_IVA,
  fallbackArsPorUsd: DEFAULT_FALLBACK_RATE,
};

function asNum(v: any): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/\s/g, '').replace(',', '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStr(v: any): string {
  return (v == null ? '' : String(v)).trim();
}

@Injectable()
export class LaminadosPriceConfigService {
  private readonly logger = new Logger(LaminadosPriceConfigService.name);
  private readonly prisma: PrismaClient;

  constructor(
    @Optional() prismaShared?: import('../repositories/prisma.service').PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }
  private cache: LaminadosPricelist | null = null;
  private cacheTime = 0;
  private readonly cacheTtlMs =
    Number(process.env.LAMINADOS_PRICELIST_CACHE_MS) || 30_000;

  async getPricelist(): Promise<LaminadosPricelist> {
    if (this.cache && Date.now() - this.cacheTime < this.cacheTtlMs) {
      return this.cache;
    }
    try {
      const row = await this.prisma.configuration.findUnique({ where: { key: CONFIG_KEY } });
      if (row && row.value && typeof row.value === 'object') {
        const parsed = this.sanitize(row.value as any);
        this.cache = parsed;
        this.cacheTime = Date.now();
        return parsed;
      }
    } catch (err: any) {
      this.logger.warn(`Could not load laminados pricelist from DB: ${err?.message ?? err}`);
    }
    this.cache = BAKED_IN_DEFAULTS;
    this.cacheTime = Date.now();
    return BAKED_IN_DEFAULTS;
  }

  invalidate(): void {
    this.cache = null;
    this.cacheTime = 0;
  }

  /**
   * Sanitize a candidate pricelist object — drop garbage rows, coerce
   * numbers, keep a row even if some optional fields are missing.
   * Returns the baked-in defaults if the input is unusable.
   */
  private sanitize(raw: any): LaminadosPricelist {
    const productsRaw = Array.isArray(raw?.products) ? raw.products : [];
    const products: LaminadoProduct[] = productsRaw
      .map((p: any) => {
        const key = asStr(p?.key);
        const ancho = asNum(p?.ancho);
        const espesor = asStr(p?.espesor);
        const tipoRaw = asStr(p?.tipo);
        const tipo: 'Liso' | 'Reforzado' = tipoRaw.toLowerCase().startsWith('lis') ? 'Liso' : 'Reforzado';
        const usd = asNum(p?.usdPorMetroLineal);
        if (!key || !ancho || !espesor) return null;
        return { key, ancho, espesor, tipo, usdPorMetroLineal: usd };
      })
      .filter((p: LaminadoProduct | null): p is LaminadoProduct => p !== null);

    const tiersRaw = Array.isArray(raw?.discountTiers) ? raw.discountTiers : [];
    const discountTiers: DiscountTier[] = tiersRaw
      .map((t: any) => {
        const tier = asStr(t?.tier);
        const m2Min = asNum(t?.m2Min);
        const pct = asNum(t?.pct);
        if (!tier || m2Min == null || pct == null) return null;
        return { tier, m2Min, pct };
      })
      .filter((t: DiscountTier | null): t is DiscountTier => t !== null)
      .sort((a: DiscountTier, b: DiscountTier) => a.m2Min - b.m2Min);

    const presRaw = Array.isArray(raw?.pegamentoPresentaciones) ? raw.pegamentoPresentaciones : [];
    const pegamentoPresentaciones: PegamentoPresentacion[] = presRaw
      .map((p: any) => {
        const kg = asNum(p?.kg);
        const rinde = asNum(p?.rindeM2);
        if (kg == null || rinde == null) return null;
        return { kg, rindeM2: rinde };
      })
      .filter((p: PegamentoPresentacion | null): p is PegamentoPresentacion => p !== null);

    const m2PerKg = asNum(raw?.pegamentoM2PerKg) ?? DEFAULT_PEGAMENTO_M2_PER_KG;
    const iva = asNum(raw?.iva) ?? DEFAULT_IVA;
    const fallbackArsPorUsd = asNum(raw?.fallbackArsPorUsd) ?? DEFAULT_FALLBACK_RATE;

    if (products.length === 0 || discountTiers.length === 0 || pegamentoPresentaciones.length === 0) {
      this.logger.warn('Laminados pricelist row is partial — falling back to baked-in defaults');
      return BAKED_IN_DEFAULTS;
    }
    return {
      products,
      discountTiers,
      pegamentoPresentaciones,
      pegamentoM2PerKg: m2PerKg,
      iva,
      fallbackArsPorUsd,
      updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : undefined,
      updatedBy: typeof raw?.updatedBy === 'string' ? raw.updatedBy : undefined,
    };
  }

  /**
   * Parse Marcos's xlsx workbook into a pricelist. Reads the
   * `Configuración` sheet only — the other sheets are derived views.
   * Throws when the sheet is missing or when no products are found.
   */
  parseXlsx(buffer: Buffer): LaminadosPricelist {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(buffer, { type: 'buffer' });
    } catch (err: any) {
      throw new Error(`xlsx parse failed: ${err?.message ?? err}`);
    }
    const configSheetName = wb.SheetNames.find((n) =>
      n.toLowerCase().replace(/[áéíóú]/g, (m) => ({ á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' } as any)[m] || m)
        .startsWith('configuracion')
    );
    if (!configSheetName) {
      throw new Error('xlsx is missing the "Configuración" sheet');
    }
    const sheet = wb.Sheets[configSheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    let arsPorUsd: number | null = null;
    let iva: number | null = null;
    let pegamentoM2PerKg: number | null = null;
    const discountTiers: DiscountTier[] = [];
    const pegamentoPresentaciones: PegamentoPresentacion[] = [];
    const products: LaminadoProduct[] = [];

    let section: 'header' | 'tiers' | 'pegamento' | 'products' | null = 'header';
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const c0 = asStr(row[0]).toLowerCase();
      if (!c0 && !asStr(row[1])) continue;

      if (c0.includes('tabla de descuentos')) { section = 'tiers'; continue; }
      if (c0.includes('pegamento prfv')) { section = 'pegamento'; continue; }
      if (c0.includes('productos')) { section = 'products'; continue; }
      if (c0.includes('parámetros') || c0.includes('parametros')) { section = 'header'; continue; }

      if (section === 'header') {
        if (c0.includes('tipo de cambio')) {
          arsPorUsd = asNum(row[2]) ?? asNum(row[1]);
        } else if (c0.startsWith('iva')) {
          iva = asNum(row[2]) ?? asNum(row[1]);
        } else if (c0.includes('rendimiento pegamento')) {
          pegamentoM2PerKg = asNum(row[2]) ?? asNum(row[1]);
        }
      } else if (section === 'tiers') {
        const tier = asStr(row[0]);
        if (!tier || tier.toLowerCase().includes('tramo') && tier.toLowerCase() === 'tramo') continue;
        if (tier.toLowerCase() === 'tramo' || tier.toLowerCase().startsWith('tramo ') === false && tier.toLowerCase() !== 'sin descuento' && tier.toLowerCase() !== 'rollo' && !tier.toLowerCase().startsWith('rollo')) {
          // Header row "Tramo | M² mínimos | ..."
          if (tier.toLowerCase() === 'tramo') continue;
        }
        const m2Min = asNum(row[1]);
        const pct = asNum(row[2]);
        if (m2Min != null && pct != null && tier.toLowerCase() !== 'tramo') {
          discountTiers.push({ tier, m2Min, pct });
        }
      } else if (section === 'pegamento') {
        const kg = asNum(row[0]);
        const rinde = asNum(row[1]);
        if (kg != null && rinde != null) {
          pegamentoPresentaciones.push({ kg, rindeM2: rinde });
        }
      } else if (section === 'products') {
        const key = asStr(row[0]);
        if (!key || key.toLowerCase().startsWith('clave')) continue;
        const ancho = asNum(row[1]);
        const espesor = asStr(row[2]);
        const tipoStr = asStr(row[3]);
        const usd = asNum(row[4]); // null when "A definir"
        if (!key || ancho == null || !espesor) continue;
        const tipo: 'Liso' | 'Reforzado' = tipoStr.toLowerCase().startsWith('lis') ? 'Liso' : 'Reforzado';
        products.push({ key, ancho, espesor, tipo, usdPorMetroLineal: usd });
      }
    }

    if (products.length === 0) {
      throw new Error('xlsx Configuración sheet has no readable product rows');
    }
    if (discountTiers.length === 0) {
      throw new Error('xlsx Configuración sheet has no readable discount tiers');
    }

    discountTiers.sort((a, b) => a.m2Min - b.m2Min);

    return {
      products,
      discountTiers,
      pegamentoPresentaciones:
        pegamentoPresentaciones.length > 0
          ? pegamentoPresentaciones
          : DEFAULT_PEGAMENTO_PRESENTACIONES,
      pegamentoM2PerKg: pegamentoM2PerKg ?? DEFAULT_PEGAMENTO_M2_PER_KG,
      iva: iva ?? DEFAULT_IVA,
      fallbackArsPorUsd: arsPorUsd ?? DEFAULT_FALLBACK_RATE,
    };
  }

  /** Persist a pricelist. Called after a successful xlsx upload. */
  async savePricelist(pl: LaminadosPricelist, updatedBy?: string): Promise<LaminadosPricelist> {
    const value: LaminadosPricelist = {
      ...pl,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };
    await this.prisma.configuration.upsert({
      where: { key: CONFIG_KEY },
      create: {
        key: CONFIG_KEY,
        type: ConfigurationType.PRICING,
        value: value as any,
        description: 'Laminados PRFV pricelist (products, tiers, pegamento, IVA, rate)',
        isActive: true,
      },
      update: {
        value: value as any,
        isActive: true,
      },
    });
    this.invalidate();
    this.logger.log(
      `laminados pricelist saved: ${pl.products.length} products, ${pl.discountTiers.length} tiers${updatedBy ? ' by ' + updatedBy : ''}`,
    );
    return value;
  }

  /** Hard reset back to baked-in defaults, used by admin "restore". */
  async resetToDefaults(updatedBy?: string): Promise<LaminadosPricelist> {
    return this.savePricelist(BAKED_IN_DEFAULTS, updatedBy);
  }

  /** Exposes the baked-in defaults for cases where the caller wants to
   *  diff against them (e.g. UI banner "tenés cambios sobre la base"). */
  getBakedInDefaults(): LaminadosPricelist {
    return BAKED_IN_DEFAULTS;
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
