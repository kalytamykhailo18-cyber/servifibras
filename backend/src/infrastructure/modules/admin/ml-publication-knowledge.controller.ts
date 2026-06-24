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
