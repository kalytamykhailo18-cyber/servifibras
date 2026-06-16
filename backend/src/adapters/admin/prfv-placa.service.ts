/**
 * ADAPTERS LAYER — Placas PRFV lifecycle.
 *
 * Marcos's brief 2026-06-06 (Bloque C — Logística): the three top
 * sections of his manual Excel ("PLACAS PRFV PENDIENTES",
 * "PLACAS PRFV LISTAS/CORTADAS", "PLACAS PRFV DESPACHADAS/RETIRADAS")
 * move into the CRM so the daily auto-Excel reflects state in real
 * time instead of someone retyping the section between days.
 *
 * `cliente` and `producto` are deliberately free-text to mirror the
 * way the warehouse already writes the rows ("Adrian Geuna NORTHTRAIL
 * - WSP" / "Lámina 2,2 x 16 (750)"). Forcing a structured product
 * picker would invalidate the operator's existing shorthand.
 *
 * State transitions go strictly forward: PENDIENTE → LISTA_CORTADA
 * → DESPACHADA_RETIRADA. Backwards transitions (operator typo) are
 * allowed via an explicit `force` flag on `setState`; the default
 * `advanceState` only walks forward to protect against accidental
 * misclicks on a busy panel.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrfvPlaca, PrfvPlacaState, PrismaClient } from '@prisma/client';

export interface PrfvPlacaInput {
  cliente: string;
  producto: string;
  state?: PrfvPlacaState;
  notes?: string | null;
}

export interface PrfvPlacaListFilter {
  state?: PrfvPlacaState;
  /** Free-text search across cliente / producto / notes. */
  search?: string;
}

const STATE_ORDER: PrfvPlacaState[] = [
  PrfvPlacaState.PENDIENTE,
  PrfvPlacaState.LISTA_CORTADA,
  PrfvPlacaState.DESPACHADA_RETIRADA,
];

function nextState(current: PrfvPlacaState): PrfvPlacaState | null {
  const idx = STATE_ORDER.indexOf(current);
  if (idx < 0 || idx >= STATE_ORDER.length - 1) return null;
  return STATE_ORDER[idx + 1];
}

@Injectable()
export class PrfvPlacaService {
  private readonly logger = new Logger(PrfvPlacaService.name);
  private readonly prisma = new PrismaClient();

  async list(filter: PrfvPlacaListFilter = {}): Promise<PrfvPlaca[]> {
    const where: any = {};
    if (filter.state) where.state = filter.state;
    if (filter.search && filter.search.trim().length > 0) {
      const q = filter.search.trim();
      where.OR = [
        { cliente: { contains: q, mode: 'insensitive' } },
        { producto: { contains: q, mode: 'insensitive' } },
        { notes: { contains: q, mode: 'insensitive' } },
      ];
    }
    // Group by state in the daily-Excel order, freshest movement first
    // inside each state.
    return this.prisma.prfvPlaca.findMany({
      where,
      orderBy: [{ state: 'asc' }, { stateChangedAt: 'desc' }],
    });
  }

  async getById(id: string): Promise<PrfvPlaca | null> {
    return this.prisma.prfvPlaca.findUnique({ where: { id } });
  }

  async create(input: PrfvPlacaInput): Promise<PrfvPlaca> {
    const cliente = input.cliente?.trim();
    const producto = input.producto?.trim();
    if (!cliente) throw new Error('cliente is required');
    if (!producto) throw new Error('producto is required');
    const row = await this.prisma.prfvPlaca.create({
      data: {
        cliente,
        producto,
        state: input.state ?? PrfvPlacaState.PENDIENTE,
        notes: input.notes?.trim() || null,
      },
    });
    this.logger.log(`PRFV placa ${row.id.slice(0, 8)} created (${row.state})`);
    return row;
  }

  async update(id: string, input: Partial<PrfvPlacaInput>): Promise<PrfvPlaca | null> {
    const data: any = {};
    if (input.cliente != null) data.cliente = input.cliente.trim();
    if (input.producto != null) data.producto = input.producto.trim();
    if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
    // A state change here also bumps stateChangedAt so the daily Excel
    // reflects the movement at the top of the section.
    if (input.state && input.state !== undefined) {
      data.state = input.state;
      data.stateChangedAt = new Date();
    }
    try {
      const row = await this.prisma.prfvPlaca.update({ where: { id }, data });
      return row;
    } catch (err: any) {
      if (err?.code === 'P2025') return null;
      throw err;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.prfvPlaca.delete({ where: { id } });
      return true;
    } catch (err: any) {
      if (err?.code === 'P2025') return false;
      throw err;
    }
  }

  /**
   * Advance the placa one step forward through the lifecycle. Returns
   * the updated row, or null if the placa doesn't exist or is already
   * at the terminal DESPACHADA_RETIRADA state.
   */
  async advanceState(id: string): Promise<PrfvPlaca | null> {
    const current = await this.prisma.prfvPlaca.findUnique({
      where: { id },
      select: { state: true },
    });
    if (!current) return null;
    const next = nextState(current.state);
    if (!next) {
      this.logger.warn(`PRFV placa ${id.slice(0, 8)} already at terminal state`);
      return null;
    }
    const row = await this.prisma.prfvPlaca.update({
      where: { id },
      data: { state: next, stateChangedAt: new Date() },
    });
    this.logger.log(`PRFV placa ${id.slice(0, 8)} advanced: ${current.state} → ${next}`);
    return row;
  }

  /**
   * Force a placa to an arbitrary state. Used when the operator
   * corrects a typo — typically moving DESPACHADA_RETIRADA back to
   * LISTA_CORTADA because the truck didn't actually load. UI labels
   * this "Revertir" to keep the destructive-style intent clear.
   */
  async setState(id: string, state: PrfvPlacaState): Promise<PrfvPlaca | null> {
    try {
      const row = await this.prisma.prfvPlaca.update({
        where: { id },
        data: { state, stateChangedAt: new Date() },
      });
      this.logger.log(`PRFV placa ${id.slice(0, 8)} state forced → ${state}`);
      return row;
    } catch (err: any) {
      if (err?.code === 'P2025') return null;
      throw err;
    }
  }

  /** Count by state — small helper for the page chips. */
  async countsByState(): Promise<Record<PrfvPlacaState, number>> {
    const rows = await this.prisma.prfvPlaca.groupBy({
      by: ['state'],
      _count: { _all: true },
    });
    const out: Record<PrfvPlacaState, number> = {
      PENDIENTE: 0,
      LISTA_CORTADA: 0,
      DESPACHADA_RETIRADA: 0,
    };
    for (const r of rows) out[r.state] = r._count._all;
    return out;
  }
}
