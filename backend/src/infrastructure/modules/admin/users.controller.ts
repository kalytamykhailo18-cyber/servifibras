/**
 * INFRASTRUCTURE LAYER — Admin Users Controller.
 *
 * GET /admin/users        — read endpoint open to all operator roles
 *                            (lead/conversation "assign to" selects need it).
 * POST/PUT/DELETE          — ADMIN-only. Adding or removing employees is
 *                            a load-bearing change.
 *
 * Self-protection: ADMIN cannot deactivate or hard-delete themselves.
 * Otherwise the last admin could lock the team out of the panel.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '../../../domain/entities/auth.entity';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import {
  UserConflictError,
  UserManagementService,
} from '../../../adapters/admin/user-management.service';
import { AuditLogService } from '../../../adapters/audit/audit-log.service';

@Controller('admin/users')
@UseGuards(AuthGuard, RolesGuard)
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly svc: UserManagementService,
    private readonly audit: AuditLogService,
  ) {}

  /** Helper — pull ip + UA off the request for audit-log entries. */
  private auditCtx(req: any): { ip: string | null; userAgent: string | null } {
    const ip = (req?.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req?.ip || null;
    const userAgent = (req?.headers?.['user-agent'] as string) || null;
    return { ip, userAgent };
  }

  @Get()
  @Roles(UserRole.ADMIN, UserRole.VENTAS, UserRole.ATENCION, UserRole.LOGISTICA)
  async list(@Query('activeOnly') activeOnly?: string) {
    const users = await this.svc.list({ activeOnly: activeOnly !== 'false' });
    return { success: true, data: users };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  async getOne(@Param('id') id: string) {
    const u = await this.svc.getById(id);
    if (!u) return { success: false, error: 'not found' };
    return { success: true, data: u };
  }

  @Post()
  @Roles(UserRole.ADMIN)
  async create(@Body() body: any, @Request() req: any) {
    try {
      const created = await this.svc.create(body);
      this.logger.log(`User ${created.email} created by ${req.user.email}`);
      const ctx = this.auditCtx(req);
      await this.audit.log({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'user.create',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { newUserId: created.id, email: created.email, role: created.role },
      });
      return { success: true, data: created };
    } catch (err: any) {
      if (err instanceof UserConflictError) {
        throw new BadRequestException(`${err.field} already in use`);
      }
      throw new BadRequestException(err.message);
    }
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  async update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    // Self-protection: admin can edit themselves but cannot flip their
    // own active=false (would lock them out instantly).
    if (id === req.user.id && body?.active === false) {
      throw new ForbiddenException('cannot deactivate your own account');
    }
    try {
      const updated = await this.svc.update(id, body);
      if (!updated) return { success: false, error: 'not found' };
      this.logger.log(`User ${updated.email} updated by ${req.user.email}`);
      const ctx = this.auditCtx(req);
      await this.audit.log({
        userId: req.user.id,
        userEmail: req.user.email,
        // Distinguish "active toggle" from a generic field update so the
        // audit trail makes sense at a glance.
        action: typeof body?.active === 'boolean' && Object.keys(body).length === 1
          ? (body.active ? 'user.reactivate' : 'user.deactivate')
          : 'user.update',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { targetUserId: id, fields: Object.keys(body || {}) },
      });
      return { success: true, data: updated };
    } catch (err: any) {
      if (err instanceof UserConflictError) {
        throw new BadRequestException(`${err.field} already in use`);
      }
      throw new BadRequestException(err.message);
    }
  }

  /**
   * Hard delete. Refuses if the user has any historical references —
   * Marcos should rely on `active=false` in normal flows so audit trails
   * stay intact.
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async remove(@Param('id') id: string, @Request() req: any) {
    if (id === req.user.id) {
      throw new ForbiddenException('cannot delete your own account');
    }
    const r = await this.svc.hardDelete(id);
    if (!r.ok) return { success: false, error: r.reason };
    this.logger.log(`User ${id} hard-deleted by ${req.user.email}`);
    const ctx = this.auditCtx(req);
    await this.audit.log({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'user.delete',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { targetUserId: id },
    });
    return { success: true };
  }
}
