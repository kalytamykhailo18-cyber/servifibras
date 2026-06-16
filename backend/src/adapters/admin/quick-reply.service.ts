/**
 * ADAPTERS LAYER — Quick-reply templates.
 *
 * Operator-side canned responses triggered by typing "/" in the composer.
 * Marcos's targets: horarios de atención, dirección de retiro, datos
 * bancarios, etc. Plain CRUD on `quick_replies` plus a `markUsed` that
 * bumps `usageCount`.
 *
 * Shortcut normalization: lower-case, trimmed, spaces → dashes. Same rule
 * applied on create/update so the picker doesn't have to second-guess
 * what the operator typed after "/".
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

export interface QuickReplyInput {
  shortcut: string;
  title: string;
  content: string;
  category?: string | null;
  active?: boolean;
}

function normalizeShortcut(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_\-]/g, '');
}

@Injectable()
export class QuickReplyService {
  private readonly logger = new Logger(QuickReplyService.name);
  private readonly prisma = new PrismaClient();

  async list(opts?: { activeOnly?: boolean }) {
    return this.prisma.quickReply.findMany({
      where: opts?.activeOnly ? { active: true } : undefined,
      orderBy: [{ usageCount: 'desc' }, { shortcut: 'asc' }],
    });
  }

  async getById(id: string) {
    return this.prisma.quickReply.findUnique({ where: { id } });
  }

  async getByShortcut(shortcut: string) {
    const norm = normalizeShortcut(shortcut);
    if (!norm) return null;
    return this.prisma.quickReply.findUnique({ where: { shortcut: norm } });
  }

  async create(input: QuickReplyInput, createdBy: string | null) {
    const shortcut = normalizeShortcut(input.shortcut);
    if (!shortcut) throw new Error('shortcut is required');
    if (!input.title?.trim()) throw new Error('title is required');
    if (!input.content?.trim()) throw new Error('content is required');

    try {
      return await this.prisma.quickReply.create({
        data: {
          shortcut,
          title: input.title.trim(),
          content: input.content,
          category: input.category?.trim() || null,
          active: input.active !== false,
          createdBy,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new Error(`shortcut "${shortcut}" already exists`);
      }
      throw err;
    }
  }

  async update(id: string, input: Partial<QuickReplyInput>) {
    const data: Prisma.QuickReplyUpdateInput = {};
    if (input.shortcut != null) {
      const s = normalizeShortcut(input.shortcut);
      if (!s) throw new Error('shortcut cannot be empty');
      data.shortcut = s;
    }
    if (input.title != null)    data.title    = input.title.trim();
    if (input.content != null)  data.content  = input.content;
    if (input.category !== undefined) data.category = input.category?.trim() || null;
    if (input.active != null)   data.active   = input.active;

    try {
      return await this.prisma.quickReply.update({ where: { id }, data });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new Error(`shortcut already in use`);
      }
      if (err?.code === 'P2025') return null; // not found
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

  /** Increments usage counter — best-effort, never throws. */
  async markUsed(id: string): Promise<void> {
    try {
      await this.prisma.quickReply.update({
        where: { id },
        data: { usageCount: { increment: 1 } },
      });
    } catch (err: any) {
      this.logger.warn(`markUsed failed for ${id} (non-fatal): ${err.message}`);
    }
  }
}
