/**
 * Marcos 2026-07-24: CRUD + caché del mapa de alias de mensajerías.
 *
 * El admin edita en Settings > Alias de mensajerías: cada fila es
 * `rawPattern → mappedName` (ej. "Servifibras" → "JyJ"). El service
 * mantiene el mapa en memoria y lo invalida sobre create/update/delete
 * para que no haya lag entre cambio y aplicación. Los callers
 * (normaliseCarrier via analytics + daily-logistica-aggregator) piden
 * el mapa fresco por request — costo despreciable porque son pocas
 * rows y todo vive en memoria.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { CarrierAliasMap } from './carrier-normalize.util';

export interface CarrierAliasInput {
  rawPattern: string;
  mappedName: string;
  notes?: string | null;
  active?: boolean;
}

@Injectable()
export class CarrierAliasService {
  private readonly logger = new Logger(CarrierAliasService.name);
  private readonly prisma = new PrismaClient();

  // Caché en memoria del mapa activo. Se recarga en cada write.
  private cachedMap: Map<string, string> | null = null;
  private cachedAt = 0;

  async listAll() {
    return this.prisma.carrierAlias.findMany({
      orderBy: [{ active: 'desc' }, { rawPattern: 'asc' }],
    });
  }

  async getMap(): Promise<CarrierAliasMap> {
    // Rebuild cache si nunca se cargó o hace más de 60 seg. Cada write
    // llama invalidate() explícitamente así el reload es inmediato.
    if (this.cachedMap && Date.now() - this.cachedAt < 60_000) {
      return this.cachedMap;
    }
    const rows = await this.prisma.carrierAlias.findMany({
      where: { active: true },
      select: { rawPattern: true, mappedName: true },
    });
    const m = new Map<string, string>();
    for (const r of rows) {
      const key = (r.rawPattern ?? '').trim().toLowerCase();
      const value = (r.mappedName ?? '').trim();
      if (key && value) m.set(key, value);
    }
    this.cachedMap = m;
    this.cachedAt = Date.now();
    return m;
  }

  private invalidate() {
    this.cachedMap = null;
    this.cachedAt = 0;
  }

  async create(input: CarrierAliasInput, createdById: string | null) {
    const raw = input.rawPattern.trim();
    const mapped = input.mappedName.trim();
    if (!raw) throw new Error('rawPattern requerido');
    if (!mapped) throw new Error('mappedName requerido');
    const row = await this.prisma.carrierAlias.create({
      data: {
        rawPattern: raw,
        mappedName: mapped,
        notes: input.notes ?? null,
        active: input.active ?? true,
        createdById,
      },
    });
    this.invalidate();
    this.logger.log(`Alias creado: "${raw}" → "${mapped}"`);
    return row;
  }

  async update(id: string, patch: Partial<CarrierAliasInput>) {
    const data: any = {};
    if (patch.rawPattern !== undefined) {
      const v = patch.rawPattern.trim();
      if (!v) throw new Error('rawPattern requerido');
      data.rawPattern = v;
    }
    if (patch.mappedName !== undefined) {
      const v = patch.mappedName.trim();
      if (!v) throw new Error('mappedName requerido');
      data.mappedName = v;
    }
    if (patch.notes !== undefined) data.notes = patch.notes;
    if (patch.active !== undefined) data.active = patch.active;
    try {
      const row = await this.prisma.carrierAlias.update({ where: { id }, data });
      this.invalidate();
      return row;
    } catch (err: any) {
      if (err?.code === 'P2025') return null;
      throw err;
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      await this.prisma.carrierAlias.delete({ where: { id } });
      this.invalidate();
      return true;
    } catch (err: any) {
      if (err?.code === 'P2025') return false;
      throw err;
    }
  }
}
