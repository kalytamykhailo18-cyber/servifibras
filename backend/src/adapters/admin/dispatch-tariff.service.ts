/**
 * Dispatch tariff CRUD + estimator. Marcos 2026-06-15.
 *
 * Marcos pointed out that per-order shipping cost (TN's shipping_cost_owner,
 * ML's pack shipping fields) is sometimes absent — the dispatch-stats card
 * then shows "cobrado: $0" for those rows even though the courier still
 * gets paid. This service holds the admin-curated (carrier, zone) tariff
 * table that lets the panel show what *would* be paid given the dispatch
 * count, alongside the actual cobrado, so Marcos can cross-check his
 * monthly invoices against either signal.
 *
 * No env-hardcoded carriers/zones here — both are free-text. The admin
 * UI seeds the canonical names (Andreani, JyJ, Baires, M2, Servifibras
 * propio…) but the table stays open so a new courier doesn't require a
 * code change.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Marcos 2026-07-14 (Baires GBA1/GBA 1): la clave (carrier, zone) que
// usa el estimator debe ignorar mayúsculas y espacios internos. TN
// exporta "GBA 1" en la etiqueta ("GBA 1 GRATIS"), el tariff se cargó
// como "GBA1"; sin normalizar acá el lookup fallaba y el estimate
// devolvía 0 (visible en Baires con 64 despachos sin tarifa). El fix
// original quedó SÓLO en analytics.service.ts (dispatch stats); acá
// vive el estimator que consumen order-management + los endpoints
// admin, con el mismo bug de raíz.
export function normalizeTariffKey(carrier: string, zone: string): string {
  const c = (carrier ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const z = (zone ?? '').trim().toLowerCase().replace(/\s+/g, '');
  return `${c}::${z}`;
}

export interface DispatchTariffInput {
  carrier: string;
  zone: string;
  costPerPackage: number;
  currency?: string;
  notes?: string | null;
  active?: boolean;
}

@Injectable()
export class DispatchTariffService {
  private readonly logger = new Logger(DispatchTariffService.name);
  private readonly prisma: PrismaClient;

  constructor(
    @Optional() prismaShared?: import('../repositories/prisma.service').PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  /** All rows (active and archived) — admin grid reads both so the
   *  archived rows can be reactivated without re-typing. */
  async list() {
    return this.prisma.dispatchTariff.findMany({
      orderBy: [{ carrier: 'asc' }, { zone: 'asc' }],
    });
  }

  /** Just the rows used by the estimator. */
  async listActive() {
    return this.prisma.dispatchTariff.findMany({
      where: { active: true },
      orderBy: [{ carrier: 'asc' }, { zone: 'asc' }],
    });
  }

  async create(input: DispatchTariffInput, createdById: string | null) {
    const carrier = input.carrier.trim();
    const zone = input.zone.trim();
    if (!carrier) throw new Error('carrier requerido');
    if (!zone) throw new Error('zone requerido');
    if (!Number.isFinite(input.costPerPackage) || input.costPerPackage < 0) {
      throw new Error('costPerPackage debe ser un número ≥ 0');
    }
    return this.prisma.dispatchTariff.create({
      data: {
        carrier,
        zone,
        costPerPackage: input.costPerPackage,
        currency: input.currency || 'ARS',
        notes: input.notes ?? null,
        active: input.active ?? true,
        createdById,
      },
    });
  }

  async update(id: string, patch: Partial<DispatchTariffInput>) {
    const data: any = {};
    if (patch.carrier !== undefined) {
      const v = patch.carrier.trim();
      if (!v) throw new Error('carrier requerido');
      data.carrier = v;
    }
    if (patch.zone !== undefined) {
      const v = patch.zone.trim();
      if (!v) throw new Error('zone requerido');
      data.zone = v;
    }
    if (patch.costPerPackage !== undefined) {
      if (!Number.isFinite(patch.costPerPackage) || patch.costPerPackage < 0) {
        throw new Error('costPerPackage debe ser un número ≥ 0');
      }
      data.costPerPackage = patch.costPerPackage;
    }
    if (patch.currency !== undefined) data.currency = patch.currency;
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (patch.active !== undefined) data.active = patch.active;
    try {
      return await this.prisma.dispatchTariff.update({ where: { id }, data });
    } catch (err: any) {
      if (err?.code === 'P2025') return null;
      throw err;
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      await this.prisma.dispatchTariff.delete({ where: { id } });
      return true;
    } catch (err: any) {
      if (err?.code === 'P2025') return false;
      throw err;
    }
  }

  /**
   * Estimate the courier cost for a single dispatch of `packages`
   * boxes shipped via `carrier` to `zone`. Returns null when no
   * active tariff matches — the caller logs it and either falls
   * back to the cobrado value or surfaces "sin tarifa" in the UI.
   */
  async estimateFor(args: { carrier: string; zone: string; packages?: number }): Promise<{ unitCost: number; total: number; currency: string } | null> {
    const carrier = args.carrier?.trim();
    const zone = args.zone?.trim();
    if (!carrier || !zone) return null;
    // Prisma exact-match antes: "JYJ"/"jyj"/"JyJ " no matcheaban entre
    // sí ni "GBA 1" vs "GBA1". Cargamos activos y matcheamos por clave
    // normalizada — mismo criterio que estimateBatch y que el dispatch
    // stats de analytics.
    const tariffs = await this.listActive();
    const wanted = normalizeTariffKey(carrier, zone);
    const tariff = tariffs.find((t) => normalizeTariffKey(t.carrier, t.zone) === wanted);
    if (!tariff) return null;
    const packages = Math.max(1, args.packages ?? 1);
    return {
      unitCost: tariff.costPerPackage,
      total: tariff.costPerPackage * packages,
      currency: tariff.currency,
    };
  }

  /**
   * Bulk-estimate for a list of (carrier, zone, packages) tuples.
   * Returns a parallel array of estimates so the caller can stitch
   * back into its rows. Misses come back as null and are NOT counted
   * in the totals — the admin sees "$X estimado · Y filas sin tarifa".
   */
  async estimateBatch(rows: Array<{ carrier: string; zone: string; packages?: number }>): Promise<Array<{ unitCost: number; total: number; currency: string } | null>> {
    const tariffs = await this.listActive();
    const index = new Map<string, { costPerPackage: number; currency: string }>();
    for (const t of tariffs) {
      index.set(normalizeTariffKey(t.carrier, t.zone), { costPerPackage: t.costPerPackage, currency: t.currency });
    }
    return rows.map((r) => {
      const carrier = r.carrier?.trim() ?? '';
      const zone = r.zone?.trim() ?? '';
      if (!carrier || !zone) return null;
      const t = index.get(normalizeTariffKey(carrier, zone));
      if (!t) return null;
      const packages = Math.max(1, r.packages ?? 1);
      return { unitCost: t.costPerPackage, total: t.costPerPackage * packages, currency: t.currency };
    });
  }
}
