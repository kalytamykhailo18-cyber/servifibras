/**
 * INFRASTRUCTURE LAYER — Reactivation manual-trigger controller.
 *
 * Same pipeline the nightly cron drives, exposed as a button so Marcos
 * can decide "run it now" without waiting for 04:00 UTC. ADMIN-only — the
 * action mass-flips funnel stages and may send a campaign, way too
 * blast-radius-y for any other role.
 */

import { Controller, Logger, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { ContactReactivationService } from '../../../adapters/admin/contact-reactivation.service';

@Controller('admin/reactivation')
@UseGuards(AuthGuard, RolesGuard)
export class ReactivationController {
  private readonly logger = new Logger(ReactivationController.name);

  constructor(private readonly svc: ContactReactivationService) {}

  @Post('run')
  @Roles(UserRole.ADMIN)
  async run(@Request() req: any) {
    this.logger.log(`Manual reactivation triggered by ${req.user.email}`);
    const result = await this.svc.runDueReactivations();
    return { success: true, data: result };
  }
}
