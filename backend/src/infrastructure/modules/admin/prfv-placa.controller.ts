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
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.ENCARGADO)
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
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.ENCARGADO)
  async counts() {
    const counts = await this.svc.countsByState();
    return { success: true, data: counts };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.ENCARGADO)
  async getById(@Param('id') id: string) {
    const row = await this.svc.getById(id);
    if (!row) throw new NotFoundException('placa not found');
    return { success: true, data: row };
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.ENCARGADO)
  async create(@Body() body: any, @Request() req: any) {
    try {
      const row = await this.svc.create({
        cliente: String(body?.cliente ?? ''),
        producto: String(body?.producto ?? ''),
        state: body?.state && VALID_STATES.has(body.state) ? body.state : undefined,
        notes: body?.notes ?? null,
        // Marcos 2026-06-18: stamp the operator for team analytics.
        createdById: req.user?.id ?? null,
      });
      this.logger.log(`PRFV placa ${row.id.slice(0, 8)} created by ${req.user?.email ?? 'unknown'}`);
      return { success: true, data: row };
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.ENCARGADO)
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
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.ENCARGADO)
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

  /**
   * Marcos 2026-06-30: PATCH sub-modo por placa (Retira Caseros /
   * Envio). Nullable — pasar body {"mode": null} lo resetea.
   * Body validation es liviana: solo aceptamos los 2 enum strings
   * o null; cualquier otro valor se rechaza con 400.
   */
  @Post(':id/dispatch-mode')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA, UserRole.ENCARGADO)
  async setDispatchMode(
    @Param('id') id: string,
    @Body() body: { mode?: string | null },
    @Request() req: any,
  ) {
    const raw = body?.mode ?? null;
    const mode: 'RETIRA_CASEROS' | 'ENVIO' | null =
      raw === 'RETIRA_CASEROS' || raw === 'ENVIO' ? raw : (raw === null || raw === '' ? null : ('__invalid__' as any));
    if (mode === ('__invalid__' as any)) {
      throw new BadRequestException("mode must be 'RETIRA_CASEROS', 'ENVIO', or null");
    }
    const row = await this.svc.setDispatchMode(id, mode);
    if (!row) throw new NotFoundException('placa not found');
    this.logger.log(`PRFV placa ${id.slice(0, 8)} dispatchMode set by ${req.user?.email ?? 'unknown'} → ${mode ?? 'null'}`);
    return { success: true, data: row };
  }
}
