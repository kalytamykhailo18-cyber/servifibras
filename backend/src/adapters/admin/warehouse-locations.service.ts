/**
 * ADAPTERS LAYER — Warehouse-location sync.
 *
 * Marcos 2026-06-10: the picker needs to know where in the galpón
 * to grab each box from. He keeps a Google Sheet ("Ubicación de
 * moldes") with two columns — column A = SKU, column B = ubicación
 * (free-form: "300", "34 y 53", "F", whatever). This service lets
 * Marcos export that sheet as .xlsx or .csv and upload it; we
 * upsert `Product.warehouseLocation` for every matching SKU and
 * the daily-logística panel renders "UBI: {ubicación}" inline on
 * the item line.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';

import { PrismaService } from '../repositories/prisma.service';
export interface WarehouseLocationUploadResult {
  parsedRows: number;
  matched: number;
  updated: number;
  cleared: number;
  unmatchedSkus: string[];
}

@Injectable()
export class WarehouseLocationsService {
  private readonly logger = new Logger(WarehouseLocationsService.name);
  private readonly prisma: PrismaClient;

  constructor(
    @Optional() prismaShared?: PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  /**
   * Parse the workbook (.xlsx or .csv-as-xlsx — `xlsx` autodetects)
   * and pull `(sku, ubicación)` pairs from the first sheet. Column
   * names are matched case-insensitively against a small alias set
   * so Marcos's sheet headers ("SKU" vs "sku", "ubicación" vs
   * "ubicacion") all work. Empty locations clear the field.
   */
  parseBuffer(buf: Buffer): Array<{ sku: string; location: string | null }> {
    const wb = XLSX.read(buf, { type: 'buffer', codepage: 65001 });
    const firstSheet = wb.SheetNames[0];
    if (!firstSheet) throw new Error('workbook has no sheets');
    const ws = wb.Sheets[firstSheet];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
    if (rows.length < 2) throw new Error('expected at least a header row + one data row');
    const headers = rows[0].map((c) => String(c ?? '').trim().toLowerCase());
    const skuCol = headers.findIndex((h) => h === 'sku' || h === 'codigo' || h === 'código');
    const locCol = headers.findIndex(
      (h) => h === 'ubicacion' || h === 'ubicación' || h === 'location' || h === 'lugar',
    );
    if (skuCol < 0 || locCol < 0) {
      throw new Error(
        `could not find sku + ubicación columns — headers seen: ${headers.join(', ')}`,
      );
    }
    const out: Array<{ sku: string; location: string | null }> = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const sku = String(r[skuCol] ?? '').trim();
      if (!sku) continue;
      const rawLoc = String(r[locCol] ?? '').trim();
      out.push({ sku, location: rawLoc.length > 0 ? rawLoc.slice(0, 120) : null });
    }
    return out;
  }

  /**
   * Upsert the locations onto `Product.warehouseLocation`. SKUs not
   * present in our catalog are returned as `unmatchedSkus` so Marcos
   * can see if his sheet has typos.
   */
  async applyLocations(
    pairs: Array<{ sku: string; location: string | null }>,
  ): Promise<WarehouseLocationUploadResult> {
    const result: WarehouseLocationUploadResult = {
      parsedRows: pairs.length,
      matched: 0,
      updated: 0,
      cleared: 0,
      unmatchedSkus: [],
    };
    if (pairs.length === 0) return result;
    const skus = Array.from(new Set(pairs.map((p) => p.sku)));
    const existing = await this.prisma.product.findMany({
      where: { sku: { in: skus } },
      select: { id: true, sku: true, warehouseLocation: true },
    });
    const bySku = new Map(existing.map((p) => [p.sku, p]));
    for (const pair of pairs) {
      const found = bySku.get(pair.sku);
      if (!found) {
        result.unmatchedSkus.push(pair.sku);
        continue;
      }
      result.matched++;
      if ((found.warehouseLocation ?? null) === pair.location) continue;
      await this.prisma.product.update({
        where: { id: found.id },
        data: { warehouseLocation: pair.location },
      });
      if (pair.location == null) result.cleared++;
      else result.updated++;
    }
    this.logger.log(
      `warehouseLocations applied: parsed=${result.parsedRows} matched=${result.matched} updated=${result.updated} cleared=${result.cleared} unmatched=${result.unmatchedSkus.length}`,
    );
    if (result.unmatchedSkus.length > 0) {
      result.unmatchedSkus = result.unmatchedSkus.slice(0, 100);
    }
    return result;
  }
}
