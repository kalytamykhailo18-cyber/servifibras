/**
 * ADAPTERS LAYER — Quick-reply library (chips reusables).
 *
 * Marcos 2026-06-18: rewrite del módulo legacy (shortcut/title/content)
 * para alinear con la librería global tipo ML backoffice (HAY STOCK,
 * ENVIOS, MASILLA 10 MIN). Los chips ahora:
 *   - se insertan al cursor en la caja de respuesta del operador
 *     (panel ML QA + DM de conversaciones), y
 *   - alimentan el system prompt de Claude cuando feedAi=true, así la
 *     IA copia las formulaciones aprobadas por el equipo en vez de
 *     inventar cada respuesta de cero.
 *
 * Las labels se normalizan a mayúsculas (es el lenguaje visual que
 * Marcos usa hoy en el panel de ML — chip "HAY STOCK", "ENVIOS"); la
 * unicidad por label evita duplicados ambiguos en el dropdown.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient, QuickReply } from '@prisma/client';

import { PrismaService } from '../repositories/prisma.service';
export interface QuickReplyInput {
  label: string;
  body: string;
  category?: string | null;
  active?: boolean;
  feedAi?: boolean;
  sortOrder?: number;
}

@Injectable()
export class QuickReplyService {
  private readonly logger = new Logger(QuickReplyService.name);
  private readonly prisma: PrismaClient;

  constructor(
    @Optional() prismaShared?: PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  /** Lista completa (incluye inactivas) — para el panel admin. */
  async list(opts?: { activeOnly?: boolean }): Promise<QuickReply[]> {
    return this.prisma.quickReply.findMany({
      where: opts?.activeOnly ? { active: true } : undefined,
      orderBy: [
        { active: 'desc' },
        { sortOrder: 'asc' },
        { hitCount: 'desc' },
        { label: 'asc' },
      ],
    });
  }

  async getById(id: string): Promise<QuickReply | null> {
    return this.prisma.quickReply.findUnique({ where: { id } });
  }

  /**
   * Subset que se inyecta al system prompt de Claude. Solo activas y
   * marcadas para alimentar a la IA, ordenadas como los chips para que
   * el bloque del prompt respete la jerarquía visual del operador.
   */
  async listForAi(): Promise<Array<Pick<QuickReply, 'label' | 'body'>>> {
    return this.prisma.quickReply.findMany({
      where: { active: true, feedAi: true },
      orderBy: [{ sortOrder: 'asc' }, { hitCount: 'desc' }, { label: 'asc' }],
      select: { label: true, body: true },
    });
  }

  async create(input: QuickReplyInput, createdById: string | null): Promise<QuickReply> {
    const label = input.label?.trim();
    const body = input.body?.trim();
    if (!label) throw new Error('label requerido');
    if (!body) throw new Error('body requerido');
    try {
      return await this.prisma.quickReply.create({
        data: {
          label: label.toUpperCase(),
          body,
          category: input.category?.trim() || null,
          active: input.active ?? true,
          feedAi: input.feedAi ?? true,
          sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 0,
          createdById,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new Error(`Ya existe una respuesta rápida con la etiqueta "${label.toUpperCase()}"`);
      }
      throw err;
    }
  }

  async update(id: string, patch: Partial<QuickReplyInput>): Promise<QuickReply | null> {
    const data: any = {};
    if (patch.label !== undefined) {
      const v = patch.label.trim();
      if (!v) throw new Error('label requerido');
      data.label = v.toUpperCase();
    }
    if (patch.body !== undefined) {
      const v = patch.body.trim();
      if (!v) throw new Error('body requerido');
      data.body = v;
    }
    if (patch.category !== undefined) data.category = patch.category?.trim() || null;
    if (patch.active !== undefined) data.active = patch.active;
    if (patch.feedAi !== undefined) data.feedAi = patch.feedAi;
    if (patch.sortOrder !== undefined) data.sortOrder = Number(patch.sortOrder);
    try {
      return await this.prisma.quickReply.update({ where: { id }, data });
    } catch (err: any) {
      if (err?.code === 'P2002') throw new Error('La etiqueta ya está en uso');
      if (err?.code === 'P2025') return null;
      throw err;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.quickReply.delete({ where: { id } });
      return true;
    } catch (err: any) {
      if (err?.code === 'P2025') return false;
      throw err;
    }
  }

  /**
   * Bump usage counter cuando el operador insertó este chip en una
   * respuesta que efectivamente envió. Fire-and-forget — un fallo acá
   * NUNCA debe abortar el envío del mensaje al cliente.
   */
  async markUsed(id: string): Promise<void> {
    try {
      await this.prisma.quickReply.update({
        where: { id },
        data: { hitCount: { increment: 1 }, lastUsedAt: new Date() },
      });
    } catch (err: any) {
      this.logger.warn(`quick-reply markUsed failed for ${id} (non-fatal): ${err.message}`);
    }
  }
}
