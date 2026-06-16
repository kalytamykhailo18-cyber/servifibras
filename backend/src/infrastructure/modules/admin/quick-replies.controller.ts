/**
 * INFRASTRUCTURE LAYER — Admin Quick-Replies Controller.
 *
 * RBAC:
 *   - GET / GET/:id          — any operator role (composer needs to read)
 *   - POST /:id/mark-used    — any operator role (bump usage from picker)
 *   - POST / PUT / DELETE    — ADMIN only (template authoring)
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
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { QuickReplyService } from '../../../adapters/admin/quick-reply.service';

@Controller('admin/quick-replies')
@UseGuards(AuthGuard, RolesGuard)
export class QuickRepliesController {
  private readonly logger = new Logger(QuickRepliesController.name);

  constructor(private readonly svc: QuickReplyService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async list(@Query('activeOnly') activeOnly?: string) {
    const items = await this.svc.list({ activeOnly: activeOnly === 'true' });
    return { success: true, data: items };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getOne(@Param('id') id: string) {
    const item = await this.svc.getById(id);
    if (!item) return { success: false, error: 'not found' };
    return { success: true, data: item };
  }

  @Post()
  @Roles(UserRole.ADMIN)
  async create(@Body() body: any, @Request() req: any) {
    try {
      const created = await this.svc.create(body, req.user.id);
      return { success: true, data: created };
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  async update(@Param('id') id: string, @Body() body: any) {
    try {
      const updated = await this.svc.update(id, body);
      if (!updated) return { success: false, error: 'not found' };
      return { success: true, data: updated };
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async remove(@Param('id') id: string) {
    const ok = await this.svc.delete(id);
    return { success: ok };
  }

  @Post(':id/mark-used')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async markUsed(@Param('id') id: string) {
    await this.svc.markUsed(id);
    return { success: true };
  }
}
