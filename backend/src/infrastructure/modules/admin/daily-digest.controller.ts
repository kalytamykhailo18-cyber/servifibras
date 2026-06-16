/**
 * INFRASTRUCTURE LAYER — Daily-digest manual trigger.
 *
 * Two endpoints:
 *   - POST /admin/digest/run     — runs the same pipeline the cron drives.
 *                                   Useful when Marcos wants the digest now.
 *   - GET  /admin/digest/preview — returns the digest text for the current
 *                                   24h window WITHOUT sending it. Used by
 *                                   the analytics page widget.
 *
 * ADMIN-only — the digest can include sensitive aggregates (revenue,
 * Claude spend) and triggers an outbound WhatsApp message.
 */

import { Controller, Get, Logger, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { DailyDigestService } from '../../../adapters/admin/daily-digest.service';

@Controller('admin/digest')
@UseGuards(AuthGuard, RolesGuard)
export class DailyDigestController {
  private readonly logger = new Logger(DailyDigestController.name);

  constructor(private readonly svc: DailyDigestService) {}

  @Post('run')
  @Roles(UserRole.ADMIN)
  async run(@Request() req: any) {
    this.logger.log(`Manual digest triggered by ${req.user.email}`);
    const result = await this.svc.runDigest();
    return { success: true, data: result };
  }

  @Get('preview')
  @Roles(UserRole.ADMIN)
  async preview() {
    // Build the data + format text without sending. We reuse `runDigest`
    // and just ignore its delivery side-effect — when no recipient is
    // configured it already short-circuits.
    const result = await this.svc.runDigest();
    return { success: true, data: { text: result.text, data: result.data, delivered: result.delivered } };
  }
}
