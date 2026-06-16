/**
 * INFRASTRUCTURE LAYER — Admin Products Controller.
 *
 * RBAC:
 *   - Read endpoints — any operator role (composer, AI, future search).
 *   - Write endpoints — ADMIN only (catalog is sensitive: prices feed the
 *     pricing calculator + AI replies + campaigns).
 *
 * After every write we trigger ClaudeService.reloadKnowledgeBase() so the
 * change reaches the AI context without a service restart.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductSource } from '@prisma/client';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import {
  ExternalProductRow,
  ProductCatalogService,
} from '../../../adapters/admin/product-catalog.service';
import { ClaudeService } from '../../../adapters/ai/claude.service';
import { WarehouseLocationsService } from '../../../adapters/admin/warehouse-locations.service';

/**
 * Minimal CSV parser tuned for our single-table import. Skips empty
 * lines, supports quoted fields with escaped quotes (RFC4180), and
 * tolerates comma-or-semicolon separators (Excel-AR exports use ";").
 */
function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const sep = (lines[0].split(';').length > lines[0].split(',').length) ? ';' : ',';

  function splitLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else cur += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === sep) { out.push(cur); cur = ''; }
        else cur += c;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }

  const headers = splitLine(lines[0]).map((h) => h.toLowerCase());
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

/**
 * Marcos 2026-06-12: parse the CRM Excel he uses for invoicing.
 * Sheet `precios` has these headers (case + accents matter to the
 * operator, not to us — we normalise both sides):
 *   "Código Interno", "Código de Barras", "Producto", "Marca",
 *   "Categoría", "Neto", "Final", "Moneda", "id", "Stock",
 *   "Reservas"
 *
 * Mapping into Servifibras Product:
 *   sku           ← Código Interno (fallback: id, then "ext-<row#>")
 *   name          ← Producto (trimmed)
 *   category      ← Categoría
 *   description   ← "Marca: {Marca}" when Marca is set, else null
 *   basePriceArs  ← Final
 *   stockQuantity ← Stock
 *   inStock       ← Stock > 0
 *   externalId    ← id (CRM-internal numeric id)
 *   baseUnit      ← "unidad" (default, no per-row unit in the CRM)
 *
 * Rows without a meaningful sku/name combination are dropped (the
 * service skips them anyway, but doing it here keeps the response
 * counts honest).
 */
function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function normalizeHeader(h: any): string {
  return stripAccents(String(h ?? '').trim().toLowerCase()).replace(/\s+/g, ' ');
}
function xlsxRowsToProducts(headers: any[], rows: any[][]): ExternalProductRow[] {
  const idx = (label: string): number =>
    headers.findIndex((h) => normalizeHeader(h) === normalizeHeader(label));
  const iSku   = idx('Código Interno');
  const iName  = idx('Producto');
  const iBrand = idx('Marca');
  const iCat   = idx('Categoría');
  const iFinal = idx('Final');
  const iStock = idx('Stock');
  const iId    = idx('id');
  if (iName < 0) {
    throw new Error('Excel sin columna "Producto" — verificá el formato');
  }
  const out: ExternalProductRow[] = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const rawSku = iSku >= 0 ? String(row[iSku] ?? '').trim() : '';
    const rawId  = iId  >= 0 ? String(row[iId]  ?? '').trim() : '';
    const sku = rawSku || (rawId ? `crm-${rawId}` : '');
    const name = String(row[iName] ?? '').trim();
    if (!name) continue;
    // Auto-skip the very last row if it's a "TOTAL" summary line —
    // common Excel artifact.
    if (!sku && /^total/i.test(name)) continue;
    const brand = iBrand >= 0 ? String(row[iBrand] ?? '').trim() : '';
    const category = iCat >= 0 ? String(row[iCat] ?? '').trim() : '';
    const finalPrice = iFinal >= 0 ? Number(row[iFinal]) : NaN;
    const stock = iStock >= 0 ? Number(row[iStock]) : NaN;
    out.push({
      sku: sku || `ext-row-${r + 1}`,
      name,
      category: category || 'General',
      description: brand ? `Marca: ${brand}` : null,
      baseUnit: 'unidad',
      basePriceArs: Number.isFinite(finalPrice) ? finalPrice : null,
      basePriceUsd: null,
      inStock: Number.isFinite(stock) ? stock > 0 : true,
      stockQuantity: Number.isFinite(stock) ? stock : null,
      active: true,
      externalId: rawId || null,
    });
  }
  return out;
}

