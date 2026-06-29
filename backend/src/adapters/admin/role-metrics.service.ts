/**
 * ADAPTERS LAYER - Role Metrics Service
 *
 * Marcos's per-role dashboard cuts. Each role gets a tightly-scoped report
 * of the things that actually drive their job:
 *
 *   ATENCION (Brenda)  — backlog warnings, first-response latency, unresolved-
 *                        by-AI conversations.
 *   VENTAS (Franco)    — mayoristas detected today/week, quotes idle past
 *                        threshold, lead conversion rate.
 *   ADMIN              — week-over-week deltas, best-converting channel,
 *                        top sold products. (Cost-per-conversation needs
 *                        Claude billing — placeholder until that lands.)
 *
 * Tunables (.env):
 *   BRENDA_ALERT_THRESHOLD_MIN — minutes before a flagged conversation
 *                                shows up in the alert list (default 10).
 *   QUOTE_FOLLOWUP_MINUTES     — minutes before a QUOTE_SENT lead counts as
 *                                "stale, needs follow-up" (preferred).
 *   QUOTE_FOLLOWUP_HOURS       — legacy hour-based equivalent (still works).
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, ConversationStatus, LeadStatus, MessageSender, OrderStatus, UserRole } from '@prisma/client';
import { getMessageCipher } from '../security/message-cipher';
import {
  quoteFollowupMinutes,
  quoteFollowupMs,
  idleMinutesSince,
} from '../lead-detection/quote-followup-window.util';

function num(envKey: string, fallback: number): number {
  const v = process.env[envKey];
  const n = v != null ? Number(v) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Time-window tunables — all in days. Defaults match the original
// hardcoded values; Marcos can tune any of them in `.env` without a code
// change.
//
//   METRICS_RECENT_WINDOW_DAYS — rolling window for "this week" semantics
//                                (avg first response, mayoristas-week, W/W
//                                this-week). Default 7.
//   METRICS_LONG_WINDOW_DAYS   — rolling window for medium-term cuts
//                                (30d conversion rate, best-converting
//                                channel, top-sold-products). Default 30.
const MS_PER_DAY = 24 * 60 * 60 * 1000;
function recentWindowMs(): number {
  return num('METRICS_RECENT_WINDOW_DAYS', 7) * MS_PER_DAY;
}
function longWindowMs(): number {
  return num('METRICS_LONG_WINDOW_DAYS', 30) * MS_PER_DAY;
}

export interface AtencionMetrics {
  alertThresholdMin: number;
  queueWaitingOverThreshold: number;
  avgFirstResponseSeconds: number | null;
  unresolvedByAI: Array<{
    conversationId: string;
    contactName: string | null;
    channel: string;
    lastMessage: string | null;
    escalatedAt: string | null;
    waitingMinutes: number;
  }>;
}

export interface VentasMetrics {
  mayoristasToday: number;
  mayoristasWeek: number;
  /**
   * Stale-quote threshold expressed in minutes. Frontend formats it as
   * "+25 min" / "+1.5 h" / "+24 h" depending on magnitude — see
   * `formatMinutes()` in role-metrics-cards.tsx.
   */
  quoteFollowupMinutes: number;
  quotesWaitingOverThreshold: Array<{
    leadId: string;
    contactName: string | null;
    productInterest: string | null;
    estimatedValue: number | null;
    sentAt: string;
    /** Whole minutes since the QUOTE_SENT transition. */
    idleMinutes: number;
  }>;
  conversionRate30d: number; // 0..1
  conversionRate30dDetail: { won: number; lost: number; openQuoted: number };
}

export interface LogisticaMetrics {
  /**
   * Orders not yet dispatched. Aldo's queue — these are the items he
   * needs to ship. CONFIRMED + PROCESSING count toward "pendiente".
   */
  pendingOrders: number;
  /**
   * Of the pending orders, how many were confirmed more than
   * `LOGISTICA_OVERDUE_HOURS` (default 48) ago and still haven't moved
   * to DISPATCHED. These need attention now.
   */
  overdueOrders: number;
  /**
   * Threshold (in hours) we used to compute overdueOrders. Surfaced so
   * the UI can label "Atrasados (+48h)" without hardcoding the number.
   */
  overdueThresholdHours: number;
  /**
   * Products at or below their low-stock threshold. ADMIN + LOGISTICA
   * are the roles wired to the product:low_stock socket alert, so this
   * card on Aldo's dashboard is the at-a-glance count for the same
   * data.
   */
  lowStockProducts: number;
  /**
   * Conversations currently assigned to logística-role users (typically
   * transferred from atención when there's a shipping/tracking question).
   */
  conversationsAssigned: number;
  /**
   * Pedidos despachados en la ventana corta (default 7 días) — la
   * señal positiva del trabajo terminado.
   */
  dispatchedRecent: number;
  /**
   * Top 5 pending orders the operator should look at first — sorted
   * oldest-first so the queue surfaces "where to start today".
   */
  pendingTop: Array<{
    orderId: string;
    orderNumber: string;
    contactName: string | null;
    amount: number;
    currency: string;
    ageHours: number;
    status: OrderStatus;
  }>;
}

