/**
 * INFRASTRUCTURE LAYER — Placas PRFV controller.
 *
 * Routes for Bloque C — Marcos 2026-06-06. ADMIN can do everything;
 * LOGISTICA can list, create, advance state, set state (revert typo)
 * and edit notes — they're the ones working the table daily. The
 * destructive `DELETE` is ADMIN-only since once a placa's lifecycle
 * is gone, the audit trail for that despacho is gone too.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { PrfvPlacaState } from '@prisma/client';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { PrfvPlacaService } from '../../../adapters/admin/prfv-placa.service';

const VALID_STATES = new Set<PrfvPlacaState>([
  PrfvPlacaState.PENDIENTE,
  PrfvPlacaState.LISTA_CORTADA,
  PrfvPlacaState.DESPACHADA_RETIRADA,
]);

@Controller('admin/prfv-placas')
@UseGuards(AuthGuard, RolesGuard)
export class PrfvPlacaController {
  private readonly logger = new Logger(PrfvPlacaController.name);

  constructor(private readonly svc: PrfvPlacaService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async list(
    @Query('state') state?: string,
    @Query('search') search?: string,
  ) {
    let stateFilter: PrfvPlacaState | undefined;
    if (state) {
      if (!VALID_STATES.has(state as PrfvPlacaState)) {
        throw new BadRequestException(`invalid state: ${state}`);
      }
      stateFilter = state as PrfvPlacaState;
    }
    const rows = await this.svc.list({ state: stateFilter, search });
    return { success: true, data: rows };
  }

  @Get('counts')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async counts() {
    const counts = await this.svc.countsByState();
    return { success: true, data: counts };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async getById(@Param('id') id: string) {
    const row = await this.svc.getById(id);
    if (!row) throw new NotFoundException('placa not found');
    return { success: true, data: row };
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async create(@Body() body: any, @Request() req: any) {
    try {
      const row = await this.svc.create({
        cliente: String(body?.cliente ?? ''),
        producto: String(body?.producto ?? ''),
        state: body?.state && VALID_STATES.has(body.state) ? body.state : undefined,
        notes: body?.notes ?? null,
      });
      this.logger.log(`PRFV placa ${row.id.slice(0, 8)} created by ${req.user?.email ?? 'unknown'}`);
      return { success: true, data: row };
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    if (body?.state && !VALID_STATES.has(body.state)) {
      throw new BadRequestException(`invalid state: ${body.state}`);
    }
    const row = await this.svc.update(id, body);
    if (!row) throw new NotFoundException('placa not found');
    this.logger.log(`PRFV placa ${id.slice(0, 8)} updated by ${req.user?.email ?? 'unknown'}`);
    return { success: true, data: row };
  }

  /**
   * Forward-only state advance. Convenient one-click for the operator's
   * panel — moves PENDIENTE → LISTA_CORTADA → DESPACHADA_RETIRADA. To
   * walk backwards (typo correction) use PUT `:id` with explicit state.
   */
  @Post(':id/advance')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async advance(@Param('id') id: string, @Request() req: any) {
    const row = await this.svc.advanceState(id);
    if (!row) {
      throw new BadRequestException('placa not found or already at terminal state');
    }
    this.logger.log(`PRFV placa ${id.slice(0, 8)} advanced by ${req.user?.email ?? 'unknown'} → ${row.state}`);
    return { success: true, data: row };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async remove(@Param('id') id: string, @Request() req: any) {
    const ok = await this.svc.delete(id);
    if (!ok) throw new NotFoundException('placa not found');
    this.logger.log(`PRFV placa ${id.slice(0, 8)} deleted by ${req.user?.email ?? 'unknown'}`);
    return { success: true };
  }
}
