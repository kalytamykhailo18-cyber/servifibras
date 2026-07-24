/**
 * Marcos 2026-07-24: CRUD para alias de mensajerías. El admin edita
 * el mapa raw → nombre canónico desde Settings sin toque de deploy.
 *
 *   GET    /admin/carrier-aliases       — list (active + archivadas)
 *   POST   /admin/carrier-aliases       — create
 *   PUT    /admin/carrier-aliases/:id   — update
 *   DELETE /admin/carrier-aliases/:id   — remove
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
import { CarrierAliasService } from '../../../adapters/admin/carrier-alias.service';

@Controller('admin/carrier-aliases')
@UseGuards(AuthGuard, RolesGuard)
export class CarrierAliasesController {
  constructor(private readonly svc: CarrierAliasService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async list() {
    const data = await this.svc.listAll();
    return { success: true, data };
  }

  @Post()
  @Roles(UserRole.ADMIN)
  async create(
    @Body() body: { rawPattern?: string; mappedName?: string; notes?: string; active?: boolean },
    @Request() req: any,
  ) {
    try {
      const data = await this.svc.create(
        {
          rawPattern: String(body?.rawPattern ?? ''),
          mappedName: String(body?.mappedName ?? ''),
          notes: body?.notes ?? null,
          active: body?.active,
        },
        req?.user?.id ?? null,
      );
      return { success: true, data };
    } catch (err: any) {
      throw new BadRequestException(err?.message || 'no se pudo crear el alias');
    }
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  async update(
    @Param('id') id: string,
    @Body() body: { rawPattern?: string; mappedName?: string; notes?: string | null; active?: boolean },
  ) {
    try {
      const data = await this.svc.update(id, body as any);
      if (!data) throw new NotFoundException('Alias no encontrado');
      return { success: true, data };
    } catch (err: any) {
      if (err instanceof NotFoundException) throw err;
      throw new BadRequestException(err?.message || 'no se pudo actualizar el alias');
    }
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async remove(@Param('id') id: string) {
    const ok = await this.svc.remove(id);
    if (!ok) throw new NotFoundException('Alias no encontrado');
    return { success: true };
  }
}
