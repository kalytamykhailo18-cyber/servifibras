/**
 * ADAPTERS LAYER — Postal-code → courier-zone mapping.
 *
 * Marcos 2026-06-20: cuando un envío TN llega con un label custom
 * (no "CABA GRATUITO" / "GBA 1 GRATIS" / etc), el aggregator no
 * puede derivar la zona del courier del label porque la zona no
 * está embebida. Esas filas terminaban en "Sin zona" y no
 * matcheaban tarifa.
 *
 * Marcos propuso cargar un Excel con (cp → zona). Este servicio
 * parsea el archivo, lo upsertea en `postal_code_zones`, y expone
 * un lookup barato `getZoneByCp(cp)` que se enchufa como último
 * fallback en la cadena de derivación de zona del panel de
 * despachos.
 *
 * Mismo patrón que `WarehouseLocationsService` para que Marcos lo
 * use con el mismo workflow (export Excel, drop en el sistema, ver
 * el resultado).
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, PostalCodeZone } from '@prisma/client';
import * as XLSX from 'xlsx';

export interface PostalCodeZoneUploadResult {
  parsedRows: number;
  inserted: number;
  updated: number;
  unchanged: number;
  invalid: number;
  /** Top 10 filas rechazadas — para que Marcos pueda corregir el archivo. */
  invalidSamples: Array<{ rowIndex: number; reason: string }>;
}

/**
 * Normaliza el CP a un formato consistente para comparar.
 * - mayúsculas
 * - sin espacios
 * - sin guiones intermedios (M5500-AAA → M5500AAA)
 * Devuelve null si queda vacío.
 */
function normaliseCp(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase().replace(/[\s\-]/g, '');
  return s.length > 0 ? s : null;
}

@Injectable()
export class PostalCodeZoneService {
  private readonly logger = new Logger(PostalCodeZoneService.name);
  private readonly prisma = new PrismaClient();

  /**
   * Parsea el workbook (XLSX o CSV-as-XLSX — `xlsx` autodetecta) y
   * devuelve filas (cp, zone, locality?, province?). Columnas se
   * resuelven case-insensitive contra un set de alias para que
   * Marcos no tenga que matchear nombres exactos.
   */
  parseBuffer(buf: Buffer): {
    rows: Array<{ cp: string; zone: string; locality: string | null; province: string | null }>;
    invalid: Array<{ rowIndex: number; reason: string }>;
  } {
    const wb = XLSX.read(buf, { type: 'buffer', codepage: 65001 });
    const firstSheet = wb.SheetNames[0];
    if (!firstSheet) throw new Error('workbook has no sheets');
    const ws = wb.Sheets[firstSheet];
    const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
    if (grid.length < 2) throw new Error('expected at least a header row + one data row');
    const headers = grid[0].map((c) => String(c ?? '').trim().toLowerCase());
    const cpCol = headers.findIndex((h) => h === 'cp' || h === 'codigo postal' || h === 'código postal' || h === 'zip' || h === 'zipcode');
    const zoneCol = headers.findIndex((h) => h === 'zona' || h === 'zone');
    const locCol = headers.findIndex((h) => h === 'localidad' || h === 'locality' || h === 'ciudad' || h === 'partido');
    const provCol = headers.findIndex((h) => h === 'provincia' || h === 'province' || h === 'estado');
    if (cpCol < 0 || zoneCol < 0) {
      throw new Error(`columnas mínimas (cp, zona) no encontradas — headers leídos: ${headers.join(', ')}`);
    }

    const rows: Array<{ cp: string; zone: string; locality: string | null; province: string | null }> = [];
    const invalid: Array<{ rowIndex: number; reason: string }> = [];
    for (let i = 1; i < grid.length; i++) {
      const r = grid[i];
      const cp = normaliseCp(r[cpCol]);
      const zone = String(r[zoneCol] ?? '').trim();
      if (!cp) { invalid.push({ rowIndex: i + 1, reason: 'CP vacío o ilegible' }); continue; }
      if (!zone) { invalid.push({ rowIndex: i + 1, reason: `CP ${cp} sin zona asignada` }); continue; }
      rows.push({
        cp,
        zone: zone.slice(0, 40),
        locality: locCol >= 0 ? (String(r[locCol] ?? '').trim().slice(0, 120) || null) : null,
        province: provCol >= 0 ? (String(r[provCol] ?? '').trim().slice(0, 120) || null) : null,
      });
    }
    return { rows, invalid };
  }

