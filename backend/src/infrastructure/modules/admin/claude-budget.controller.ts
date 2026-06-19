/**
 * INFRASTRUCTURE LAYER — Admin Claude budget controller.
 *
 * Exposes the cost-tracking widget data + the lightweight "is the cap
 * about to bite" check. ADMIN-only because per-call-site spend leaks
 * indirect business signals (which detectors fire most, etc).
 */

import { Controller, Get, Logger, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { ClaudeBudgetService } from '../../../adapters/ai/claude-budget.service';

@Controller('admin/ai-budget')
@UseGuards(AuthGuard, RolesGuard)
export class ClaudeBudgetController {
  private readonly logger = new Logger(ClaudeBudgetController.name);

  constructor(private readonly budget: ClaudeBudgetService) {}

  @Get('stats')
  @Roles(UserRole.ADMIN)
  async stats() {
    return { success: true, data: await this.budget.getStats() };
  }

  /**
   * Marcos 2026-06-05 (dispute settlement): snapshot que compara la
   * ventana ANTES de las opts (Bloque E) contra la ventana actual,
   * para que el cliente pueda validar el bloque viendo el delta de
   * costo en plata real. ADMIN-only por el mismo motivo que /stats.
   */
  @Get('savings')
  @Roles(UserRole.ADMIN)
  async savings() {
    return { success: true, data: await this.budget.getSavingsSnapshot() };
  }
}
