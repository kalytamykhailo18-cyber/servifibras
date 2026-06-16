/**
 * Admin endpoints for the dispatch tariff table (Marcos 2026-06-15).
 *
 *   GET    /admin/dispatch-tariffs           — list all rows
 *   POST   /admin/dispatch-tariffs           — create
 *   PUT    /admin/dispatch-tariffs/:id       — update
 *   DELETE /admin/dispatch-tariffs/:id       — remove
 *
 * Admin-only. The estimator is consumed internally by the analytics
 * service when it computes /admin/analytics/dispatch-stats; we don't
 * expose a separate estimate endpoint because the only consumer today
 * is that card.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../guards/auth.guard';
import { Roles, RolesGuard } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { DispatchTariffService } from '../../../adapters/admin/dispatch-tariff.service';

@Controller('admin/dispatch-tariffs')
@UseGuards(AuthGuard, RolesGuard)
export class DispatchTariffsController {
  constructor(private readonly svc: DispatchTariffService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async list() {
    const data = await this.svc.list();
    return { success: true, data };
  }

  @Post()
  @Roles(UserRole.ADMIN)
  async create(
    @Body() body: { carrier?: string; zone?: string; costPerPackage?: number; currency?: string; notes?: string; active?: boolean },
    @Request() req: any,
  ) {
    try {
      const data = await this.svc.create(
        {
          carrier: String(body?.carrier ?? ''),
          zone: String(body?.zone ?? ''),
          costPerPackage: Number(body?.costPerPackage ?? NaN),
          currency: body?.currency,
          notes: body?.notes ?? null,
          active: body?.active,
        },
        req?.user?.id ?? null,
      );
      return { success: true, data };
    } catch (err: any) {
      throw new BadRequestException(err?.message || 'no se pudo crear la tarifa');
    }
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  async update(
    @Param('id') id: string,
    @Body() body: { carrier?: string; zone?: string; costPerPackage?: number; currency?: string; notes?: string | null; active?: boolean },
  ) {
    try {
      const data = await this.svc.update(id, body as any);
      if (!data) throw new NotFoundException('Tarifa no encontrada');
      return { success: true, data };
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      throw new BadRequestException(err?.message || 'no se pudo actualizar la tarifa');
    }
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async remove(@Param('id') id: string) {
    const ok = await this.svc.remove(id);
    if (!ok) throw new NotFoundException('Tarifa no encontrada');
    return { success: true };
  }
}
