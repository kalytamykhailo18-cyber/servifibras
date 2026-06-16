/**
 * ADAPTERS LAYER — Per-publication FAQ cache for MercadoLibre.
 *
 * Bloque E item 3 — Marcos 2026-06-06 cost optimisation: recurring
 * questions on the same publication ("¿es para piscina?",
 * "¿sirve para alimentos?", "¿se cura con UV?") get an operator-
 * curated canned answer. The ML inbound handler looks up this table
 * BEFORE calling Claude; a match = zero Claude tokens for that turn.
 *
 * Match strategy: each FAQ carries a small list of keyword tokens
 * (lowercased, accents stripped). The customer's inbound text is
 * normalised the same way; the FAQ fires when ALL of its keywords
 * appear as substrings. Simple to reason about, easy for operators
 * to author from the ML QA panel.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PublicationFaq, PrismaClient } from '@prisma/client';

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function normaliseToken(s: string): string {
  return stripAccents(s.toLowerCase()).trim();
}

/**
 * Pull a clean list of keyword tokens out of a raw operator input.
 * Splits on whitespace + punctuation, drops empties, dedupes, caps
 * at 8 tokens (a longer keyword set is almost always over-specific).
 */
function parseKeywords(raw: string | string[] | null | undefined): string[] {
  if (!raw) return [];
  const tokens = Array.isArray(raw)
    ? raw.flatMap((t) => String(t).split(/[\s,;]+/))
    : String(raw).split(/[\s,;]+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const n = normaliseToken(t);
    if (n.length < 2) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= 8) break;
  }
  return out;
}

export interface PublicationFaqInput {
  itemId: string;
  keywords: string[] | string;
  answer: string;
  active?: boolean;
}

@Injectable()
export class PublicationFaqService {
  private readonly logger = new Logger(PublicationFaqService.name);
  private readonly prisma = new PrismaClient();

  async list(opts?: { itemId?: string; activeOnly?: boolean }): Promise<PublicationFaq[]> {
    const where: any = {};
    if (opts?.itemId) where.itemId = opts.itemId;
    if (opts?.activeOnly) where.active = true;
    return this.prisma.publicationFaq.findMany({
      where,
      orderBy: [{ hitCount: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getById(id: string): Promise<PublicationFaq | null> {
    return this.prisma.publicationFaq.findUnique({ where: { id } });
  }

  async create(input: PublicationFaqInput, createdById: string | null): Promise<PublicationFaq> {
    const itemId = input.itemId?.trim();
    if (!itemId) throw new Error('itemId is required');
    const keywords = parseKeywords(input.keywords);
    if (keywords.length === 0) throw new Error('al menos una palabra clave es obligatoria');
    const answer = input.answer?.trim();
    if (!answer) throw new Error('answer is required');
    const row = await this.prisma.publicationFaq.create({
      data: {
        itemId,
        keywords,
        answer,
        active: input.active !== false,
        createdById,
      },
    });
    this.logger.log(
      `Publication FAQ created: ${row.id.slice(0, 8)} item=${itemId} keywords=[${keywords.join(',')}]`,
    );
    return row;
  }

  async update(id: string, input: Partial<PublicationFaqInput>): Promise<PublicationFaq | null> {
    const data: any = {};
    if (input.itemId != null) data.itemId = input.itemId.trim();
    if (input.keywords != null) {
      const kw = parseKeywords(input.keywords);
      if (kw.length === 0) throw new Error('al menos una palabra clave es obligatoria');
      data.keywords = kw;
    }
    if (input.answer != null) data.answer = input.answer.trim();
    if (input.active != null) data.active = input.active;
    try {
      return await this.prisma.publicationFaq.update({ where: { id }, data });
    } catch (err: any) {
      if (err?.code === 'P2025') return null;
      throw err;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.publicationFaq.delete({ where: { id } });
      return true;
    } catch (err: any) {
      if (err?.code === 'P2025') return false;
      throw err;
    }
  }

  /**
   * The hot path called by the ML inbound handler. Given a published
   * item id and the inbound question text, return the first active
   * FAQ whose keywords ALL appear in the (normalised) question — or
   * null if no match. Caller is responsible for posting the answer
   * AND calling `recordHit(faq.id)` so the dashboard shows usage.
   */
  async findMatch(itemId: string, questionText: string): Promise<PublicationFaq | null> {
    if (!itemId || !questionText) return null;
    const haystack = normaliseToken(questionText);
    if (haystack.length === 0) return null;
    try {
      const candidates = await this.prisma.publicationFaq.findMany({
        where: { itemId, active: true },
        orderBy: { hitCount: 'desc' },
      });
      for (const c of candidates) {
        if (c.keywords.length === 0) continue;
        const allHit = c.keywords.every((k: string) => haystack.includes(normaliseToken(k)));
        if (allHit) return c;
      }
      return null;
    } catch (err: any) {
      this.logger.warn(`publication-faq match failed for ${itemId}: ${err.message}`);
      return null;
    }
  }

  async recordHit(id: string): Promise<void> {
    try {
      await this.prisma.publicationFaq.update({
        where: { id },
        data: { hitCount: { increment: 1 }, lastHitAt: new Date() },
      });
    } catch (err: any) {
      this.logger.warn(`publication-faq recordHit failed for ${id}: ${err.message}`);
    }
  }

  /**
   * Helper for the "Crear FAQ desde Q&A" button on the panel — given
   * a customer question text, suggest a starting keyword set so the
   * operator doesn't have to type from scratch. Picks tokens of
   * length ≥4 that aren't in a tiny Spanish stopword list. Cosmetic;
   * the operator can edit before saving.
   */
  suggestKeywordsFromText(text: string): string[] {
    const STOP = new Set([
      'para',
      'esta',
      'este',
      'estos',
      'estas',
      'tiene',
      'tienen',
      'tengo',
      'puedo',
      'sirve',
      'sirven',
      'donde',
      'cuanto',
      'cuanta',
      'cuantos',
      'cuantas',
      'tambien',
      'porque',
      'desde',
      'hasta',
      'pero',
      'cuando',
      'siempre',
      'nunca',
      'cualquier',
      'consulta',
      'gracias',
    ]);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of text.split(/[\s,;.!?¿¡]+/)) {
      const t = normaliseToken(raw);
      if (t.length < 4) continue;
      if (STOP.has(t)) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= 5) break;
    }
    return out;
  }
}
