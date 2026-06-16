/**
 * INFRASTRUCTURE LAYER — TiendaNube sync trigger.
 *
 * Same shape as the reactivation controller: a button that runs the
 * pipeline on demand, ADMIN-only. Useful when Marcos has just added or
 * edited products on the TiendaNube admin and wants to bring them across
 * without waiting for the daily cron.
 */

import {
  Controller, Logger, Post, Request, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { TiendaNubeSyncService } from '../../../adapters/admin/tiendanube-sync.service';
import { TiendaNubeOrdersSyncService } from '../../../adapters/admin/tiendanube-orders-sync.service';

@Controller('admin/tiendanube')
@UseGuards(AuthGuard, RolesGuard)
export class TiendaNubeSyncController {
  private readonly logger = new Logger(TiendaNubeSyncController.name);

  constructor(
    private readonly svc: TiendaNubeSyncService,
    private readonly orders: TiendaNubeOrdersSyncService,
  ) {}

  @Post('sync')
  @Roles(UserRole.ADMIN)
  async run(@Request() req: any) {
    this.logger.log(`TiendaNube manual sync triggered by ${req.user.email}`);
    const result = await this.svc.runSync();
    return { success: true, data: result };
  }

  /**
   * Bloque B item 3 — manual trigger for the TN orders sync.
   * Useful for the "sync ahora" button on the integrations panel
   * AND for the operator to pull a fresh batch right before
   * starting the daily packing run.
   */
  @Post('orders-sync')
  @Roles(UserRole.ADMIN)
  async runOrders(@Request() req: any) {
    this.logger.log(`TiendaNube orders sync triggered by ${req.user.email}`);
    const result = await this.orders.runSync();
    return { success: true, data: result };
  }
}