export interface AdminMetrics {
  wow: {
    conversations: { thisWeek: number; lastWeek: number; deltaPct: number };
    leads: { thisWeek: number; lastWeek: number; deltaPct: number };
    orders: { thisWeek: number; lastWeek: number; deltaPct: number };
  };
  bestConvertingChannel: { channel: string | null; rate: number; total: number; won: number };
  topSoldProducts: Array<{ name: string; quantity: number; orderCount: number }>;
  claudeCostPerConversation: { costUsd: number | null; reason: string };
}

@Injectable()
export class RoleMetricsService {
  private readonly logger = new Logger(RoleMetricsService.name);
  private readonly prisma = new PrismaClient();

  // ATENCION ----------------------------------------------------------------
  // Marcos 2026-06-29: `userId` opcional para narrowear la card al
  // agente puntual (click en chip del header). Cuando no viene =
  // métrica agregada como siempre. La attribution se hace por
  // (a) conversation.assignedTo (cola + unresueltas) y por
  // (b) message.authorId (latencia primera-respuesta).
  async getAtencionMetrics(userId?: string): Promise<AtencionMetrics> {
    const threshold = num('BRENDA_ALERT_THRESHOLD_MIN', 10);
    const cutoff = new Date(Date.now() - threshold * 60 * 1000);

    const queueWaitingOverThreshold = await this.prisma.conversation.count({
      where: {
        isSandbox: false,
        needsHumanAttention: true,
        escalatedAt: { lt: cutoff },
        ...(userId ? { assignedTo: userId } : {}),
      },
    });

    const since = new Date(Date.now() - recentWindowMs());
    const recentConvs = await this.prisma.conversation.findMany({
      where: {
        isSandbox: false,
        createdAt: { gte: since },
        ...(userId ? { assignedTo: userId } : {}),
      },
      include: {
        messages: {
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    const STAFF: MessageSender[] = [
      MessageSender.BRENDA, MessageSender.FRANCO, MessageSender.ALDO, MessageSender.ADMIN,
    ];
    const latencies: number[] = [];
    for (const c of recentConvs) {
      const firstCust = c.messages.find((m) => m.sender === MessageSender.CUSTOMER);
      // Cuando hay userId filtramos por authorId — el primer mensaje de
      // staff que sale del CRM con authorId === userId; el enum sender
      // no distingue users individuales así que sin authorId el match
      // sería ambiguo. Sin userId vale cualquier staff.
      const firstStaff = userId
        ? c.messages.find((m) => m.authorId === userId && STAFF.includes(m.sender))
        : c.messages.find((m) => STAFF.includes(m.sender));
      if (!firstCust || !firstStaff) continue;
      if (firstStaff.timestamp.getTime() <= firstCust.timestamp.getTime()) continue;
      latencies.push(firstStaff.timestamp.getTime() - firstCust.timestamp.getTime());
    }
    const avgFirstResponseSeconds = latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length / 1000)
      : null;

    const unresolved = await this.prisma.conversation.findMany({
      where: {
        isSandbox: false,
        needsHumanAttention: true,
        status: ConversationStatus.WAITING,
        ...(userId ? { assignedTo: userId } : {}),
      },
      include: {
        contact: { select: { name: true } },
      },
      orderBy: { escalatedAt: 'asc' },
      take: 20,
    });
    const now = Date.now();
    return {
      alertThresholdMin: threshold,
      queueWaitingOverThreshold,
      avgFirstResponseSeconds,
      unresolvedByAI: unresolved.map((c) => ({
        conversationId: c.id,
        contactName: c.contact?.name ?? null,
        channel: c.channel,
        lastMessage: getMessageCipher().decrypt(c.lastMessage ?? ''),
        escalatedAt: c.escalatedAt?.toISOString() ?? null,
        waitingMinutes: c.escalatedAt ? Math.round((now - c.escalatedAt.getTime()) / 60000) : 0,
      })),
    };
  }

  // VENTAS ------------------------------------------------------------------
  // Marcos 2026-06-29: userId opcional. Filtro por lead.assignedTo en
  // todas las consultas para narrowear los mayoristas/quotes/conversion
  // al agente puntual.
  async getVentasMetrics(userId?: string): Promise<VentasMetrics> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - recentWindowMs());

    const assignFilter = userId ? { assignedTo: userId } : {};

    const mayoristasToday = await this.prisma.lead.count({
      where: { createdAt: { gte: startOfDay }, ...assignFilter },
    });
    const mayoristasWeek = await this.prisma.lead.count({
      where: { createdAt: { gte: weekAgo }, ...assignFilter },
    });

    const followupMinutes = quoteFollowupMinutes();
    const followupCutoff = new Date(Date.now() - quoteFollowupMs());
    const stale = await this.prisma.lead.findMany({
      where: {
        status: LeadStatus.QUOTE_SENT,
        updatedAt: { lt: followupCutoff },
        ...assignFilter,
      },
      include: { contact: { select: { name: true } } },
      orderBy: { updatedAt: 'asc' },
      take: 20,
    });

    const since30 = new Date(Date.now() - longWindowMs());
    const buckets = await this.prisma.lead.groupBy({
      by: ['status'],
      where: { updatedAt: { gte: since30 }, ...assignFilter },
      _count: { _all: true },
    });
    const counts = Object.fromEntries(
      buckets.map((b) => [b.status, b._count._all]),
    ) as Record<LeadStatus, number>;
    const won = counts[LeadStatus.WON] ?? 0;
    const lost = counts[LeadStatus.LOST] ?? 0;
    const openQuoted = (counts[LeadStatus.QUOTE_SENT] ?? 0) + (counts[LeadStatus.NEGOTIATING] ?? 0);
    const denom = won + lost + openQuoted;
    const conversionRate30d = denom > 0 ? Math.round((won / denom) * 1000) / 1000 : 0;

    return {
      mayoristasToday,
      mayoristasWeek,
      quoteFollowupMinutes: followupMinutes,
      quotesWaitingOverThreshold: stale.map((l) => ({
        leadId: l.id,
        contactName: l.contact?.name ?? null,
        productInterest: l.productInterest,
        estimatedValue: l.estimatedValue,
        sentAt: l.updatedAt.toISOString(),
        idleMinutes: idleMinutesSince(l.updatedAt),
      })),
      conversionRate30d,
      conversionRate30dDetail: { won, lost, openQuoted },
    };
  }

  // LOGISTICA ---------------------------------------------------------------
  // Marcos 2026-06-29: userId opcional. Para logística la attribution
  // se hace por dos vías: (a) conversationsAssigned filtra
  // conversation.assignedTo === userId; (b) dispatchedRecent narrowea
  // a las filas logistica_armado stampedById === userId con listoAt
  // o manuallyDispatchedAt dentro de la ventana. pendingOrders /
  // overdueOrders / lowStockProducts / pendingTop son del sistema y
  // no per-agente — quedan agregados.
  async getLogisticaMetrics(userId?: string): Promise<LogisticaMetrics> {
    const overdueThresholdHours = num('LOGISTICA_OVERDUE_HOURS', 48);
    const dispatchedWindowDays = num('LOGISTICA_DISPATCHED_WINDOW_DAYS', 7);
    const now = Date.now();
    const overdueCutoff = new Date(now - overdueThresholdHours * 60 * 60 * 1000);
    const dispatchedSince = new Date(now - dispatchedWindowDays * MS_PER_DAY);

    const PENDING_STATUSES: OrderStatus[] = [OrderStatus.CONFIRMED, OrderStatus.PROCESSING];

    const [
      pendingOrders,
      overdueOrders,
      lowStockProducts,
      conversationsAssigned,
      dispatchedRecent,
      pendingTopRows,
    ] = await Promise.all([
      this.prisma.order.count({ where: { status: { in: PENDING_STATUSES } } }),
      this.prisma.order.count({
        where: {
          status: { in: PENDING_STATUSES },
          createdAt: { lt: overdueCutoff },
        },
      }),
      this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM "products"
        WHERE "active" = true
          AND "inStock" = true
          AND "stockQuantity" IS NOT NULL
          AND "stockQuantity" <= COALESCE(
            "lowStockThreshold",
            ${num('PRODUCT_LOW_STOCK_DEFAULT_THRESHOLD', 5)}
          )
      `.then((rows) => Number(rows[0]?.count ?? 0)).catch(() => 0),
      this.prisma.conversation.count({
        where: {
          isSandbox: false,
          status: { in: [ConversationStatus.ACTIVE, ConversationStatus.WAITING] },
          ...(userId
            ? { assignedTo: userId }
            : { assigned: { role: UserRole.LOGISTICA } }),
        },
      }),
      // Marcos 2026-06-29: ambos paths usan logistica_armado como
      // fuente de verdad de "despachado" — el OR (listoAt OR
      // manuallyDispatchedAt) en la ventana. Antes el aggregate
      // contaba Order.status=DISPATCHED + dispatchedAt, que en este
      // sistema queda en 0 (el flow no avanza Order a DISPATCHED).
      // Resultado: el agregado mostraba 0 mientras que el operador
      // tildaba cientos de rows como LISTO — engañoso. Ahora el
      // agregado refleja la actividad real y el per-user es un
      // subset coherente.
      this.prisma.logisticaArmado.count({
        where: {
          ...(userId ? { stampedById: userId } : {}),
          OR: [
            { listoAt: { gte: dispatchedSince } },
            { manuallyDispatchedAt: { gte: dispatchedSince } },
          ],
        },
      }),
      this.prisma.order.findMany({
        where: { status: { in: PENDING_STATUSES } },
        orderBy: { createdAt: 'asc' },
        take: 6,
        select: {
          id: true,
          orderNumber: true,
          amount: true,
          currency: true,
          createdAt: true,
          status: true,
          contact: { select: { name: true } },
        },
      }),
    ]);

    const pendingTop = pendingTopRows.map((o) => ({
      orderId: o.id,
      orderNumber: o.orderNumber,
      contactName: o.contact?.name ?? null,
      amount: o.amount,
      currency: o.currency,
      ageHours: Math.max(0, Math.round((now - o.createdAt.getTime()) / (60 * 60 * 1000))),
      status: o.status,
    }));

    return {
      pendingOrders,
      overdueOrders,
      overdueThresholdHours,
      lowStockProducts,
      conversationsAssigned,
      dispatchedRecent,
      pendingTop,
    };
  }

  // ADMIN -------------------------------------------------------------------
  async getAdminMetrics(): Promise<AdminMetrics> {
    const now = new Date();
    const recentMs = recentWindowMs();
    const startThis = new Date(now.getTime() - recentMs);
    const startLast = new Date(now.getTime() - 2 * recentMs);

    const wowFor = async (model: 'conversation' | 'lead' | 'order') => {
      const m: any = (this.prisma as any)[model];
      const [thisWeek, lastWeek] = await Promise.all([
        m.count({ where: { createdAt: { gte: startThis } } }),
        m.count({ where: { createdAt: { gte: startLast, lt: startThis } } }),
      ]);
      const deltaPct = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : (thisWeek > 0 ? 100 : 0);
      return { thisWeek, lastWeek, deltaPct };
    };

    const [conversations, leads, orders] = await Promise.all([
      wowFor('conversation'), wowFor('lead'), wowFor('order'),
    ]);

    // Best converting channel — leads grouped by source over the long
    // window (default 30d, METRICS_LONG_WINDOW_DAYS).
    const since30 = new Date(now.getTime() - longWindowMs());
    const leadsByChannel = await this.prisma.lead.groupBy({
      by: ['source', 'status'],
      where: { createdAt: { gte: since30 } },
      _count: { _all: true },
    });
    const byChan: Record<string, { total: number; won: number }> = {};
    for (const row of leadsByChannel) {
      const key = (row.source ?? 'UNKNOWN') as string;
      byChan[key] = byChan[key] ?? { total: 0, won: 0 };
      byChan[key].total += row._count._all;
      if (row.status === LeadStatus.WON) byChan[key].won += row._count._all;
    }
    let best: { channel: string | null; rate: number; total: number; won: number } = {
      channel: null, rate: 0, total: 0, won: 0,
    };
    for (const [ch, v] of Object.entries(byChan)) {
      const rate = v.total > 0 ? v.won / v.total : 0;
      if (rate > best.rate || (rate === best.rate && v.total > best.total)) {
        best = { channel: ch, rate: Math.round(rate * 1000) / 1000, total: v.total, won: v.won };
      }
    }

    // Top sold products — flatten orders.products[] over last 30d.
    const recentOrders = await this.prisma.order.findMany({
      where: { createdAt: { gte: since30 } },
      select: { products: true },
    });
    const totals: Record<string, { quantity: number; orderCount: number }> = {};
    for (const o of recentOrders) {
      const items = (o.products as any[]) ?? [];
      const seenInThisOrder = new Set<string>();
      for (const it of items) {
        const name = it?.name ?? 'sin nombre';
        const qty = Number(it?.quantity ?? 0);
        totals[name] = totals[name] ?? { quantity: 0, orderCount: 0 };
        totals[name].quantity += qty;
        if (!seenInThisOrder.has(name)) {
          totals[name].orderCount += 1;
          seenInThisOrder.add(name);
        }
      }
    }
    const topSoldProducts = Object.entries(totals)
      .sort((a, b) => b[1].quantity - a[1].quantity)
      .slice(0, 5)
      .map(([name, v]) => ({ name, ...v }));

    return {
      wow: { conversations, leads, orders },
      bestConvertingChannel: best,
      topSoldProducts,
      claudeCostPerConversation: {
        costUsd: null,
        reason: 'awaiting Claude billing integration',
      },
    };
  }
}
