/**
 * ADAPTERS LAYER — Weekly leads report for Marcos.
 *
 * Marcos's brief: "Reporte semanal automático con leads recibidos /
 * escalados / cerrados / perdidos." Same delivery pattern as the daily
 * digest — short Spanish text, sent via WhatsApp on Monday morning, with
 * a manual-trigger endpoint for previewing.
 *
 * The report covers the trailing 7 days plus a week-over-week comparison
 * so Marcos can tell at a glance whether the funnel is widening or
 * shrinking. Per-channel breakdown (WhatsApp, IG, FB, ML, TN webchat) is
 * included because Marcos cares about which surface produces the leads.
 *
 * `.env` knobs:
 *   WEEKLY_LEADS_REPORT_ENABLED       — kill switch (default 'true')
 *   WEEKLY_LEADS_REPORT_CRON          — cron expression (default '0 11 * * 1'
 *                                       = Mondays 08:00 ART)
 *   WEEKLY_LEADS_REPORT_RECIPIENT_PHONE — WhatsApp number to send to. Blank → no-op.
 *   WEEKLY_LEADS_REPORT_LOOKBACK_DAYS  — window length (default 7).
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient, Channel, LeadStatus } from '@prisma/client';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WhatsAppOutgoingMessage } from '../../domain/entities/whatsapp-message.entity';

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

const CHANNEL_LABEL: Record<Channel, string> = {
  WHATSAPP: 'WhatsApp',
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
  MERCADOLIBRE: 'Mercado Libre',
  TIENDANUBE_WEBCHAT: 'Webchat TN',
};

export interface ChannelBreakdown {
  channel: Channel;
  label: string;
  count: number;
}

export interface TopMayorista {
  contactName: string | null;
  contactPhone: string | null;
  estimatedValue: number;
  status: LeadStatus;
}

export interface WeeklyLeadsData {
  windowStart: Date;
  windowEnd: Date;
  windowDays: number;
  // Current-window counts.
  totalCreated: number;
  byStatus: Record<LeadStatus, number>;
  byChannel: ChannelBreakdown[];
  topMayoristas: TopMayorista[];
  // Previous-window comparison — same length window, ending right where
  // the current one starts.
  prevTotalCreated: number;
  prevWon: number;
  prevLost: number;
  // Conversion rate (won / (won + lost)) over the current window —
  // expressed as a percentage already, 0–100.
  winRatePct: number | null;
}

export interface WeeklyLeadsRunResult {
  enabled: boolean;
  reason?: string;
  delivered: boolean;
  recipient: string | null;
  text: string;
  data: WeeklyLeadsData;
}

@Injectable()
export class WeeklyLeadsReportService {
  private readonly logger = new Logger(WeeklyLeadsReportService.name);
  private readonly prisma: PrismaClient;

  constructor(
    private readonly whatsapp: WhatsAppService,
    @Optional() prismaShared?: import('../repositories/prisma.service').PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  async run(): Promise<WeeklyLeadsRunResult> {
    if (!envBool('WEEKLY_LEADS_REPORT_ENABLED', true)) {
      const data = await this.buildData();
      const text = this.formatText(data);
      return {
        enabled: false,
        reason: 'WEEKLY_LEADS_REPORT_ENABLED=false',
        delivered: false,
        recipient: null,
        text,
        data,
      };
    }

    const data = await this.buildData();
    const text = this.formatText(data);
    const recipient = envStr('WEEKLY_LEADS_REPORT_RECIPIENT_PHONE', '');

    if (!recipient) {
      this.logger.log('Weekly report built but no recipient configured — skipping send');
      return {
        enabled: true,
        reason: 'WEEKLY_LEADS_REPORT_RECIPIENT_PHONE blank',
        delivered: false,
        recipient: null,
        text,
        data,
      };
    }

    try {
      const r = await this.whatsapp.sendMessage(new WhatsAppOutgoingMessage(recipient, text));
      if (!r.success) {
        this.logger.warn(`Weekly report send failed: ${r.error ?? 'unknown'}`);
        return {
          enabled: true,
          reason: r.error ?? 'whatsapp send failed',
          delivered: false,
          recipient,
          text,
          data,
        };
      }
      this.logger.log(`Weekly report delivered to ${recipient}`);
      return { enabled: true, delivered: true, recipient, text, data };
    } catch (err: any) {
      this.logger.error(`Weekly report send errored: ${err.message}`);
      return {
        enabled: true,
        reason: err.message,
        delivered: false,
        recipient,
        text,
        data,
      };
    }
  }

  private async buildData(): Promise<WeeklyLeadsData> {
    const days = envNum('WEEKLY_LEADS_REPORT_LOOKBACK_DAYS', 7);
    const windowMs = days * 24 * 60 * 60 * 1000;
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - windowMs);
    const prevStart = new Date(windowStart.getTime() - windowMs);

    // Created in window — base of "leads recibidos".
    const created = await this.prisma.lead.findMany({
      where: { createdAt: { gte: windowStart } },
      select: {
        id: true,
        status: true,
        source: true,
        estimatedValue: true,
        contact: { select: { name: true, phone: true, customerType: true, type: true } },
      },
    });
    const totalCreated = created.length;

    // Win/Lose transitions in window — taken from updatedAt as a proxy
    // for the status change. A lead created earlier and won this week
    // shows up here even if `created` doesn't include it.
    const wonInWindow = await this.prisma.lead.count({
      where: { status: LeadStatus.WON, updatedAt: { gte: windowStart } },
    });
    const lostInWindow = await this.prisma.lead.count({
      where: { status: LeadStatus.LOST, updatedAt: { gte: windowStart } },
    });

    // Status distribution of the leads created this window.
    const byStatus: Record<LeadStatus, number> = {
      NEW: 0, CONTACTED: 0, QUOTE_SENT: 0, NEGOTIATING: 0, WON: 0, LOST: 0,
    };
    for (const l of created) byStatus[l.status]++;
    // Override the WON / LOST buckets with the in-window transition counts
    // so "ganadas/perdidas esta semana" reflects activity, not the static
    // status of just-created rows.
    byStatus.WON = wonInWindow;
    byStatus.LOST = lostInWindow;

    // Per-channel breakdown of what was created in the window.
    const channelCounts = new Map<Channel, number>();
    for (const l of created) {
      channelCounts.set(l.source, (channelCounts.get(l.source) ?? 0) + 1);
    }
    const byChannel: ChannelBreakdown[] = Array.from(channelCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([channel, count]) => ({
        channel,
        label: CHANNEL_LABEL[channel] ?? String(channel),
        count,
      }));

    // Top 3 mayorista-tier leads by estimatedValue. Falls back to all
    // leads when no mayorista row qualifies, so the line never goes empty
    // on a quiet week.
    const wholesaleTier = new Set(['MAYORISTA', 'INDUSTRIAL', 'PRFV_LAMINADOS']);
    const mayoristaCandidates = created
      .filter((l) => {
        const ct = (l.contact?.customerType as string | null) ?? null;
        const legacy = l.contact?.type as string;
        return (ct && wholesaleTier.has(ct)) || (legacy && wholesaleTier.has(legacy));
      });
    const valueRanked = (mayoristaCandidates.length > 0 ? mayoristaCandidates : created)
      .filter((l) => l.estimatedValue != null && l.estimatedValue > 0)
      .sort((a, b) => (b.estimatedValue ?? 0) - (a.estimatedValue ?? 0))
      .slice(0, 3)
      .map((l) => ({
        contactName: l.contact?.name ?? null,
        contactPhone: l.contact?.phone ?? null,
        estimatedValue: l.estimatedValue ?? 0,
        status: l.status,
      }));

    // Previous-window totals.
    const prevTotalCreated = await this.prisma.lead.count({
      where: { createdAt: { gte: prevStart, lt: windowStart } },
    });
    const prevWon = await this.prisma.lead.count({
      where: { status: LeadStatus.WON, updatedAt: { gte: prevStart, lt: windowStart } },
    });
    const prevLost = await this.prisma.lead.count({
      where: { status: LeadStatus.LOST, updatedAt: { gte: prevStart, lt: windowStart } },
    });

    // Win rate — null when there are no resolved leads in the window so
    // the formatter can show an em-dash instead of pretending 0% is
    // meaningful.
    const resolved = wonInWindow + lostInWindow;
    const winRatePct = resolved > 0
      ? Math.round((wonInWindow / resolved) * 1000) / 10
      : null;

    return {
      windowStart,
      windowEnd,
      windowDays: days,
      totalCreated,
      byStatus,
      byChannel,
      topMayoristas: valueRanked,
      prevTotalCreated,
      prevWon,
      prevLost,
      winRatePct,
    };
  }

  /** Compose the Spanish report. Plain text, short paragraphs. */
  formatText(d: WeeklyLeadsData): string {
    const lines: string[] = [];
    lines.push(`Reporte semanal de oportunidades — últimos ${d.windowDays} días`);
    lines.push('');

    // Header counts.
    lines.push(`Recibidas: ${d.totalCreated}${deltaStr(d.totalCreated, d.prevTotalCreated)}`);
    lines.push(`Ganadas:   ${d.byStatus.WON}${deltaStr(d.byStatus.WON, d.prevWon)}`);
    lines.push(`Perdidas:  ${d.byStatus.LOST}${deltaStr(d.byStatus.LOST, d.prevLost)}`);
    if (d.winRatePct != null) {
      lines.push(`Tasa de cierre: ${d.winRatePct.toFixed(1)}%`);
    }

    // Funnel of in-flight stages — only show stages that have leads.
    const stages: Array<[LeadStatus, string]> = [
      [LeadStatus.NEW,         'nuevas'],
      [LeadStatus.CONTACTED,   'en contacto'],
      [LeadStatus.QUOTE_SENT,  'con presupuesto'],
      [LeadStatus.NEGOTIATING, 'negociando'],
    ];
    const inFlight = stages
      .filter(([s]) => d.byStatus[s] > 0)
      .map(([s, label]) => `${d.byStatus[s]} ${label}`);
    if (inFlight.length > 0) {
      lines.push('');
      lines.push('En curso: ' + inFlight.join(', ') + '.');
    }

    // Per-channel breakdown.
    if (d.byChannel.length > 0) {
      lines.push('');
      lines.push('Por canal:');
      for (const c of d.byChannel) {
        lines.push(`- ${c.label}: ${c.count}`);
      }
    }

    // Top mayoristas.
    if (d.topMayoristas.length > 0) {
      lines.push('');
      lines.push('Mayores oportunidades:');
      for (const t of d.topMayoristas) {
        const who = t.contactName ?? t.contactPhone ?? 'Sin nombre';
        const status = STATUS_LABEL[t.status] ?? t.status;
        lines.push(`- ${who} · ${fmtMoneyArs(t.estimatedValue)} · ${status}`);
      }
    }

    // Empty-week tail. Daily-digest does the same — silence is worse
    // than a "sin actividad" line.
    if (
      d.totalCreated === 0 &&
      d.byStatus.WON === 0 &&
      d.byStatus.LOST === 0
    ) {
      lines.push('');
      lines.push('Sin actividad esta semana.');
    }

    return lines.join('\n');
  }
}

const STATUS_LABEL: Record<LeadStatus, string> = {
  NEW: 'nueva',
  CONTACTED: 'en contacto',
  QUOTE_SENT: 'con presupuesto',
  NEGOTIATING: 'negociando',
  WON: 'ganada',
  LOST: 'perdida',
};

function deltaStr(curr: number, prev: number): string {
  if (prev === curr) return '';
  const diff = curr - prev;
  const sign = diff > 0 ? '+' : '';
  return ` (${sign}${diff} vs semana previa)`;
}

function fmtMoneyArs(n: number): string {
  return '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