function csvRowToProduct(row: Record<string, string>): ExternalProductRow {
  const num = (s: string | undefined): number | null => {
    if (s == null || s === '') return null;
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const bool = (s: string | undefined): boolean => {
    if (s == null) return true;
    const t = s.trim().toLowerCase();
    return !(t === 'false' || t === '0' || t === 'no');
  };
  // Note: parser lower-cases all header names, so we look up
  // already-normalised keys here (no mixed case).
  return {
    sku: row.sku,
    name: row.name ?? row.nombre,
    category: row.category ?? row.categoria,
    description: row.description ?? row.descripcion ?? null,
    baseUnit: row.unit ?? row.unidad ?? row.baseunit,
    basePriceArs: num(row.pricears ?? row.price_ars ?? row.precioars ?? row.precio_ars),
    basePriceUsd: num(row.priceusd ?? row.price_usd ?? row.preciousd ?? row.precio_usd),
    inStock: bool(row.instock ?? row.in_stock ?? row.stock),
    stockQuantity: num(row.stockquantity ?? row.stock_quantity ?? row.cantidad),
    active: bool(row.active ?? row.activo),
    externalId: row.externalid ?? row.external_id ?? null,
  };
}

@Controller('admin/products')
@UseGuards(AuthGuard, RolesGuard)
export class ProductsController {
  private readonly logger = new Logger(ProductsController.name);

  constructor(
    private readonly svc: ProductCatalogService,
    private readonly claude: ClaudeService,
    private readonly warehouse: WarehouseLocationsService,
  ) {}

  /**
   * Marcos 2026-06-10: upload the "Ubicación de moldes" sheet so
   * the daily-logística panel can show "UBI: 300" next to each
   * SKU. Accepts .xlsx or .csv with two columns:
   *   A) sku
   *   B) ubicación
   * Returns a summary so Marcos sees if any SKUs in his sheet
   * don't match anything in the catalog (typos / discontinued).
   */
  @Post('upload-locations')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async uploadLocations(@UploadedFile() file: any) {
    if (!file || !file.buffer) {
      throw new BadRequestException('file is required (multipart field "file")');
    }
    if (file.buffer.length > 5 * 1024 * 1024) {
      throw new BadRequestException('file exceeds 5 MB limit');
    }
    let pairs;
    try {
      pairs = this.warehouse.parseBuffer(file.buffer);
    } catch (err: any) {
      throw new BadRequestException(`parse failed: ${err?.message ?? err}`);
    }
    const result = await this.warehouse.applyLocations(pairs);
    return { success: true, data: result };
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async list(
    @Query('activeOnly') activeOnly?: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
  ) {
    const items = await this.svc.list({
      activeOnly: activeOnly === 'true',
      category: category && category.trim().length > 0 ? category.trim() : undefined,
      search: search && search.trim().length > 0 ? search.trim() : undefined,
    });
    return { success: true, data: items };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getOne(@Param('id') id: string) {
    const p = await this.svc.getById(id);
    if (!p) return { success: false, error: 'not found' };
    return { success: true, data: p };
  }

  @Post()
  @Roles(UserRole.ADMIN)
  async create(@Body() body: any, @Request() req: any) {
    try {
      const created = await this.svc.create(body);
      void this.claude.reloadKnowledgeBase();
      this.logger.log(`Product ${created.sku} created by ${req.user.email}`);
      return { success: true, data: created };
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  async update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    try {
      const updated = await this.svc.update(id, body);
      if (!updated) return { success: false, error: 'not found' };
      void this.claude.reloadKnowledgeBase();
      this.logger.log(`Product ${updated.sku} updated by ${req.user.email}`);
      return { success: true, data: updated };
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async remove(@Param('id') id: string, @Request() req: any) {
    const ok = await this.svc.delete(id);
    if (ok) void this.claude.reloadKnowledgeBase();
    this.logger.log(`Product ${id} deleted by ${req.user.email}: ${ok}`);
    return { success: ok };
  }

  /**
   * POST /admin/products/import
   * multipart/form-data: { file: <text/csv> }
   *
   * Bulk-import a catalog from CSV. Headers (case-insensitive):
   *   sku, name, category, description, unit, priceArs, priceUsd,
   *   inStock, stockQuantity, active, externalId
   *
   * Existing SKUs are updated; new ones created. Rows missing
   * sku/name/category are skipped. Returns counts so the operator can
   * see at-a-glance what landed.
   */
  @Post('import')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async importCsv(
    @UploadedFile() file: any,
    @Request() req: any,
  ) {
    if (!file || !file.buffer) throw new BadRequestException('file is required');
    const mime = (file.mimetype || '').toLowerCase();
    const name = (file.originalname || '').toLowerCase();
    // Marcos 2026-06-12: the CRM exports xlsx. We keep CSV support
    // (operators sometimes paste a stripped-down CSV) and add a
    // sibling xlsx path that parses the workbook's `precios` sheet.
    const isXlsx = name.endsWith('.xlsx') || mime.includes('spreadsheetml.sheet') || mime.includes('vnd.openxmlformats-officedocument');
    const isCsv = !isXlsx && (mime.includes('csv') || mime.includes('text/plain') || mime.includes('application/vnd.ms-excel') || name.endsWith('.csv'));
    if (!isXlsx && !isCsv) {
      throw new BadRequestException(`expected CSV or XLSX, got ${mime || name}`);
    }
    let rows: ExternalProductRow[];
    if (isXlsx) {
      // Lazy require so unit-test / non-import code paths don't pay
      // the xlsx load cost. XLSX is already a project dep (used by
      // ventas-unificadas-drive).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const XLSX = require('xlsx');
      const wb = XLSX.read(file.buffer, { type: 'buffer' });
      // Prefer the "precios" sheet Marcos's CRM uses; fall back to
      // the first sheet so other CRM exports still import.
      const sheetName = wb.SheetNames.find((s: string) => normalizeHeader(s) === 'precios') ?? wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
      if (grid.length < 2) {
        return { success: false, error: 'Excel sin filas de datos' };
      }
      const [headers, ...dataRows] = grid;
      rows = xlsxRowsToProducts(headers, dataRows);
    } else {
      const text = file.buffer.toString('utf-8');
      const csvRows = parseCsv(text);
      if (csvRows.length === 0) {
        return { success: false, error: 'CSV has no data rows' };
      }
      rows = csvRows.map(csvRowToProduct);
    }

    const result = await this.svc.bulkUpsertFromExternal(rows, ProductSource.IMPORT);
    void this.claude.reloadKnowledgeBase();
    this.logger.log(
      `Import by ${req.user.email}: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`,
    );
    return { success: true, data: result };
  }
}
