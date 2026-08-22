/**
 * ADAPTERS LAYER — Daily digest for Marcos.
 *
 * Generates a single Spanish-language summary of yesterday's activity:
 * conversations + new leads + closed leads + new orders + Claude spend +
 * any errors flagged by the system. Sent via WhatsApp by default once
 * Marcos's number is set; falls back to a no-op when the dispatcher is
 * unconfigured (so this also works pre-Meta-credentials).
 *
 * The digest is short on purpose. Marcos reads on his phone, and a long
 * report nobody opens is worse than a tight one he glances at.
 *
 * Tunable in `.env`:
 *   DAILY_DIGEST_ENABLED        — kill switch (default 'true')
 *   DAILY_DIGEST_CRON_HOUR      — UTC hour for the daily run (default 11
 *                                 = 08:00 in Buenos Aires, just before the
 *                                 office opens).
 *   DAILY_DIGEST_RECIPIENT_PHONE — WhatsApp number to send to. Blank → no-op.
 *   DAILY_DIGEST_LOOKBACK_HOURS — window (default 24).
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { CampaignDeliveryStatus, OrderStatus, PrismaClient } from '@prisma/client';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WhatsAppOutgoingMessage } from '../../domain/entities/whatsapp-message.entity';
import { ClaudeBudgetService } from '../ai/claude-budget.service';

import { PrismaService } from '../repositories/prisma.service';
function envStr(key: string, fallback: string): string {
  const v = process.env[key];
  return v != null && v.length > 0 ? v : fallback;
}
function envNum(key: string, fallback: number): number {
  const v = process.env[key];
  const n = v != null ? Number(v) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v == null || v.trim().length === 0) return fallback;
  return v.trim().toLowerCase() === 'true';
}

function fmtMoneyArs(n: number): string {
  return '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export interface DigestData {
  windowStart: Date;
  windowEnd: Date;
  conversationsTotal: number;
  conversationsNew: number;
  leadsCreated: number;
  leadsWon: number;
  leadsLost: number;
  ordersConfirmed: number;
  ordersDelivered: number;
  ordersTotalArs: number;
  campaignsSent: number;
  campaignsFailed: number;
  claudeSpentTodayUsd: number;
  claudeSpentMonthUsd: number;
  claudeBudgetCapUsd: number;
  topProductsByVolume: Array<{ name: string; quantity: number }>;
}

export interface DigestRunResult {
  enabled: boolean;
  reason?: string;
  delivered: boolean;
  recipient: string | null;
  text: string;
  data: DigestData;
}

@Injectable()
export class DailyDigestService {
  private readonly logger = new Logger(DailyDigestService.name);
  private readonly prisma: PrismaClient;

  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly budget: ClaudeBudgetService,
    @Optional() prismaShared?: PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  /**
   * Run once a day. Builds the digest data, formats the Spanish text,
   * dispatches via WhatsApp when configured. Returns the assembled
   * payload either way so the manual-trigger endpoint can preview the
   * text Marcos would have received.
   */
  async runDigest(): Promise<DigestRunResult> {
    if (!envBool('DAILY_DIGEST_ENABLED', true)) {
      const data = await this.buildData();
      const text = this.formatText(data);
      return { enabled: false, reason: 'DAILY_DIGEST_ENABLED=false',
               delivered: false, recipient: null, text, data };
    }

    const data = await this.buildData();
    const text = this.formatText(data);
    const recipient = envStr('DAILY_DIGEST_RECIPIENT_PHONE', '');

    if (!recipient) {
      this.logger.log('Digest built but no recipient configured — skipping send');
      return { enabled: true, reason: 'DAILY_DIGEST_RECIPIENT_PHONE blank',
               delivered: false, recipient: null, text, data };
    }

    try {
      const sendRes = await this.whatsapp.sendMessage(
        new WhatsAppOutgoingMessage(recipient, text),
      );
      if (!sendRes.success) {
        this.logger.warn(`Digest send failed: ${sendRes.error ?? 'unknown'}`);
        return { enabled: true, reason: sendRes.error ?? 'whatsapp send failed',
                 delivered: false, recipient, text, data };
      }
      this.logger.log(`Digest delivered to ${recipient}`);
      return { enabled: true, delivered: true, recipient, text, data };
    } catch (err: any) {
      this.logger.error(`Digest send errored: ${err.message}`);
      return { enabled: true, reason: err.message,
               delivered: false, recipient, text, data };
    }
  }

  private async buildData(): Promise<DigestData> {
    const lookbackMs = envNum('DAILY_DIGEST_LOOKBACK_HOURS', 24) * 60 * 60 * 1000;
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - lookbackMs);

    // Conversations
    const conversationsTotal = await this.prisma.conversation.count({
      where: { isSandbox: false, updatedAt: { gte: windowStart } },
    });
    const conversationsNew = await this.prisma.conversation.count({
      where: { isSandbox: false, createdAt: { gte: windowStart } },
    });

    // Leads — new + won + lost in window. Same forward-only semantics
    // as the funnel; the audit comes from updatedAt rather than the
    // (still-unindexed) status-change history.
    const leadsCreated = await this.prisma.lead.count({
      where: { createdAt: { gte: windowStart } },
    });
    const leadsWon = await this.prisma.lead.count({
      where: { status: 'WON' as any, updatedAt: { gte: windowStart } },
    });
    const leadsLost = await this.prisma.lead.count({
      where: { status: 'LOST' as any, updatedAt: { gte: windowStart } },
    });

    // Orders (CONFIRMED is "new" since OrderManagementService creates with this status)
    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: windowStart } },
      select: { amount: true, currency: true, status: true, products: true },
    });
    const ordersConfirmed = orders.filter((o) => o.status === OrderStatus.CONFIRMED).length;
    const ordersDelivered = await this.prisma.order.count({
      where: { status: OrderStatus.DELIVERED, deliveredAt: { gte: windowStart } },
    });
    const ordersTotalArs = orders
      .filter((o) => o.currency === 'ARS')
      .reduce((s, o) => s + (o.amount ?? 0), 0);

    // Top products from yesterday's orders
    const productCounts = new Map<string, number>();
    for (const o of orders) {
      const items = Array.isArray(o.products) ? (o.products as any[]) : [];
      for (const item of items) {
        const name = item?.name ?? item?.product ?? null;
        const qty = Number(item?.quantity ?? 0);
        if (typeof name === 'string' && name.length > 0 && Number.isFinite(qty) && qty > 0) {
          productCounts.set(name, (productCounts.get(name) ?? 0) + qty);
        }
      }
    }
    const topProductsByVolume = Array.from(productCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, quantity]) => ({ name, quantity }));

    // Campaigns shipped in window
    const campaigns = await this.prisma.marketingCampaign.findMany({
      where: { completedAt: { gte: windowStart } },
      select: { sentCount: true, failedCount: true },
    });
    const campaignsSent   = campaigns.reduce((s, c) => s + (c.sentCount ?? 0), 0);
    const campaignsFailed = campaigns.reduce((s, c) => s + (c.failedCount ?? 0), 0);

    // Claude spend
    const claudeStats = await this.budget.getStats();

    return {
      windowStart, windowEnd,
      conversationsTotal, conversationsNew,
      leadsCreated, leadsWon, leadsLost,
      ordersConfirmed, ordersDelivered, ordersTotalArs,
      campaignsSent, campaignsFailed,
      claudeSpentTodayUsd: claudeStats.todaySpentUsd,
      claudeSpentMonthUsd: claudeStats.monthSpentUsd,
      claudeBudgetCapUsd:  claudeStats.capUsd,
      topProductsByVolume,
    };
  }

  /** Compose the Spanish digest. Plain text, short paragraphs. */
  formatText(d: DigestData): string {
    const lines: string[] = [];
    lines.push('Resumen Servifibras — últimas 24 hs');
    lines.push('');

    lines.push(`Conversaciones: ${d.conversationsTotal} actualizadas, ${d.conversationsNew} nuevas.`);

    if (d.leadsCreated + d.leadsWon + d.leadsLost > 0) {
      const parts: string[] = [];
      if (d.leadsCreated > 0) parts.push(`${d.leadsCreated} nuevas`);
      if (d.leadsWon > 0)     parts.push(`${d.leadsWon} ganadas`);
      if (d.leadsLost > 0)    parts.push(`${d.leadsLost} perdidas`);
      lines.push(`Oportunidades: ${parts.join(', ')}.`);
    } else {
      lines.push('Oportunidades: sin movimiento.');
    }

    if (d.ordersConfirmed + d.ordersDelivered > 0) {
      const orderBits: string[] = [];
      if (d.ordersConfirmed > 0) orderBits.push(`${d.ordersConfirmed} confirmados`);
      if (d.ordersDelivered > 0) orderBits.push(`${d.ordersDelivered} entregados`);
      let orderLine = `Pedidos: ${orderBits.join(', ')}`;
      if (d.ordersTotalArs > 0) {
        orderLine += ` (${fmtMoneyArs(d.ordersTotalArs)} en ARS).`;
      } else {
        orderLine += '.';
      }
      lines.push(orderLine);
    } else {
      lines.push('Pedidos: sin nuevos.');
    }

    if (d.topProductsByVolume.length > 0) {
      const tops = d.topProductsByVolume.map((p) => `${p.name} x${p.quantity}`).join(', ');
      lines.push(`Productos más vendidos: ${tops}.`);
    }

    if (d.campaignsSent + d.campaignsFailed > 0) {
      lines.push(`Campañas: ${d.campaignsSent} enviadas, ${d.campaignsFailed} fallaron.`);
    }

    if (d.claudeSpentMonthUsd > 0 || d.claudeSpentTodayUsd > 0) {
      lines.push('');
      lines.push(`IA: hoy USD ${d.claudeSpentTodayUsd.toFixed(2)} · mes USD ${d.claudeSpentMonthUsd.toFixed(2)} de ${d.claudeBudgetCapUsd}.`);
    }

    return lines.join('\n');
  }
}
