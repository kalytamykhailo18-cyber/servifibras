/**
 * Per-user team-performance metrics — Marcos 2026-06-18.
 *
 * Marcos's ask: a single page that shows each operator side-by-side so
 * he can tell who's working better/worse. Three pillars he flagged:
 *   1. Tiempo de respuesta: avg of FIRST staff reply per conversation
 *      (the latency the customer perceives). Per-user.
 *   2. Total facturado: sum of MANUAL order amounts attributed to the
 *      operator who pressed "Crear" (Order.createdById). TN + ML
 *      sales are NOT in this number — they go to the existing
 *      ventas-unificadas card, no buyer-side input from staff.
 *   3. Cantidad de pedidos cargados: count of those manual orders.
 *
 * Period filter is ISO from/to — caller picks 7d / 14d / 30d / custom.
 * Returns a flat per-user array so the UI can render a comparison
 * table directly.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { MessageSender, PrismaClient } from '@prisma/client';

export interface TeamPerformanceRow {
  userId: string;
  name: string;
  email: string;
  role: string;
  /** MANUAL orders the user created in the window (count). */
  ordersCreated: number;
  /** Sum of those orders' amount, ARS — only currency==ARS, not
   *  cancelled, not reposición. */
  invoicedArs: number;
  /** Conversations where the user authored at least one staff
   *  message in the window. */
  conversationsHandled: number;
  /** Avg seconds between customer's first message and THIS user's
   *  first reply, across conversations in the window where this
   *  user was the first staff responder. null when there were
   *  none (the user didn't open any conversation in the window). */
  avgFirstResponseSeconds: number | null;
  /** Avg seconds between any consecutive customer→user reply pair
   *  in the window (not just the first). */
  avgReplyLatencySeconds: number | null;
}

@Injectable()
export class TeamPerformanceService {
  private readonly logger = new Logger(TeamPerformanceService.name);
  private readonly prisma: PrismaClient;

  constructor(
    @Optional() prismaShared?: import('../repositories/prisma.service').PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  async team(args: { fromIso: string; toIso: string }): Promise<{
    fromIso: string;
    toIso: string;
    users: TeamPerformanceRow[];
  }> {
    const from = new Date(args.fromIso);
    const to = new Date(args.toIso);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
      return { fromIso: args.fromIso, toIso: args.toIso, users: [] };
    }

    // Roster — every active user. We always return a row per user even
    // with zero activity, so the comparison table is stable (no flicker
    // when a user takes the day off).
    const users = await this.prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    // ─── Manual sales per user ─────────────────────────────────────
    // Per Marcos: createdById is the "assigned the sale to" key. Skip
    // reposiciones (not sales) and cancelled orders.
    const orders = await this.prisma.order.findMany({
      where: {
        source: 'MANUAL',
        createdById: { not: null },
        isReposicion: false,
        status: { notIn: ['CANCELLED'] as any },
        createdAt: { gte: from, lte: to },
      },
      select: { amount: true, currency: true, createdById: true },
    });
    const orderAgg = new Map<string, { count: number; ars: number }>();
    for (const o of orders) {
      const id = o.createdById!;
      const cur = orderAgg.get(id) ?? { count: 0, ars: 0 };
      cur.count++;
      if (o.currency === 'ARS') cur.ars += o.amount;
      orderAgg.set(id, cur);
    }

    // ─── Per-user response latency ─────────────────────────────────
    // For each conversation that had activity in the window, walk the
    // message timeline and record:
    //   - first-response: time between the customer's first message
    //     and the first staff (authored by a user) reply that follows
    //   - all reply latencies: every customer→staff transition pair
    // Then attribute to the user that authored the staff message.
    const conversations = await this.prisma.conversation.findMany({
      where: {
        isSandbox: false,
        updatedAt: { gte: from },
      },
      select: {
        id: true,
        messages: {
          where: { timestamp: { lte: to } },
          orderBy: { timestamp: 'asc' },
          select: { timestamp: true, sender: true, authorId: true },
        },
      },
    });

    const firstResponseByUser = new Map<string, number[]>(); // userId → latencies (ms)
    const replyLatenciesByUser = new Map<string, number[]>();
    const conversationsByUser = new Map<string, Set<string>>();
    for (const conv of conversations) {
      const msgs = conv.messages;
      if (msgs.length === 0) continue;

      // First customer turn anchors the first-response calculation.
      const firstCustomer = msgs.find((m) => m.sender === MessageSender.CUSTOMER);

      // Walk pairs: for every CUSTOMER message followed by a USER-
      // authored staff reply (authorId present), record the latency.
      let firstStaffRecorded = false;
      let pendingCustomerAt: number | null = firstCustomer ? firstCustomer.timestamp.getTime() : null;
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        if (m.sender === MessageSender.CUSTOMER) {
          pendingCustomerAt = m.timestamp.getTime();
          continue;
        }
        if (!m.authorId) continue; // AI / system replies don't count
        const userId = m.authorId;
        // Track conversations handled by user
        const set = conversationsByUser.get(userId) ?? new Set<string>();
        set.add(conv.id);
        conversationsByUser.set(userId, set);
        // Latency vs the most recent customer message
        if (pendingCustomerAt != null) {
          const lat = m.timestamp.getTime() - pendingCustomerAt;
          if (lat > 0) {
            const arr = replyLatenciesByUser.get(userId) ?? [];
            arr.push(lat);
            replyLatenciesByUser.set(userId, arr);
            // First staff reply on this conversation is also the
            // first-response latency for the responder.
            if (!firstStaffRecorded && firstCustomer && m.timestamp.getTime() > firstCustomer.timestamp.getTime()) {
              const f = firstResponseByUser.get(userId) ?? [];
              f.push(m.timestamp.getTime() - firstCustomer.timestamp.getTime());
              firstResponseByUser.set(userId, f);
              firstStaffRecorded = true;
            }
          }
          pendingCustomerAt = null; // consumed
        }
      }
    }

    const avg = (arr: number[] | undefined): number | null => {
      if (!arr || arr.length === 0) return null;
      return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length / 1000);
    };

    return {
      fromIso: args.fromIso,
      toIso: args.toIso,
      users: users.map((u) => {
        const o = orderAgg.get(u.id) ?? { count: 0, ars: 0 };
        return {
          userId: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          ordersCreated: o.count,
          invoicedArs: Math.round(o.ars * 100) / 100,
          conversationsHandled: conversationsByUser.get(u.id)?.size ?? 0,
          avgFirstResponseSeconds: avg(firstResponseByUser.get(u.id)),
          avgReplyLatencySeconds: avg(replyLatenciesByUser.get(u.id)),
        };
      }),
    };
  }
}
