/**
 * INFRASTRUCTURE LAYER — Admin Postal-Code → Zone mapping controller.
 *
 * Marcos 2026-06-20: el operador admin carga un Excel/CSV con
 * (cp, zona, localidad?, provincia?) y el panel de despachos puede
 * derivar la zona del courier mirando el CP cuando el label de TN
 * no la trae embebida. Mismo workflow que warehouse-locations.
 *
 * RBAC:
 *   - GET /        — ADMIN+LOGISTICA (revisión del mapping)
 *   - POST /upload — ADMIN (mutación)
 *   - DELETE /     — ADMIN (clear total)
 */

import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Logger,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { PostalCodeZoneService } from '../../../adapters/admin/postal-code-zone.service';

@Controller('admin/postal-code-zones')
@UseGuards(AuthGuard, RolesGuard)
export class PostalCodeZonesController {
  private readonly logger = new Logger(PostalCodeZonesController.name);

  constructor(private readonly svc: PostalCodeZoneService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async list(@Query('activeOnly') activeOnly?: string, @Query('limit') limit?: string) {
    const rows = await this.svc.list({
      activeOnly: activeOnly === 'true',
      limit: limit ? Number(limit) : undefined,
    });
    return { success: true, data: rows };
  }

  /**
   * Marcos 2026-06-22: count por zona — sirve para que el admin
   * panel muestre 'GBA1: 43 · GBA2: 66 · GBA3: 24 · CABA-range: 500'
   * despues del upload sin tener que listar las 600+ filas.
   */
  @Get('stats')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async stats() {
    const s = await this.svc.stats();
    return { success: true, data: s };
  }

  /**
   * Marcos 2026-06-22: resolver expuesto via API — util para probar
   * que tal localidad/CP devuelve la zona esperada antes de
   * configurar tarifas. Tambien util como debug endpoint cuando un
   * pedido cobra mal y queres saber por que.
   */
  @Get('resolve')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async resolve(@Query('locality') locality?: string, @Query('cp') cp?: string) {
    const r = await this.svc.resolveZoneAsync({
      locality: locality?.trim() || null,
      cp: cp?.trim() || null,
    });
    return { success: true, data: r };
  }

  @Post('upload')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: any) {
    if (!file || !file.buffer) {
      throw new BadRequestException('file is required (multipart field "file")');
    }
    if (file.buffer.length > 5 * 1024 * 1024) {
      throw new BadRequestException('file exceeds 5 MB limit');
    }
    let parsed;
    try {
      parsed = this.svc.parseBuffer(file.buffer);
    } catch (err: any) {
      throw new BadRequestException(`parse failed: ${err?.message ?? err}`);
    }
    const result = await this.svc.applyMapping(parsed.rows, parsed.invalid);
    return { success: true, data: result };
  }

  @Delete()
  @Roles(UserRole.ADMIN)
  async clear() {
    const removed = await this.svc.deleteAll();
    return { success: true, data: { removed } };
  }
}
