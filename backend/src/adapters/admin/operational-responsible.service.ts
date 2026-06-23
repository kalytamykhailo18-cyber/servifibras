/**
 * Operational Responsibles CRUD. Marcos 2026-06-22.
 *
 * Catálogo de personas operativas (personal de depósito) elegibles
 * como responsables de un error de despacho. NO son usuarios del CRM
 * — la mayoría no tiene cuenta de la app — así que viven en su propia
 * tabla en lugar de filtrar la lista de Users.
 *
 * El picker del form de REPOSICIÓN lee de acá; los reportes de costo
 * por responsable en /analytics agrupan los shippingCost de las
 * reposiciones por Order.responsibleId.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export interface OperationalResponsibleInput {
  name: string;
  active?: boolean;
}

@Injectable()
export class OperationalResponsibleService {
  private readonly logger = new Logger(OperationalResponsibleService.name);
  private readonly prisma = new PrismaClient();

  /** Lista completa — el grid de ADMIN muestra activos y archivados. */
  async list() {
    return this.prisma.operationalResponsible.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  /** Solo activos — usado por el picker del form de REPOSICIÓN. */
  async listActive() {
    return this.prisma.operationalResponsible.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  }

  async create(input: OperationalResponsibleInput) {
    const name = (input.name ?? '').trim();
    if (!name) throw new Error('name requerido');
    try {
      return await this.prisma.operationalResponsible.create({
        data: { name, active: input.active ?? true },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') throw new Error(`Ya existe un responsable con nombre "${name}"`);
      throw err;
    }
  }

  async update(id: string, patch: Partial<OperationalResponsibleInput>) {
    const data: any = {};
    if (patch.name !== undefined) {
      const v = patch.name.trim();
      if (!v) throw new Error('name requerido');
      data.name = v;
    }
    if (patch.active !== undefined) data.active = patch.active;
    try {
      return await this.prisma.operationalResponsible.update({ where: { id }, data });
    } catch (err: any) {
      if (err?.code === 'P2025') return null;
      if (err?.code === 'P2002') throw new Error(`Ya existe un responsable con nombre "${data.name}"`);
      throw err;
    }
  }

  /** Soft-delete via active=false — preserva los pedidos históricos. */
  async archive(id: string) {
    try {
      return await this.prisma.operationalResponsible.update({
        where: { id },
        data: { active: false },
      });
    } catch (err: any) {
      if (err?.code === 'P2025') return null;
      throw err;
    }
  }
}