  /**
   * Upsert masivo del mapping. Si una fila con el mismo CP ya existe
   * con la misma zona, no cuenta como update (`unchanged`).
   */
  async applyMapping(
    rows: Array<{ cp: string; zone: string; locality: string | null; province: string | null }>,
    invalid: Array<{ rowIndex: number; reason: string }> = [],
  ): Promise<PostalCodeZoneUploadResult> {
    const result: PostalCodeZoneUploadResult = {
      parsedRows: rows.length + invalid.length,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      invalid: invalid.length,
      invalidSamples: invalid.slice(0, 10),
    };
    if (rows.length === 0) return result;
    const cps = Array.from(new Set(rows.map((r) => r.cp)));
    const existing = await this.prisma.postalCodeZone.findMany({
      where: { cp: { in: cps } },
      select: { cp: true, zone: true, locality: true, province: true },
    });
    const byCp = new Map(existing.map((e) => [e.cp, e]));
    for (const r of rows) {
      const e = byCp.get(r.cp);
      if (!e) {
        await this.prisma.postalCodeZone.create({
          data: { cp: r.cp, zone: r.zone, locality: r.locality, province: r.province, active: true },
        });
        result.inserted++;
        continue;
      }
      const sameZone = e.zone === r.zone;
      const sameLoc = (e.locality ?? null) === r.locality;
      const sameProv = (e.province ?? null) === r.province;
      if (sameZone && sameLoc && sameProv) {
        result.unchanged++;
        continue;
      }
      await this.prisma.postalCodeZone.update({
        where: { cp: r.cp },
        data: { zone: r.zone, locality: r.locality, province: r.province, active: true },
      });
      result.updated++;
    }
    this.logger.log(
      `postal-code-zones applied: parsed=${result.parsedRows} ` +
      `inserted=${result.inserted} updated=${result.updated} ` +
      `unchanged=${result.unchanged} invalid=${result.invalid}`,
    );
    return result;
  }

  /** Para el lookup en analytics — barato, indexed PK. */
  async getZoneByCp(rawCp: string | null | undefined): Promise<string | null> {
    const cp = normaliseCp(rawCp);
    if (!cp) return null;
    const row = await this.prisma.postalCodeZone.findUnique({
      where: { cp },
      select: { zone: true, active: true },
    });
    return row && row.active ? row.zone : null;
  }

  /** Versión sync — recibe un cache pre-cargado para evitar N round-trips. */
  resolveZoneFromCache(
    rawCp: string | null | undefined,
    cache: Map<string, { zone: string; active: boolean }>,
  ): string | null {
    const cp = normaliseCp(rawCp);
    if (!cp) return null;
    const hit = cache.get(cp);
    return hit && hit.active ? hit.zone : null;
  }

  /** Lista para el admin panel — ordenada por zona + cp. */
  async list(opts?: { activeOnly?: boolean; limit?: number }): Promise<PostalCodeZone[]> {
    return this.prisma.postalCodeZone.findMany({
      where: opts?.activeOnly ? { active: true } : undefined,
      orderBy: [{ zone: 'asc' }, { cp: 'asc' }],
      take: opts?.limit ? Math.max(1, Math.min(5000, opts.limit)) : 1000,
    });
  }

  /** Pre-carga todo el mapping para que el aggregator haga lookups in-memory. */
  async loadFullCache(): Promise<Map<string, { zone: string; active: boolean }>> {
    const rows = await this.prisma.postalCodeZone.findMany({
      select: { cp: true, zone: true, active: true },
    });
    const m = new Map<string, { zone: string; active: boolean }>();
    for (const r of rows) m.set(r.cp, { zone: r.zone, active: r.active });
    return m;
  }

  async deleteAll(): Promise<number> {
    const r = await this.prisma.postalCodeZone.deleteMany({});
    this.logger.warn(`postal-code-zones: TODA la tabla borrada (n=${r.count})`);
    return r.count;
  }
}
