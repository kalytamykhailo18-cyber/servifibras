/**
 * INFRASTRUCTURE LAYER — ML competitor watch endpoints (Bloque A item 3).
 *
 * Marcos 2026-06-08: since ML locked down public site search, the
 * watch-list approach lets Marcos paste ML item IDs (MLA...) of
 * competing listings per Servifibras product. The service fetches
 * each watch's live data on demand and surfaces price, stock,
 * sold quantity, seller in the panel.
 *
 *   GET    /admin/competitors?productId=<id>[&force=1]
 *   POST   /admin/competitors     body: { productId, itemId, label? }
 *   DELETE /admin/competitors/<watchId>
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { MlCompetitorsService } from '../../../adapters/admin/ml-competitors.service';

@Controller('admin/competitors')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.VENTAS)
export class MlCompetitorsController {
  private readonly logger = new Logger(MlCompetitorsController.name);

  constructor(private readonly svc: MlCompetitorsService) {}

  @Get()
  async list(
    @Query('productId') productId?: string,
    @Query('force') force?: string,
  ) {
    // Marcos 2026-06-24: sin productId, devolvemos TODOS los productos
    // que tengan watches cargados — vista centralizada de /competidores.
    if (!productId) {
      try {
        const data = await this.svc.listAll({ force: force === '1' || force === 'true' });
        return { success: true, data };
      } catch (err: any) {
        this.logger.error(`Competitors listAll failed: ${err.message}`);
        throw new BadRequestException(err.message);
      }
    }
    try {
      const data = await this.svc.listForProduct({
        productId,
        force: force === '1' || force === 'true',
      });
      return { success: true, data };
    } catch (err: any) {
      this.logger.error(`Competitors list failed for ${productId}: ${err.message}`);
      throw new BadRequestException(err.message);
    }
  }

  @Post()
  async add(
    @Body() body: { productId?: string; itemId?: string; label?: string },
    @Request() req: any,
  ) {
    const productId = String(body?.productId ?? '').trim();
    const itemId = String(body?.itemId ?? '').trim();
    if (!productId) throw new BadRequestException('productId is required');
    if (!itemId) throw new BadRequestException('itemId is required');
    try {
      const row = await this.svc.addWatch({
        productId,
        itemId,
        label: body?.label ?? null,
        createdById: req.user?.id ?? null,
      });
      this.logger.log(
        `Competitor watch added for product ${productId} → ${row.itemId} by ${req.user?.email ?? 'unknown'}`,
      );
      return { success: true, data: row };
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  @Delete(':watchId')
  async remove(@Param('watchId') watchId: string, @Request() req: any) {
    const ok = await this.svc.removeWatch(watchId);
    if (!ok) throw new NotFoundException('watch not found');
    this.logger.log(
      `Competitor watch ${watchId} removed by ${req.user?.email ?? 'unknown'}`,
    );
    return { success: true };
  }
}
