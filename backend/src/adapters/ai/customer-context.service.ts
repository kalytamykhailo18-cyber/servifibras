/**
 * ADAPTERS LAYER — Customer context memory.
 *
 * Bloque E item 2 — Marcos 2026-06-06: "el agente tiene que saber
 * quién es el cliente, qué compró antes y qué tipo de cliente es
 * antes de procesar cualquier mensaje". This service produces a
 * compact text block (≤2KB) summarising the contact's identity, the
 * customer-type / funnel-stage classification, recent orders and
 * lead history. The block is injected as a cached system prompt
 * piece by ClaudeService.continueConversation when a contactId is
 * known for the turn, so the agent answers in that customer's
 * context without anyone re-explaining who they are mid-thread.
 *
 * Bound size: at most 2KB of text. The block trims order history
 * to the most recent 5 entries + caps lead history at 3. Larger
 * histories collapse into aggregate counters so the size stays
 * predictable across customer profiles.
 *
 * Cached on the Anthropic side via `cache_control: ephemeral` on
 * the system block in the reply path — same pattern the Lucas
 * prompt and the catalog block use.
 *
 * Tunable in `.env`:
 *   CUSTOMER_CONTEXT_ENABLED       — 'true' / 'false' (default 'true')
 *   CUSTOMER_CONTEXT_RECENT_ORDERS — orders to list (default 5)
 *   CUSTOMER_CONTEXT_MAX_BYTES     — hard cap on the block (default 2048)
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { PrismaService } from '../repositories/prisma.service';
const CUSTOMER_TYPE_LABEL_ES: Record<string, string> = {
  ARTESANO: 'artesano / hobbysta',
  EMPRENDEDOR: 'emprendedor (pequeño comercio)',
  MAYORISTA: 'mayorista',
  INDUSTRIAL: 'industrial / empresa',
  PRFV_LAMINADOS: 'taller PRFV / laminados',
  REPARACION: 'reparación / taller',
};

const FUNNEL_STAGE_LABEL_ES: Record<string, string> = {
  CONSULTA: 'consulta (sin cotizar todavía)',
  COTIZADO: 'cotizado',
  NO_CONCRETO: 'cotizado pero no cerró',
  COMPRADOR: 'comprador (al menos una compra)',
  FRECUENTE: 'cliente frecuente',
};

function fmtArs(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amount);
}

function relativeAge(date: Date): string {
  const ms = Date.now() - date.getTime();
  const days = Math.floor(ms / (24 * 3600 * 1000));
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months} mes${months === 1 ? '' : 'es'}`;
  const years = Math.floor(days / 365);
  return `hace ${years} año${years === 1 ? '' : 's'}`;
}

@Injectable()
export class CustomerContextService {
  private readonly logger = new Logger(CustomerContextService.name);
  private readonly prisma: PrismaClient;

  constructor(
    @Optional() prismaShared?: PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  private isEnabled(): boolean {
    const raw = process.env.CUSTOMER_CONTEXT_ENABLED;
    if (raw == null || raw.trim().length === 0) return true;
    return raw.trim().toLowerCase() === 'true';
  }

  /**
   * Build the customer-context block for a contactId. Returns null
   * when the feature is disabled, the contact doesn't exist, or the
   * profile is brand-new with zero history (no point injecting an
   * empty stub into every prompt). The agent prompt still has the
   * customer's nickname / channel context separately, so a null
   * here just means "no extra history to mention".
   */
  async buildBlock(contactId: string): Promise<string | null> {
    if (!this.isEnabled() || !contactId) return null;

    let contact;
    try {
      contact = await this.prisma.contact.findUnique({
        where: { id: contactId },
        select: {
          id: true,
          name: true,
          phone: true,
          type: true,
          customerType: true,
          funnelStage: true,
          channel: true,
          createdAt: true,
        },
      });
    } catch (err: any) {
      this.logger.warn(`customer-context lookup failed for ${contactId}: ${err.message}`);
      return null;
    }
    if (!contact) return null;

    const recentN = Math.max(1, Number(process.env.CUSTOMER_CONTEXT_RECENT_ORDERS) || 5);
    const [recentOrders, leads, totals] = await Promise.all([
      this.prisma.order.findMany({
        where: { contactId },
        orderBy: { createdAt: 'desc' },
        take: recentN,
        select: {
          orderNumber: true,
          amount: true,
          currency: true,
          status: true,
          products: true,
          createdAt: true,
        },
      }),
      this.prisma.lead.findMany({
        where: { contactId },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { status: true, estimatedValue: true, source: true, createdAt: true },
      }),
      this.prisma.order.aggregate({
        where: { contactId, status: { in: ['CONFIRMED', 'PROCESSING', 'DISPATCHED', 'DELIVERED'] as any } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    const totalOrders = totals._count._all ?? 0;
    const totalSpent = Number(totals._sum.amount ?? 0);
    const ageStr = relativeAge(contact.createdAt);

    // Bail early when there's literally nothing notable to inject:
    // brand-new contact, no orders, no leads, no classification.
    if (
      totalOrders === 0 &&
      leads.length === 0 &&
      contact.customerType == null &&
      contact.funnelStage == null
    ) {
      return null;
    }

    const lines: string[] = [];
    lines.push('▸ CONTEXTO DEL CLIENTE (lo que ya sabemos sobre quién te escribe)');
    lines.push('');
    lines.push(`Nombre: ${contact.name?.trim() || '(sin nombre cargado)'}`);
    if (contact.phone) lines.push(`Contacto: ${contact.phone}`);
    if (contact.channel) lines.push(`Canal habitual: ${contact.channel}`);
    if (contact.customerType) {
      lines.push(
        `Tipo de cliente: ${CUSTOMER_TYPE_LABEL_ES[contact.customerType] ?? contact.customerType}`,
      );
    } else {
      lines.push(`Tipo de cliente: ${contact.type ?? 'sin clasificar'} (legado)`);
    }
    if (contact.funnelStage) {
      lines.push(
        `Estado del embudo: ${FUNNEL_STAGE_LABEL_ES[contact.funnelStage] ?? contact.funnelStage}`,
      );
    }
    lines.push(`Cliente desde: ${ageStr}`);
    lines.push('');

    if (totalOrders > 0) {
      lines.push(
        `Historial de compras: ${totalOrders} pedido${totalOrders === 1 ? '' : 's'} confirmados — total ${fmtArs(totalSpent)}.`,
      );
      if (recentOrders.length > 0) {
        lines.push('Últimos pedidos:');
        for (const o of recentOrders) {
          const items = Array.isArray(o.products) ? o.products : [];
          const summary = items
            .slice(0, 3)
            .map((p: any) => {
              if (typeof p === 'string') return p.slice(0, 30);
              const name = p?.name || p?.title || p?.sku || 'item';
              const qty = Number(p?.quantity ?? p?.qty ?? 1) || 1;
              return qty > 1 ? `${qty}×${String(name).slice(0, 24)}` : String(name).slice(0, 30);
            })
            .join(' + ');
          const extra = items.length > 3 ? ` +${items.length - 3} más` : '';
          lines.push(
            `- ${relativeAge(o.createdAt)}: ${o.orderNumber} · ${fmtArs(o.amount)} · ${summary}${extra} (${o.status.toLowerCase()})`,
          );
        }
      }
      lines.push('');
    }

    if (leads.length > 0) {
      lines.push(`Oportunidades / cotizaciones recientes (${leads.length}):`);
      for (const l of leads) {
        const value = l.estimatedValue != null ? fmtArs(Number(l.estimatedValue)) : null;
        const valuePart = value ? ` · ${value}` : '';
        const sourcePart = l.source ? ` · origen ${l.source.toLowerCase()}` : '';
        lines.push(`- ${relativeAge(l.createdAt)}: ${l.status.toLowerCase()}${valuePart}${sourcePart}`);
      }
      lines.push('');
    }

    lines.push(
      'Usá este contexto para responder con el tono y el detalle que corresponde a este cliente — un mayorista frecuente espera precisión técnica y trato directo; un artesano nuevo, una explicación más guiada.',
    );

    const block = lines.join('\n');
    const maxBytes = Number(process.env.CUSTOMER_CONTEXT_MAX_BYTES) || 2048;
    if (Buffer.byteLength(block, 'utf8') > maxBytes) {
      // Soft trim — keep the header + the most recent order, drop
      // the rest. Predictability beats fidelity at the byte cap.
      const trimmed = block.slice(0, maxBytes - 40) + '\n…(historial recortado por largo)';
      this.logger.debug(`customer-context block trimmed to ${maxBytes} bytes for ${contactId.slice(0, 8)}`);
      return trimmed;
    }
    return block;
  }
}
