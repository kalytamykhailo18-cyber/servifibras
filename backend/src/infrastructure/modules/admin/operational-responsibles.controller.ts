/**
 * Admin endpoints para el catálogo de responsables operativos
 * (personal de depósito elegible como responsable de un error de
 * armado / despacho). Marcos 2026-06-22.
 *
 *   GET    /admin/operational-responsibles            — todos
 *   GET    /admin/operational-responsibles?active=1   — sólo activos (picker)
 *   POST   /admin/operational-responsibles            — crear
 *   PUT    /admin/operational-responsibles/:id        — renombrar / toggle active
 *   DELETE /admin/operational-responsibles/:id        — soft-delete (active=false)
 *
 * Listado abierto a ADMIN + LOGISTICA + VENTAS porque el picker del
 * form de pedidos lo usa. Mutaciones sólo ADMIN.
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
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../guards/auth.guard';
import { Roles, RolesGuard } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { OperationalResponsibleService } from '../../../adapters/admin/operational-responsible.service';

@Controller('admin/operational-responsibles')
@UseGuards(AuthGuard, RolesGuard)
export class OperationalResponsiblesController {
  constructor(private readonly svc: OperationalResponsibleService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.VENTAS)
  async list(@Query('active') active?: string) {
    const data = active === '1' || active === 'true'
      ? await this.svc.listActive()
      : await this.svc.list();
    return { success: true, data };
  }

  @Post()
  @Roles(UserRole.ADMIN)
  async create(@Body() body: { name?: string; active?: boolean }) {
    try {
      const data = await this.svc.create({ name: String(body?.name ?? ''), active: body?.active });
      return { success: true, data };
    } catch (err: any) {
      throw new BadRequestException(err?.message || 'no se pudo crear el responsable');
    }
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  async update(@Param('id') id: string, @Body() body: { name?: string; active?: boolean }) {
    try {
      const data = await this.svc.update(id, body);
      if (!data) throw new NotFoundException('Responsable no encontrado');
      return { success: true, data };
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      throw new BadRequestException(err?.message || 'no se pudo actualizar el responsable');
    }
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async remove(@Param('id') id: string) {
    const data = await this.svc.archive(id);
    if (!data) throw new NotFoundException('Responsable no encontrado');
    return { success: true, data };
  }
}
