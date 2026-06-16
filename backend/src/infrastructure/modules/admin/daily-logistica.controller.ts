/**
 * INFRASTRUCTURE LAYER — Daily Logística aggregation endpoint.
 *
 * Bloque C — Marcos 2026-06-06. Exposes the per-day aggregation so:
 *   1. The operator panel can preview what will land in the daily
 *      Excel before downloading it.
 *   2. The Excel generator (item #6) consumes the same shape.
 *   3. Smoke tests can validate the source-split rules without
 *      touching the xlsx layer.
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { DailyLogisticaAggregatorService } from '../../../adapters/admin/daily-logistica-aggregator.service';
import { DailyLogisticaXlsxService } from '../../../adapters/admin/daily-logistica-xlsx.service';
import { LogisticaArmadoService } from '../../../adapters/admin/logistica-armado.service';
import { ConfigurationService } from '../../../adapters/admin/configuration.service';

function parseDateParam(raw: string | undefined): Date {
  if (!raw || raw.trim().length === 0) return new Date();
  // Accept YYYY-MM-DD (preferred) or any ISO-parsable string.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (m) {
    const [, y, mo, d] = m;
    const dt = new Date(Number(y), Number(mo) - 1, Number(d));
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) {
    throw new BadRequestException(`invalid date: ${raw}`);
  }
  return dt;
}

@Controller('admin/daily-logistica')
@UseGuards(AuthGuard, RolesGuard)
export class DailyLogisticaController {
  private readonly logger = new Logger(DailyLogisticaController.name);

  constructor(
    private readonly aggregator: DailyLogisticaAggregatorService,
    private readonly armado: LogisticaArmadoService,
    private readonly xlsx: DailyLogisticaXlsxService,
    private readonly config: ConfigurationService,
  ) {}

  /**
   * Marcos 2026-06-10: resolve the live flex-courier list. Prefers
   * the DB-stored LogisticaConfiguration.flexCouriers (editable from
   * the admin settings UI without a redeploy); falls back to the
   * FLEX_COURIERS env at boot time so a brand-new install with no
   * config row still works.
   */
  private async resolveFlexCouriers(): Promise<string[]> {
    try {
      const cfg = await this.config.getLogisticaConfiguration();
      const fromDb = cfg?.flexCouriers;
      if (Array.isArray(fromDb) && fromDb.length > 0) {
        return fromDb.map((s) => String(s).trim()).filter(Boolean);
      }
    } catch (err: any) {
      this.logger.warn(`flex couriers DB read failed, falling back to env: ${err?.message ?? err}`);
    }
    return (process.env.FLEX_COURIERS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /**
   * GET /admin/daily-logistica?date=YYYY-MM-DD
   * Returns the 6-section aggregation for the requested day.
   * `date` defaults to today (server time).
   */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async aggregate(@Query('date') dateParam?: string) {
    const date = parseDateParam(dateParam);
    const result = await this.aggregator.aggregate(date);
    return { success: true, data: result };
  }

  /**
   * GET /admin/daily-logistica/excel?date=YYYY-MM-DD
   * Streams the daily logistics xlsx straight to the operator — same
   * file shape as Marcos's manual sheet (header → PRFV → 6 daily
   * sections in order). The picker downloads this once per day and
   * sends it to the Zebra-side workflow.
   */
  @Get('excel')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async downloadExcel(
    @Query('date') dateParam: string | undefined,
    @Res() res: Response,
  ) {
    const date = parseDateParam(dateParam);
    const { buffer, filename } = await this.xlsx.build(date);
    this.logger.log(`Daily Logística xlsx download: ${filename} (${buffer.length}B)`);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.send(buffer);
  }

  /**
   * POST /admin/daily-logistica/armado
   * Body: { rowKey: string, dayDate: string }
   *
   * Mark a row as armado. Idempotent — re-clicking the same row keeps
   * the original timestamp and operator attribution. Used by the
   * picker UI on the daily Logística page as they finish assembling
   * each order.
   */
  @Post('armado')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async markArmado(
    @Body() body: { rowKey?: string; dayDate?: string },
    @Request() req: any,
  ) {
    const rowKey = String(body?.rowKey ?? '').trim();
    const dayDate = String(body?.dayDate ?? '').trim();
    if (!rowKey) throw new BadRequestException('rowKey is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) {
      throw new BadRequestException('dayDate must be YYYY-MM-DD');
    }
    const row = await this.armado.mark({
      rowKey,
      dayDate,
      stampedById: req.user?.id ?? null,
    });
    return { success: true, data: row };
  }

  /**
   * DELETE /admin/daily-logistica/armado/:rowKey
   * Undo a misclick — clears the row's armado tick.
   */
  @Delete('armado/:rowKey')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async unmarkArmado(@Param('rowKey') rowKey: string) {
    const cleared = await this.armado.unmark(rowKey);
    if (!cleared) {
      throw new NotFoundException('armado not found for that rowKey');
    }
    return { success: true };
  }

  /**
   * POST /admin/daily-logistica/advance
   * Body: { rowKey, dayDate }
   *
   * Bloque B item 3.6 — Marcos 2026-06-08: forward-only state click.
   * PENDIENTE → ARMADO → LISTO. Drives the row-level click on the
   * daily logística panel. Idempotent on LISTO.
   */
  @Post('advance')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async advanceState(
    @Body() body: { rowKey?: string; dayDate?: string },
    @Request() req: any,
  ) {
    const rowKey = String(body?.rowKey ?? '').trim();
    const dayDate = String(body?.dayDate ?? '').trim();
    if (!rowKey) throw new BadRequestException('rowKey is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) {
      throw new BadRequestException('dayDate must be YYYY-MM-DD');
    }
    try {
      const row = await this.armado.advanceState({
        rowKey,
        dayDate,
        stampedById: req.user?.id ?? null,
      });
      return { success: true, data: row };
    } catch (err: any) {
      // Bloque B item 3.7 — items-incomplete guard surfaces as 409
      // so the UI can keep the LISTO button disabled with a clear
      // tooltip + the counter "(N/M)".
      if (err?.code === 'ITEMS_INCOMPLETE') {
        throw new ConflictException({
          message: err.message,
          code: 'ITEMS_INCOMPLETE',
          checked: err.checked,
          expected: err.expected,
        });
      }
      throw err;
    }
  }

  /**
   * POST /admin/daily-logistica/note
   * Body: { rowKey, dayDate, note }
   *
   * Bloque B item 3.8 — Marcos 2026-06-08: per-row free-text note
   * editable inline from the panel. Empty / blank `note` clears it.
   * Capped at 500 chars server-side.
   */
  @Post('note')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async setNote(
    @Body() body: { rowKey?: string; dayDate?: string; note?: string },
    @Request() req: any,
  ) {
    const rowKey = String(body?.rowKey ?? '').trim();
    const dayDate = String(body?.dayDate ?? '').trim();
    if (!rowKey) throw new BadRequestException('rowKey is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) {
      throw new BadRequestException('dayDate must be YYYY-MM-DD');
    }
    const row = await this.armado.setNote({
      rowKey,
      dayDate,
      note: body?.note ?? null,
      stampedById: req.user?.id ?? null,
    });
    return { success: true, data: row };
  }

  /**
   * POST /admin/daily-logistica/item-check
   * Body: { rowKey, dayDate, itemKey, checked, itemsExpected }
   *
   * Bloque B item 3.7 — Marcos 2026-06-08: per-item check for the
   * multi-item armado flow. The picker ticks each SKU as it lands in
   * the box. itemsExpected is the row's total item count (frontend
   * computes it from the items array and forwards on every call).
   */
  @Post('item-check')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async toggleItemCheck(
    @Body() body: {
      rowKey?: string;
      dayDate?: string;
      itemKey?: string;
      checked?: boolean;
      itemsExpected?: number;
    },
    @Request() req: any,
  ) {
    const rowKey = String(body?.rowKey ?? '').trim();
    const dayDate = String(body?.dayDate ?? '').trim();
    const itemKey = String(body?.itemKey ?? '').trim();
    const itemsExpected = Number(body?.itemsExpected);
    if (!rowKey) throw new BadRequestException('rowKey is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) {
      throw new BadRequestException('dayDate must be YYYY-MM-DD');
    }
    if (!itemKey) throw new BadRequestException('itemKey is required');
    if (!Number.isFinite(itemsExpected) || itemsExpected <= 0) {
      throw new BadRequestException('itemsExpected must be a positive number');
    }
    const row = await this.armado.toggleItemCheck({
      rowKey,
      dayDate,
      itemKey,
      checked: body?.checked === true,
      itemsExpected,
      stampedById: req.user?.id ?? null,
    });
    return { success: true, data: row };
  }

  /**
   * POST /admin/daily-logistica/bulk-state
   * Body: { rowKeys: string[], dayDate, targetState: 'ARMADO'|'LISTO' }
   *
   * Bloque B item 3.6 — bulk action. The operator multi-selects rows
   * in the daily panel and marks them all as ARMADO or LISTO in one
   * click (e.g. all the FLEX 1 packs of the day at end-of-shift).
   * Per-row failures are reported in the response so the UI can
   * highlight any rowKey that didn't take.
   */
  @Post('bulk-state')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async bulkSetState(
    @Body()
    body: {
      rowKeys?: string[];
      dayDate?: string;
      targetState?: string;
    },
    @Request() req: any,
  ) {
    const rowKeys = Array.isArray(body?.rowKeys)
      ? body!.rowKeys.map((k) => String(k ?? '').trim()).filter(Boolean)
      : [];
    const dayDate = String(body?.dayDate ?? '').trim();
    const targetRaw = String(body?.targetState ?? '').trim().toUpperCase();
    if (rowKeys.length === 0) throw new BadRequestException('rowKeys is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) {
      throw new BadRequestException('dayDate must be YYYY-MM-DD');
    }
    if (targetRaw !== 'ARMADO' && targetRaw !== 'LISTO') {
      throw new BadRequestException('targetState must be ARMADO or LISTO');
    }
    const result = await this.armado.bulkSetState({
      rowKeys,
      dayDate,
      targetState: targetRaw as any,
      stampedById: req.user?.id ?? null,
    });
    this.logger.log(
      `bulk-state by ${req.user?.email ?? 'unknown'}: ${rowKeys.length} → ${targetRaw} (created=${result.created} updated=${result.updated} failed=${result.failed.length})`,
    );
    return { success: true, data: result };
  }

  /**
   * Marcos 2026-06-10: set the flex courier on one or many FLEX rows.
   * Body shape:
   *   { rowKeys: string[], dayDate: 'YYYY-MM-DD', courier: string | null }
   * `courier=null` (or empty string) clears the field. The list of
   * allowed couriers comes from the FLEX_COURIERS env so Marcos can
   * tune the dropdown without a redeploy.
   */
  @Post('flex-courier')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async setFlexCourier(
    @Body()
    body: {
      rowKeys?: string[];
      dayDate?: string;
      courier?: string | null;
    },
    @Request() req: any,
  ) {
    const rowKeys = Array.isArray(body?.rowKeys)
      ? body!.rowKeys.map((k) => String(k ?? '').trim()).filter(Boolean)
      : [];
    const dayDate = String(body?.dayDate ?? '').trim();
    const courier = body?.courier == null ? null : String(body.courier).trim() || null;
    if (rowKeys.length === 0) throw new BadRequestException('rowKeys is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) {
      throw new BadRequestException('dayDate must be YYYY-MM-DD');
    }
    if (courier) {
      const allowed = await this.resolveFlexCouriers();
      if (allowed.length > 0 && !allowed.includes(courier)) {
        throw new BadRequestException(`courier "${courier}" is not in the configured list`);
      }
    }
    const result = await this.armado.bulkSetFlexCourier({
      rowKeys,
      dayDate,
      courier,
      stampedById: req.user?.id ?? null,
    });
    this.logger.log(
      `flex-courier by ${req.user?.email ?? 'unknown'}: ${rowKeys.length} → "${courier ?? ''}" (updated=${result.updated} failed=${result.failed.length})`,
    );
    return { success: true, data: result };
  }

  /**
   * Marcos 2026-06-10: expose the allowed flex couriers so the
   * frontend dropdown stays in sync without a redeploy. DB-first,
   * env fallback (see resolveFlexCouriers).
   */
  @Get('flex-couriers')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async flexCouriers() {
    const list = await this.resolveFlexCouriers();
    return { success: true, data: { couriers: list } };
  }

  /**
   * Marcos 2026-06-10: admin-only update of the flex courier list.
   * Writes to LogisticaConfiguration.flexCouriers so the rename
   * survives across restarts. Body: { couriers: string[] } — between
   * 1 and 10 names, each trimmed to a sane length.
   */
  @Post('flex-couriers')
  @Roles(UserRole.ADMIN)
  async updateFlexCouriers(@Body() body: { couriers?: unknown }, @Request() req: any) {
    if (!Array.isArray(body?.couriers)) {
      throw new BadRequestException('couriers must be an array of strings');
    }
    const cleaned = (body!.couriers as unknown[])
      .map((c) => String(c ?? '').trim())
      .filter(Boolean)
      .map((c) => c.slice(0, 60));
    if (cleaned.length === 0) throw new BadRequestException('couriers cannot be empty');
    if (cleaned.length > 10) throw new BadRequestException('max 10 couriers');
    const current = (await this.config.getLogisticaConfiguration()) ?? { linksFavoritos: [], notasOperativas: '' };
    const ok = await this.config.updateLogisticaConfiguration({ ...current, flexCouriers: cleaned });
    if (!ok) throw new BadRequestException('could not persist flex couriers');
    this.logger.log(`flex-couriers updated by ${req.user?.email ?? 'unknown'}: ${cleaned.join('|')}`);
    return { success: true, data: { couriers: cleaned } };
  }

  /**
   * Marcos 2026-06-10: archive one or many cancelled rows. Used by
   * the "Eliminar canceladas" bulk button + per-row dismiss. The
   * picker confirms the cancellation and the row leaves the panel
   * (it survives in the cancelled-orders module via archivedAt).
   * Body: { rowKeys: string[], dayDate: 'YYYY-MM-DD' }
   */
  /**
   * Marcos 2026-06-10: move one or many rows to a different section
   * via the manual override. Used by the "Mover a Retira Caseros"
   * action on ML no_shipping rows (and any future re-bucket flows).
   * Body: { rowKeys: string[], dayDate: 'YYYY-MM-DD', section: string | null }
   * section=null clears the override.
   */
  @Post('section-override')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async setSectionOverride(
    @Body() body: { rowKeys?: string[]; dayDate?: string; section?: string | null },
    @Request() req: any,
  ) {
    const rowKeys = Array.isArray(body?.rowKeys)
      ? body!.rowKeys.map((k) => String(k ?? '').trim()).filter(Boolean)
      : [];
    const dayDate = String(body?.dayDate ?? '').trim();
    const section = body?.section == null ? null : String(body.section).trim() || null;
    if (rowKeys.length === 0) throw new BadRequestException('rowKeys is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) {
      throw new BadRequestException('dayDate must be YYYY-MM-DD');
    }
    const valid = new Set(['COLECTA_1','COLECTA_2','FLEX_1','FLEX_2','MOTOS','MICROS','RETIRA_CASEROS']);
    if (section && !valid.has(section)) {
      throw new BadRequestException(`section "${section}" is not a valid panel section`);
    }
    const result = await this.armado.bulkSetSectionOverride({
      rowKeys,
      dayDate,
      section,
      stampedById: req.user?.id ?? null,
    });
    this.logger.log(
      `section-override by ${req.user?.email ?? 'unknown'}: ${rowKeys.length} rows → ${section ?? 'auto'} (updated=${result.updated} failed=${result.failed.length})`,
    );
    return { success: true, data: result };
  }

  /**
   * Marcos 2026-06-10: bulk manual dispatch. Stamps
   * `manuallyDispatchedAt` so the row moves to the Despachadas tab
   * even if ML/TN haven't flipped their source-side dispatch flag
   * yet (buyer pickup at Caseros, courier physically came, etc).
   * Body: { rowKeys: string[], dayDate: 'YYYY-MM-DD', dispatched: boolean }
   */
  @Post('manual-dispatch')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async manualDispatch(
    @Body() body: { rowKeys?: string[]; dayDate?: string; dispatched?: boolean },
    @Request() req: any,
  ) {
    const rowKeys = Array.isArray(body?.rowKeys)
      ? body!.rowKeys.map((k) => String(k ?? '').trim()).filter(Boolean)
      : [];
    const dayDate = String(body?.dayDate ?? '').trim();
    const dispatched = body?.dispatched !== false;
    if (rowKeys.length === 0) throw new BadRequestException('rowKeys is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) {
      throw new BadRequestException('dayDate must be YYYY-MM-DD');
    }
    const result = await this.armado.bulkSetManualDispatch({
      rowKeys,
      dayDate,
      dispatched,
      stampedById: req.user?.id ?? null,
    });
    this.logger.log(
      `manual-dispatch by ${req.user?.email ?? 'unknown'}: ${rowKeys.length} → ${dispatched ? 'dispatched' : 'cleared'} (updated=${result.updated} failed=${result.failed.length})`,
    );
    return { success: true, data: result };
  }

  @Post('archive-cancelled')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async archiveCancelled(
    @Body() body: { rowKeys?: string[]; dayDate?: string },
    @Request() req: any,
  ) {
    const rowKeys = Array.isArray(body?.rowKeys)
      ? body!.rowKeys.map((k) => String(k ?? '').trim()).filter(Boolean)
      : [];
    const dayDate = String(body?.dayDate ?? '').trim();
    if (rowKeys.length === 0) throw new BadRequestException('rowKeys is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) {
      throw new BadRequestException('dayDate must be YYYY-MM-DD');
    }
    const result = await this.armado.archiveCancelled({
      rowKeys,
      dayDate,
      stampedById: req.user?.id ?? null,
    });
    this.logger.log(
      `archive-cancelled by ${req.user?.email ?? 'unknown'}: archived=${result.archived} failed=${result.failed.length}`,
    );
    return { success: true, data: result };
  }
}
