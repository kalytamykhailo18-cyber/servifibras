/**
 * Admin endpoints — base de conocimiento por publicación.
 *
 *   POST /admin/mercadolibre/publications/:itemId/ingest
 *      Ingiere todo el histórico Q&A de la publicación desde la API
 *      de ML. Idempotente.
 *   GET  /admin/mercadolibre/publications/:itemId/knowledge
 *      Lista las Q&A guardadas (para el panel curador).
 *   GET  /admin/mercadolibre/publications/knowledge/summary
 *      Counts por publicación (total + pending + kept + edited + discarded).
 *   PUT  /admin/mercadolibre/publications/knowledge/:rowId
 *      Curación: keep / edit / discard.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../guards/auth.guard';
import { Roles, RolesGuard } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { MlPublicationKnowledgeService } from '../../../adapters/admin/ml-publication-knowledge.service';

@Controller('admin/mercadolibre/publications')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS)
export class MlPublicationKnowledgeController {
  private readonly logger = new Logger(MlPublicationKnowledgeController.name);

  constructor(private readonly svc: MlPublicationKnowledgeService) {}

  @Post(':itemId/ingest')
  @Roles(UserRole.ADMIN, UserRole.ATENCION)
  async ingest(
    @Param('itemId') itemId: string,
    @Query('accountKey') accountKey?: string,
  ) {
    const ak: 'mercadolibre' | 'mercadolibre_cuenta2' =
      accountKey === 'mercadolibre_cuenta2' ? 'mercadolibre_cuenta2' : 'mercadolibre';
    if (!itemId || !/^MLA\d+$/i.test(itemId)) {
      throw new BadRequestException('itemId debe ser un MLA válido (ej. MLA1234567890)');
    }
    const data = await this.svc.ingestForItem({ itemId: itemId.toUpperCase(), accountKey: ak });
    return { success: true, data };
  }

  /**
   * Marcos 2026-06-24: auto-mark como 'kept' todas las filas pending
   * con aiValidityScore >= 0.7 (la IA las validó). Acelera curación
   * masiva. Operador puede revisar/desmarcar después.
   */
  @Post(':itemId/auto-keep-high-score')
  @Roles(UserRole.ADMIN, UserRole.ATENCION)
  async autoKeepHighScore(
    @Param('itemId') itemId: string,
    @Request() req: any,
  ) {
    if (!itemId || !/^MLA\d+$/i.test(itemId)) {
      throw new BadRequestException('itemId debe ser un MLA válido');
    }
    const data = await this.svc.autoKeepHighScore({
      itemId: itemId.toUpperCase(),
      userId: req.user?.id ?? null,
    });
    return { success: true, data };
  }

  /**
   * Marcos 2026-06-24: ingesta de TODO el catálogo activo (ambas
   * cuentas o una específica via accountKey). Auto-descubre las
   * publicaciones activas y las ingiere una por una. ADMIN-only.
   */
  @Post('ingest-all-catalog')
  @Roles(UserRole.ADMIN)
  async ingestAllCatalog(
    @Body() body: { accountKey?: 'mercadolibre' | 'mercadolibre_cuenta2' | 'both' } = {},
  ) {
    const data = await this.svc.ingestAllCatalog({ accountKey: body?.accountKey ?? 'both' });
    return { success: true, data };
  }

  /**
   * Marcos 2026-06-24: bulk-ingest. Recibe lista de MLA ids + accountKey
   * y los ingiere uno por uno. Devuelve resumen por publicación.
   */
  @Post('bulk-ingest')
  @Roles(UserRole.ADMIN, UserRole.ATENCION)
  async bulkIngest(@Body() body: { itemIds?: string[]; accountKey?: string }) {
    const ak: 'mercadolibre' | 'mercadolibre_cuenta2' =
      body?.accountKey === 'mercadolibre_cuenta2' ? 'mercadolibre_cuenta2' : 'mercadolibre';
    const ids = Array.isArray(body?.itemIds)
      ? body.itemIds.filter((id): id is string => typeof id === 'string' && /^MLA\d+$/i.test(id)).map((id) => id.toUpperCase())
      : [];
    if (ids.length === 0) {
      throw new BadRequestException('itemIds debe ser un array de MLA IDs válidos');
    }
    if (ids.length > 100) {
      throw new BadRequestException('Max 100 publicaciones por bulk-ingest — partí en grupos');
    }
    const out: Array<{ itemId: string; fetched: number; inserted: number; skipped: number; errored: number }> = [];
    for (const id of ids) {
      try {
        const r = await this.svc.ingestForItem({ itemId: id, accountKey: ak });
        out.push({ itemId: id, fetched: r.fetched, inserted: r.inserted, skipped: r.skipped, errored: r.errored });
      } catch (err: any) {
        out.push({ itemId: id, fetched: 0, inserted: 0, skipped: 0, errored: 1 });
      }
    }
    const totals = out.reduce((acc, r) => ({
      fetched: acc.fetched + r.fetched,
      inserted: acc.inserted + r.inserted,
      skipped: acc.skipped + r.skipped,
      errored: acc.errored + r.errored,
    }), { fetched: 0, inserted: 0, skipped: 0, errored: 0 });
    return { success: true, data: { results: out, totals } };
  }

  /**
   * Marcos 2026-06-24 (Phase B): pasada de IA staleness sobre todas
   * las Q&A pendientes de la publicación. Cada fila queda con
   * aiValidityScore + aiNote para que el operador foque en las
   * dudosas. NO modifica curationStatus.
   */
  @Post(':itemId/ai-staleness-pass')
  @Roles(UserRole.ADMIN, UserRole.ATENCION)
  async aiStalenessPass(
    @Param('itemId') itemId: string,
    @Query('limit') limit?: string,
  ) {
    if (!itemId || !/^MLA\d+$/i.test(itemId)) {
      throw new BadRequestException('itemId debe ser un MLA válido');
    }
    const lim = limit ? Math.max(1, Math.min(200, parseInt(limit, 10))) : 100;
    const data = await this.svc.aiStalenessPassForItem({ itemId: itemId.toUpperCase(), limit: lim });
    return { success: true, data };
  }

  /**
   * Marcos 2026-06-25: setea el closedModeMode de una publicación.
   * 'auto' (default) — modo cerrado se activa cuando hay >= 3 curadas.
   * 'always-draft' — fuerza que TODAS las respuestas queden como draft.
   * 'always-send' — bypass del self-eval, auto-envío directo.
   */
  @Post(':itemId/closed-mode')
  @Roles(UserRole.ADMIN)
  async setClosedMode(
    @Param('itemId') itemId: string,
    @Body() body: { mode?: 'auto' | 'always-draft' | 'always-send' },
    @Request() req: any,
  ) {
    if (!itemId || !/^MLA\d+$/i.test(itemId)) {
      throw new BadRequestException('itemId debe ser un MLA válido');
    }
    const mode = body?.mode;
    if (!mode || !['auto', 'always-draft', 'always-send'].includes(mode)) {
      throw new BadRequestException('mode debe ser auto | always-draft | always-send');
    }
    const r = await this.svc.setClosedModeMode({
      itemId: itemId.toUpperCase(),
      mode,
      userId: req.user?.id ?? null,
    });
    if (!r.ok) throw new BadRequestException('No se pudo aplicar el setting');
    return { success: true, data: { itemId: itemId.toUpperCase(), mode } };
  }

  @Get('knowledge/summary')
  async summary() {
    const data = await this.svc.summary();
    return { success: true, data };
  }

  @Get(':itemId/knowledge')
  async listForItem(@Param('itemId') itemId: string) {
    const data = await this.svc.listForItem(itemId.toUpperCase());
    return { success: true, data };
  }

  @Put('knowledge/:rowId')
  @Roles(UserRole.ADMIN, UserRole.ATENCION)
  async curate(
    @Param('rowId') rowId: string,
    @Body() body: { action?: 'keep' | 'edit' | 'discard'; curatedAnswer?: string; stalenessFlag?: string },
    @Request() req: any,
  ) {
    const action = body?.action;
    if (action !== 'keep' && action !== 'edit' && action !== 'discard') {
      throw new BadRequestException('action debe ser keep | edit | discard');
    }
    const r = await this.svc.curate({
      id: rowId,
      action,
      curatedAnswer: body?.curatedAnswer,
      stalenessFlag: body?.stalenessFlag,
      userId: req.user?.id ?? null,
    });
    if (!r.ok) throw new NotFoundException(r.reason ?? 'No se pudo curar');
    return { success: true, data: { id: rowId, action } };
  }
}
