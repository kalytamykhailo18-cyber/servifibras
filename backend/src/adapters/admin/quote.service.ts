/**
 * ADAPTERS LAYER — Quotes (presupuestos) service.
 *
 * Owns CRUD + numbering + PDF rendering. The "0001-00000324" format from
 * the reference presupuesto is reproduced via:
 *   - QUOTE_NUMBER_PREFIX (default "0001") — the branch / point-of-sale
 *     code, configurable in `.env`.
 *   - A per-row monotonic suffix sourced from a row count (good enough
 *     for v1; if Marcos ever wants gap-free numbering we'd swap to a
 *     Postgres SEQUENCE).
 *
 * Money math: `taxRate` defaults to 0.21 (IVA Argentina); items are
 * provided already with `unitPrice`+`total`, but we recompute `netAmount`,
 * `taxAmount` and `totalAmount` server-side so the UI can't ship
 * inconsistent figures.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  PrismaClient, Prisma, QuoteStatus,
} from '@prisma/client';
import { buildQuotePdf, QuoteItem, QuotePdfData } from './quote-pdf.builder';

import { PrismaService } from '../repositories/prisma.service';
export interface QuoteCreateInput {
  contactId?: string | null;
  leadId?: string | null;
  buyerName: string;
  buyerAddress?: string | null;
  buyerLocality?: string | null;
  buyerTaxId?: string | null;
  buyerTaxStatus?: string | null;
  paymentMethod?: string | null;
  paymentTerms?: string | null;
  deliveryTerm?: string | null;
  expirationDate?: string | Date | null;
  currency?: string;
  taxRate?: number;
  items: Array<{ quantity: number; description: string; unitPrice: number }>;
  notes?: string | null;
  createdBy?: string | null;
}

function envStr(key: string, fallback: string): string {
  const v = process.env[key];
  return v != null && v.length > 0 ? v : fallback;
}
function envNum(key: string, fallback: number): number {
  const v = process.env[key];
  const n = v != null ? Number(v) : fallback;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function defaultExpiration(issueDate: Date): Date {
  const days = envNum('QUOTE_DEFAULT_EXPIRATION_DAYS', 7);
  return new Date(issueDate.getTime() + days * 24 * 60 * 60 * 1000);
}

function defaultTaxRate(): number {
  const raw = process.env.QUOTE_DEFAULT_TAX_RATE;
  if (raw == null || raw === '') return 0.21;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0.21;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeTotals(
  items: Array<{ quantity: number; unitPrice: number }>,
  taxRate: number,
): { lineTotals: number[]; netAmount: number; taxAmount: number; totalAmount: number } {
  const lineTotals = items.map((i) => round2(i.quantity * i.unitPrice));
  const netAmount  = round2(lineTotals.reduce((s, n) => s + n, 0));
  const taxAmount  = round2(netAmount * taxRate);
  const totalAmount = round2(netAmount + taxAmount);
  return { lineTotals, netAmount, taxAmount, totalAmount };
}

@Injectable()
export class QuoteService {
  private readonly logger = new Logger(QuoteService.name);
  private readonly prisma: PrismaClient;

  constructor(
    @Optional() prismaShared?: PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  /**
   * Issue a new quote number in `PREFIX-NNNNNNNN` form. We base the
   * suffix on (existing rows + 1), pad to 8 digits. Concurrent inserts
   * are rare here (only Franco/Admin create quotes) so a row-count
   * approach is good enough; a unique-constraint failure would just
   * cause a retry on the caller side.
   */
  private async nextQuoteNumber(): Promise<string> {
    const prefix = envStr('QUOTE_NUMBER_PREFIX', '0001');
    const count = await this.prisma.quote.count();
    const suffix = String(count + 1).padStart(8, '0');
    return `${prefix}-${suffix}`;
  }

  async list(opts?: { contactId?: string; leadId?: string; status?: QuoteStatus }) {
    const where: Prisma.QuoteWhereInput = {};
    if (opts?.contactId) where.contactId = opts.contactId;
    if (opts?.leadId)    where.leadId = opts.leadId;
    if (opts?.status)    where.status = opts.status;
    return this.prisma.quote.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getById(id: string) {
    return this.prisma.quote.findUnique({ where: { id } });
  }

  async create(input: QuoteCreateInput) {
    if (!input.buyerName?.trim()) throw new Error('buyerName is required');
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new Error('at least one item is required');
    }
    for (const item of input.items) {
      if (!item.description?.trim()) throw new Error('item description is required');
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) throw new Error('item quantity must be > 0');
      if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) throw new Error('item unitPrice must be >= 0');
    }

    const taxRate = input.taxRate != null ? Number(input.taxRate) : defaultTaxRate();
    const { lineTotals, netAmount, taxAmount, totalAmount } = computeTotals(input.items, taxRate);

    const issueDate = new Date();
    const expirationDate = input.expirationDate
      ? new Date(input.expirationDate)
      : defaultExpiration(issueDate);

    const items: QuoteItem[] = input.items.map((it, idx) => ({
      quantity: it.quantity,
      description: it.description,
      unitPrice: round2(it.unitPrice),
      total: lineTotals[idx],
    }));

    const quoteNumber = await this.nextQuoteNumber();

    return this.prisma.quote.create({
      data: {
        quoteNumber,
        contactId: input.contactId ?? null,
        leadId: input.leadId ?? null,
        buyerName: input.buyerName.trim(),
        buyerAddress: input.buyerAddress ?? null,
        buyerLocality: input.buyerLocality ?? null,
        buyerTaxId: input.buyerTaxId ?? null,
        buyerTaxStatus: input.buyerTaxStatus ?? null,
        paymentMethod: input.paymentMethod ?? null,
        paymentTerms: input.paymentTerms ?? null,
        deliveryTerm: input.deliveryTerm ?? null,
        issueDate,
        expirationDate,
        currency: input.currency ?? 'ARS',
        items: items as any,
        netAmount,
        taxRate,
        taxAmount,
        totalAmount,
        notes: input.notes ?? null,
        status: QuoteStatus.DRAFT,
        createdBy: input.createdBy ?? null,
      },
    });
  }

  async setStatus(id: string, status: QuoteStatus) {
    try {
      return await this.prisma.quote.update({ where: { id }, data: { status } });
    } catch (err: any) {
      if (err?.code === 'P2025') return null;
      throw err;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.quote.delete({ where: { id } });
      return true;
    } catch (err: any) {
      if (err?.code === 'P2025') return false;
      throw err;
    }
  }

  /** Render the persisted quote as a PDF buffer. */
  async renderPdf(id: string): Promise<Buffer | null> {
    const q = await this.prisma.quote.findUnique({ where: { id } });
    if (!q) return null;
    const data: QuotePdfData = {
      quoteNumber: q.quoteNumber,
      issueDate: q.issueDate,
      expirationDate: q.expirationDate,
      buyerName: q.buyerName,
      buyerAddress: q.buyerAddress,
      buyerLocality: q.buyerLocality,
      buyerTaxId: q.buyerTaxId,
      buyerTaxStatus: q.buyerTaxStatus,
      paymentMethod: q.paymentMethod,
      paymentTerms: q.paymentTerms,
      deliveryTerm: q.deliveryTerm,
      currency: q.currency,
      items: (q.items as unknown as QuoteItem[]) ?? [],
      netAmount: q.netAmount,
      taxRate: q.taxRate,
      taxAmount: q.taxAmount,
      totalAmount: q.totalAmount,
      notes: q.notes,
    };
    return buildQuotePdf(data);
  }
}
