/**
 * INFRASTRUCTURE LAYER — Admin Audit-Log Viewer.
 *
 * ADMIN-only. Exposes the append-only access_logs table so Marcos can
 * answer "who changed this" / "did anyone log in from X" without dropping
 * to SQL.
 */

import {
  Controller,
  Get,
  Logger,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { AuditLogService } from '../../../adapters/audit/audit-log.service';

@Controller('admin/audit')
@UseGuards(AuthGuard, RolesGuard)
export class AuditController {
  private readonly logger = new Logger(AuditController.name);

  constructor(private readonly svc: AuditLogService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  async list(
    @Query('actionPrefix') actionPrefix?: string,
    @Query('userId') userId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
  ) {
    const items = await this.svc.list({
      actionPrefix: actionPrefix && actionPrefix.length > 0 ? actionPrefix : undefined,
      userId:       userId       && userId.length > 0       ? userId       : undefined,
      since:        since        ? new Date(since)         : undefined,
      until:        until        ? new Date(until)         : undefined,
      limit:        limit        ? Number(limit)           : undefined,
    });
    return { success: true, data: items };
  }

  /**
   * GET /admin/audit/actions — distinct action codes seen recently. Used
   * by the UI filter dropdown.
   */
  @Get('actions')
  @Roles(UserRole.ADMIN)
  async actions(@Query('daysBack') daysBack?: string) {
    const items = await this.svc.listActions(daysBack ? Number(daysBack) : 30);
    return { success: true, data: items };
  }
}
