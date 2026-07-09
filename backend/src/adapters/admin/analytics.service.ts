/**
 * ADAPTERS LAYER - Analytics Service
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient, Channel, ConversationStatus, MessageSender } from '@prisma/client';
import { UserRole } from '../../domain/entities/auth.entity';
import { DispatchTariffService } from './dispatch-tariff.service';
import { PostalCodeZoneService } from './postal-code-zone.service';
import { normaliseCarrier, outsideZoneDefaultCarrier, applyOutsideZoneFallback } from './carrier-normalize.util';

/**
 * Compute the per-role `where` clause for conversation aggregates so a
 * non-admin's dashboard reflects their queue, not the global pool.
 *   ADMIN — empty (no scope)
 *   ATENCION — own + unassigned
 *   VENTAS / LOGISTICA — own only
 */
function conversationScopeWhere(scope?: { userId: string; role: UserRole }): any {
  // Every analytics surface excludes sandbox conversations — the "Probar
  // como cliente" tool would otherwise inflate today's counters.
  const base = { isSandbox: false };
  if (!scope || scope.role === UserRole.ADMIN) return base;
  if (scope.role === UserRole.ATENCION) {
    return { ...base, OR: [{ assignedTo: scope.userId }, { assignedTo: null }] };
  }
  return { ...base, assignedTo: scope.userId };
}
import {
  IAnalyticsService,
  TimeRange,
  ConversationMetrics,
  ConversationTrends,
  ContactMetrics,
  AIPerformanceMetrics,
  ResponseTimeMetrics,
  ChannelPerformance,
  DashboardSummary,
} from '../../use-cases/admin/analytics.interface';

@Injectable()
export class AnalyticsService implements IAnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly prisma: PrismaClient;

  constructor(
    private readonly tariffs: DispatchTariffService,
    // Marcos 2026-06-20: lookup CP → zona como último fallback en la
    // cadena de derivación. @Optional para que tests legacy que
    // construyen AnalyticsService sin contenedor sigan funcionando.
    @Optional() private readonly postalZones?: PostalCodeZoneService,
  ) {
    this.prisma = new PrismaClient();
    this.logger.log('✅ Analytics service initialized');
  }

  async getDashboardSummary(scope?: { userId: string; role: UserRole }): Promise<DashboardSummary> {
    try {
      // Conversation+contact metrics get scoped to the caller's slice; AI
      // performance and KB-by-category are platform-wide aggregates that
      // don't depend on which operator is looking.
      const convScopeWhere = conversationScopeWhere(scope);
      const [conversationMetrics, contactMetrics, aiPerformanceMetrics, knowledgeByCategory] =
        await Promise.all([
          this.getConversationMetrics(undefined, scope),
          this.getContactMetrics(scope),
          this.getAIPerformanceMetrics(),
          this.prisma.knowledgeBase.groupBy({
            by: ['category'],
            _count: true,
            orderBy: { _count: { category: 'desc' } },
            take: 5,
          }),
        ]);

      // Get recent activity (last 24 hours)
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      // Recent-activity counts also scope to the caller — Brenda's "24h
      // conversations" is HER 24h, not the company's. Messages count
      // joins through conversation so the same scope applies. Contacts
      // are not role-scoped today; show platform-wide.
      const [conversationsLast24h, messagesLast24h, newContactsLast24h] =
        await Promise.all([
          this.prisma.conversation.count({
            where: { ...convScopeWhere, createdAt: { gte: twentyFourHoursAgo } },
          }),
          this.prisma.message.count({
            where: {
              timestamp: { gte: twentyFourHoursAgo },
              ...(Object.keys(convScopeWhere).length
                ? { conversation: convScopeWhere }
                : {}),
            },
          }),
          this.prisma.contact.count({
            where: { createdAt: { gte: twentyFourHoursAgo } },
          }),
        ]);

      return {
        conversationMetrics,
        contactMetrics,
        aiPerformanceMetrics,
        topCategories: knowledgeByCategory.map((item) => ({
          category: item.category,
          count: item._count,
        })),
        recentActivity: {
          conversationsLast24h,
          messagesLast24h,
          newContactsLast24h,
        },
      };
    } catch (error: any) {
      this.logger.error(`Error getting dashboard summary: ${error.message}`);
      throw error;
    }
  }

  async getConversationMetrics(
    timeRange?: TimeRange,
    scope?: { userId: string; role: UserRole },
  ): Promise<ConversationMetrics> {
    try {
      // Compose role scope + time range. Roles other than ADMIN see only
      // their own slice — Brenda's "total conversations" should match her
      // inbox count, not the company-wide total.
      const where: any = { ...conversationScopeWhere(scope) };
      if (timeRange) {
        where.createdAt = {
          gte: timeRange.startDate,
          lte: timeRange.endDate,
        };
      }

      const [total, active, closed, waiting, conversationsWithCounts] =
        await Promise.all([
          this.prisma.conversation.count({ where }),
          this.prisma.conversation.count({
            where: { ...where, status: ConversationStatus.ACTIVE },
          }),
          this.prisma.conversation.count({
            where: { ...where, status: ConversationStatus.CLOSED },
          }),
          this.prisma.conversation.count({
            where: { ...where, status: ConversationStatus.WAITING },
          }),
          this.prisma.conversation.findMany({
            where,
            include: {
              _count: {
                select: { messages: true },
              },
            },
          }),
        ]);

      const totalMessages = conversationsWithCounts.reduce(
        (sum, conv) => sum + conv._count.messages,
        0,
      );

      const avgMessagesPerConversation =
        total > 0 ? Math.round((totalMessages / total) * 10) / 10 : 0;

      return {
        total,
        active,
        closed,
        waiting,
        avgMessagesPerConversation,
        totalMessages,
      };
    } catch (error: any) {
      this.logger.error(`Error getting conversation metrics: ${error.message}`);
      throw error;
    }
  }

  async getConversationTrends(days: number = 7): Promise<ConversationTrends> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Get daily counts
      const dailyData: Array<{ date: string; total: number; active: number; closed: number }> = [];

      for (let i = 0; i < days; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);

        const [total, active, closed] = await Promise.all([
          this.prisma.conversation.count({
            where: {
              isSandbox: false,
              createdAt: { gte: date, lt: nextDate },
            },
          }),
          this.prisma.conversation.count({
            where: {
              isSandbox: false,
              createdAt: { gte: date, lt: nextDate },
              status: ConversationStatus.ACTIVE,
            },
          }),
          this.prisma.conversation.count({
            where: {
              isSandbox: false,
              createdAt: { gte: date, lt: nextDate },
              status: ConversationStatus.CLOSED,
            },
          }),
        ]);

        dailyData.push({
          date: date.toISOString().split('T')[0],
          total,
          active,
          closed,
        });
      }

      // Get by channel
      const byChannelData = await this.prisma.conversation.groupBy({
        by: ['channel'],
        _count: true,
        where: {
          isSandbox: false,
          createdAt: { gte: startDate },
        },
      });

      const byChannel: Record<Channel, number> = {} as any;
      byChannelData.forEach((item) => {
        byChannel[item.channel] = item._count;
      });

      // Get by status
      const byStatusData = await this.prisma.conversation.groupBy({
        by: ['status'],
        _count: true,
        where: {
          isSandbox: false,
          createdAt: { gte: startDate },
        },
      });

      const byStatus: Record<ConversationStatus, number> = {} as any;
      byStatusData.forEach((item) => {
        byStatus[item.status] = item._count;
      });

      return {
        daily: dailyData,
        byChannel,
        byStatus,
      };
    } catch (error: any) {
      this.logger.error(`Error getting conversation trends: ${error.message}`);
      throw error;
    }
  }

  async getContactMetrics(_scope?: { userId: string; role: UserRole }): Promise<ContactMetrics> {
    // Contacts aren't role-owned — every operator deals with the same
    // shared contact pool. We accept the scope arg so the caller signature
    // is uniform across the analytics service, but intentionally don't
    // filter by it.
    try {
      const now = new Date();
      const startOfDay = new Date(now.setHours(0, 0, 0, 0));
      const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const [
        total,
        newToday,
        newThisWeek,
        newThisMonth,
        byChannelData,
        withActiveConversations,
      ] = await Promise.all([
        this.prisma.contact.count({ where: { isSandbox: false } }),
        this.prisma.contact.count({ where: { isSandbox: false, createdAt: { gte: startOfDay } } }),
        this.prisma.contact.count({ where: { isSandbox: false, createdAt: { gte: startOfWeek } } }),
        this.prisma.contact.count({ where: { isSandbox: false, createdAt: { gte: startOfMonth } } }),
        this.prisma.contact.groupBy({
          by: ['channel'],
          where: { isSandbox: false },
          _count: true,
        }),
        this.prisma.contact.count({
          where: {
            isSandbox: false,
            conversations: {
              some: {
                isSandbox: false,
                status: {
                  in: [ConversationStatus.ACTIVE, ConversationStatus.WAITING],
                },
              },
            },
          },
        }),
      ]);

      const byChannel: Record<Channel, number> = {} as any;
      byChannelData.forEach((item) => {
        byChannel[item.channel] = item._count;
      });

      return {
        total,
        newToday,
        newThisWeek,
        newThisMonth,
        byChannel,
        withActiveConversations,
      };
    } catch (error: any) {
      this.logger.error(`Error getting contact metrics: ${error.message}`);
      throw error;
    }
  }

  async getAIPerformanceMetrics(timeRange?: TimeRange): Promise<AIPerformanceMetrics> {
    try {
      // Message-level metrics filter sandbox by joining through conversation.
      const where: any = { conversation: { isSandbox: false } };
      if (timeRange) {
        where.timestamp = {
          gte: timeRange.startDate,
          lte: timeRange.endDate,
        };
      }

      const [totalAIMessages, totalHumanMessages, totalMessages, conversationsWithAI] =
        await Promise.all([
          this.prisma.message.count({
            where: { ...where, isFromAI: true },
          }),
          this.prisma.message.count({
            where: {
              ...where,
              isFromAI: false,
              sender: { not: MessageSender.CUSTOMER },
            },
          }),
          this.prisma.message.count({ where }),
          this.prisma.conversation.count({
            where: {
              isSandbox: false,
              messages: {
                some: {
                  isFromAI: true,
                },
              },
            },
          }),
        ]);

      // Find conversations with only AI responses (fully automated)
      const conversationsFullyAutomated = await this.prisma.conversation.count({
        where: {
          isSandbox: false,
          messages: {
            some: {
              isFromAI: true,
            },
            none: {
              isFromAI: false,
              sender: { not: MessageSender.CUSTOMER },
            },
          },
        },
      });

      const aiResponseRate =
        totalMessages > 0 ? Math.round((totalAIMessages / totalMessages) * 100) : 0;

      const averageAIMessagesPerConversation =
        conversationsWithAI > 0
          ? Math.round((totalAIMessages / conversationsWithAI) * 10) / 10
          : 0;

      return {
        totalAIMessages,
        totalHumanMessages,
        aiResponseRate,
        conversationsWithAI,
        conversationsFullyAutomated,
        averageAIMessagesPerConversation,
      };
    } catch (error: any) {
      this.logger.error(`Error getting AI performance metrics: ${error.message}`);
      throw error;
    }
  }

  async getResponseTimeMetrics(timeRange?: TimeRange): Promise<ResponseTimeMetrics> {
    try {
      // For now, return placeholder values as calculating actual response times
      // requires tracking timestamps between customer messages and responses
      // This would need additional schema changes or complex queries
      this.logger.warn('Response time metrics returning placeholder values');

      return {
        avgFirstResponseTimeMinutes: 0,
        avgOverallResponseTimeMinutes: 0,
        conversationsWithFastResponse: 0,
        conversationsWithSlowResponse: 0,
      };
    } catch (error: any) {
      this.logger.error(`Error getting response time metrics: ${error.message}`);
      throw error;
    }
  }

  async getChannelPerformance(timeRange?: TimeRange): Promise<ChannelPerformance[]> {
    try {
      const where: any = { isSandbox: false };
      if (timeRange) {
        where.createdAt = {
          gte: timeRange.startDate,
          lte: timeRange.endDate,
        };
      }

      const channels = await this.prisma.conversation.groupBy({
        by: ['channel'],
        _count: true,
        where,
      });

      const performance: ChannelPerformance[] = [];

      for (const channelData of channels) {
        const channel = channelData.channel;
        const totalConversations = channelData._count;

        const [activeConversations, conversationsWithMessages, aiMessages, totalMessages] =
          await Promise.all([
            this.prisma.conversation.count({
              where: {
                ...where,
                channel,
                status: ConversationStatus.ACTIVE,
              },
            }),
            this.prisma.conversation.findMany({
              where: { ...where, channel },
              include: {
                _count: {
                  select: { messages: true },
                },
              },
            }),
            this.prisma.message.count({
              where: {
                conversation: { channel, isSandbox: false },
                isFromAI: true,
              },
            }),
            this.prisma.message.count({
              where: {
                conversation: { channel, isSandbox: false },
              },
            }),
          ]);

        const totalMessagesCount = conversationsWithMessages.reduce(
          (sum, conv) => sum + conv._count.messages,
          0,
        );

        const avgMessagesPerConversation =
          totalConversations > 0
            ? Math.round((totalMessagesCount / totalConversations) * 10) / 10
            : 0;

        const aiResponseRate =
          totalMessages > 0 ? Math.round((aiMessages / totalMessages) * 100) : 0;

        performance.push({
          channel,
          totalConversations,
          activeConversations,
          avgMessagesPerConversation,
          totalMessages: totalMessagesCount,
          aiResponseRate,
        });
      }

      return performance;
    } catch (error: any) {
      this.logger.error(`Error getting channel performance: ${error.message}`);
      throw error;
    }
  }

  async getTimeSeriesData(
    metric: 'conversations' | 'messages' | 'contacts',
    days: number,
  ): Promise<Array<{ date: string; value: number }>> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const data: Array<{ date: string; value: number }> = [];

      for (let i = 0; i < days; i++) {
        const date = new Date(startDate);
        date.setDate(date.getDate() + i);
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);

        let value = 0;

        if (metric === 'conversations') {
          value = await this.prisma.conversation.count({
            where: {
              isSandbox: false,
              createdAt: { gte: date, lt: nextDate },
            },
          });
        } else if (metric === 'messages') {
          value = await this.prisma.message.count({
            where: {
              conversation: { isSandbox: false },
              timestamp: { gte: date, lt: nextDate },
            },
          });
        } else if (metric === 'contacts') {
          value = await this.prisma.contact.count({
            where: {
              isSandbox: false,
              createdAt: { gte: date, lt: nextDate },
            },
          });
        }

        data.push({
          date: date.toISOString().split('T')[0],
          value,
        });
      }

      return data;
    } catch (error: any) {
      this.logger.error(`Error getting time series data: ${error.message}`);
      throw error;
    }
  }

  /**
   * Bloque B item 1 — Marcos 2026-06-06: per-cuenta ML breakdown.
   * Splits MERCADOLIBRE conversation counts + question reply
   * activity by the OAuth provider key stamped on each conversation
   * ("mercadolibre" = cuenta 1, "mercadolibre_cuenta2" = cuenta 2,
   * null = pre-tagging legacy rows). Drives the dashboard's per-
   * store cards so Marcos can see which cuenta is pulling its
   * weight.
   */
  async getMercadoLibreAccountSplit(timeRange?: TimeRange): Promise<{
    range: { since: Date | null; until: Date | null };
    accounts: Array<{
      mlAccountKey: string | null;
      label: string;
      totalConversations: number;
      activeConversations: number;
      newConversations: number;
      aiReplies: number;
    }>;
  }> {
    const since = timeRange?.startDate ?? null;
    const until = timeRange?.endDate ?? null;
    const baseWhere: any = { isSandbox: false, channel: Channel.MERCADOLIBRE };
    if (since || until) {
      baseWhere.createdAt = {};
      if (since) baseWhere.createdAt.gte = since;
      if (until) baseWhere.createdAt.lt = until;
    }

    // Group every ML conversation by mlAccountKey (including null).
    const byAccount = await this.prisma.conversation.groupBy({
      by: ['mlAccountKey'],
      where: baseWhere,
      _count: { _all: true },
    });

    const accounts: Array<{
      mlAccountKey: string | null;
      label: string;
      totalConversations: number;
      activeConversations: number;
      newConversations: number;
      aiReplies: number;
    }> = [];

    for (const row of byAccount) {
      const key = row.mlAccountKey;
      const label = labelForAccountKey(key);
      const accountWhere = { ...baseWhere, mlAccountKey: key };
      const [active, newCount, aiReplies] = await Promise.all([
        this.prisma.conversation.count({
          where: { ...accountWhere, status: ConversationStatus.ACTIVE },
        }),
        // "new" means created in the time range (already filtered in baseWhere)
        Promise.resolve(row._count._all),
        this.prisma.message.count({
          where: {
            isFromAI: true,
            sender: MessageSender.AI,
            conversation: { ...accountWhere },
          },
        }),
      ]);
      accounts.push({
        mlAccountKey: key,
        label,
        totalConversations: row._count._all,
        activeConversations: active,
        newConversations: newCount,
        aiReplies,
      });
    }

    // Stable ordering: cuenta1 first, cuenta2 next, untagged last.
    accounts.sort((a, b) => keyOrder(a.mlAccountKey) - keyOrder(b.mlAccountKey));
    return { range: { since, until }, accounts };
  }

  /**
   * Marcos 2026-06-12 (2): the TN/ML labels and the real-world
   * mensajería don't match 1-1 — "Andreani online" + "Envío Nube"
   * both go through Andreani; "Flex_373" is JyJ; the Caseros store
   * shows up as "servifibras" / "retiras en servifibras". Normalise
   * carrier names here so the stats card groups the same way Marcos
   * thinks about his fleet.
   *
   * Cases left untouched:
   *   - "CABA GRATUITO" / "GBA 1/2/3" — these can be carried by
   *     M2 / JyJ / Baires depending on schedule. Without an
   *     operator pick at dispatch time we can't disambiguate, so
   *     we keep the TN label as-is.
   *   - Anything else falls through unchanged.
   */
  /**
   * Marcos 2026-06-16: the TN shipping-method label (e.g. "GBA 1 GRATIS
   * (15hs a 21hs)", "CABA GRATUITO", "Tarifa Nacional Gran Tamaño")
   * carries the ZONE the package is going to — but not the carrier
   * (the operator picks that in the panel). We extract the zone here
   * so the per-zone breakdown + tariff lookup can use Marcos's
   * canonical names (CABA, GBA 1, GBA 2, GBA 3, Nacional, Nacional GT,
   * Interior). Returns null when the label doesn't carry a zone hint.
   */
  private deriveZoneFromShippingLabel(raw: string | null | undefined): string | null {
    const lc = (raw ?? '').trim().toLowerCase();
    if (!lc) return null;
    if (/\bgba\s*1\b/.test(lc)) return 'GBA 1';
    if (/\bgba\s*2\b/.test(lc)) return 'GBA 2';
    if (/\bgba\s*3\b/.test(lc)) return 'GBA 3';
    if (/\bcaba\b/.test(lc)) return 'CABA';
    if (/tarifa\s+nacional\s+gran\s*tama/.test(lc)) return 'Nacional Gran Tamaño';
    if (/tarifa\s+nacional/.test(lc)) return 'Nacional';
    if (/despacho\s+a?\s*terminal/.test(lc) || /\bmicro\b/.test(lc)) return 'Interior (micro)';
    return null;
  }

  /**
   * Argentine province → canonical zone. Capital Federal collapses to
   * CABA so a TN order whose only zone hint is the province field
   * still matches Marcos's tariff rows. Buenos Aires province stays
   * un-derived because it splits across GBA 1/2/3 and the operator
   * has to pick — we don't guess.
   */
  private provinceToZone(province: string | null | undefined): string | null {
    const lc = (province ?? '').trim().toLowerCase();
    if (!lc) return null;
    if (/^(capital federal|caba|c\.a\.b\.a\.?)$/.test(lc)) return 'CABA';
    return null;
  }

  // Marcos 2026-06-30: extraída a carrier-normalize.util para que
  // el daily-logistica aggregator use la misma regla de negocio
  // sin duplicar. Wrapper instance para no romper call sites
  // existentes que invocan this.normaliseCarrier(...).
  private normaliseCarrier(raw: string | null | undefined): string {
    return normaliseCarrier(raw);
  }

  /**
   * Marcos 2026-06-12: dispatch history grouped by mensajería. The
   * source of truth is `LogisticaArmado.manuallyDispatchedAt` (the
   * operator's confirmation that the package physically left). For
   * each stamp we resolve the carrier name from the underlying
   * source: Order.carrier when it's a CRM/TN row, "Mercado Libre"
   * for ML rows (we don't store ML's carrier locally), and
   * "Servifibras propio" for PRFV laminados that left from our
   * shop.
   */
  async getDispatchStats(args: { fromIso: string; toIso: string }): Promise<{
    fromIso: string;
    toIso: string;
    total: number;
    /** Marcos 2026-06-12: sum of carrier fees across all rows we
     *  could attribute a cost to (TN orders with shipping_cost_owner
     *  populated). Used as the "expected" invoice across all
     *  mensajerías combined. */
    totalShippingCost: number;
    /** Marcos 2026-06-15: total estimated to pay to couriers based on
     *  the admin-curated tarifas table (per carrier + zone × packet
     *  count). Independent of `totalShippingCost`, which is what the
     *  buyer paid the seller. Null when no tariffs are loaded yet. */
    totalEstimatedCost: number | null;
    /** Count of dispatched rows that couldn't be matched to any active
     *  (carrier, zone) tariff. Surfaced in the UI as "X filas sin
     *  tarifa" so Marcos knows the estimate is partial. */
    rowsWithoutTariff: number;
    byCarrier: Array<{
      carrier: string;
      count: number;
      /** Sum of shippingCost across this carrier's rows. */
      totalShippingCost: number;
      /** Sum of tariff × count across this carrier's zones. Null when
       *  no zone of this carrier has an active tariff. */
      totalEstimatedCost: number | null;
      rowsWithoutTariff: number;
      /** Per-zone breakdown so Marcos can see "CABA × 10 = $30k". */
      byZone: Array<{
        zone: string;
        count: number;
        totalShippingCost: number;
        /** Per-zone estimate from the tariff table, or null if none. */
        estimatedCost: number | null;
        tariffPerPackage: number | null;
      }>;
      orders: Array<{
        rowKey: string;
        orderNumber: string | null;
        customer: string | null;
        dispatchedAt: string;
        amount: number | null;
        currency: string | null;
        shippingCost: number | null;
        shippingZone: string | null;
      }>;
    }>;
  }> {
    const from = new Date(args.fromIso);
    const to = new Date(args.toIso);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
      return { fromIso: args.fromIso, toIso: args.toIso, total: 0, totalShippingCost: 0, totalEstimatedCost: null, rowsWithoutTariff: 0, byCarrier: [] };
    }
    // Marcos 2026-07-09: antes esta query solo miraba manuallyDispatchedAt
    // (el "Marcar como despachadas" manual desde el panel). El flujo real
    // es: el operador tilda LISTO cuando la mensajería retira el paquete
    // — ese momento ES el despacho. La lista de mensajerías estaba
    // saliendo con 3 nombres (los pocos que Marcos marcaba a mano) en
    // lugar de las 5+ reales (JyJ / M2 / Baires / Andreani / Uber),
    // así los pagos a las mensajerías no se podían segmentar. Ahora la
    // ventana incluye LISTO o manuallyDispatched — cualquiera que caiga
    // adentro cuenta. role-metrics.getLogisticaMetrics ya usa el mismo
    // criterio para dispatchedRecent (2026-06-29 fix).
    const stampsRaw = await this.prisma.logisticaArmado.findMany({
      where: {
        OR: [
          { manuallyDispatchedAt: { gte: from, lte: to } },
          { listoAt: { gte: from, lte: to } },
        ],
      },
      select: {
        rowKey: true,
        manuallyDispatchedAt: true,
        listoAt: true,
        flexCourier: true,
      },
      orderBy: { stampedAt: 'desc' },
      take: 5000,
    });
    // Normalize: pick the dispatch instant (manuallyDispatchedAt wins
    // when both present — that's the explicit stamp), so the downstream
    // grouping code sees a single manuallyDispatchedAt-shaped field.
    const stamps = stampsRaw.map((s) => ({
      rowKey: s.rowKey,
      flexCourier: s.flexCourier,
      manuallyDispatchedAt: (s.manuallyDispatchedAt ?? s.listoAt)!,
    }));
    if (stamps.length === 0) {
      return { fromIso: args.fromIso, toIso: args.toIso, total: 0, totalShippingCost: 0, totalEstimatedCost: null, rowsWithoutTariff: 0, byCarrier: [] };
    }
    // Resolve CRM/TN rowKeys → Order rows in one batch query so 280
    // stamps don't fan out to 280 queries.
    const orderIds = stamps
      .map((s) => {
        const m = /^(?:crm|tn):([0-9a-f-]{36})$/i.exec(s.rowKey);
        return m ? m[1] : null;
      })
      .filter((x): x is string => x != null);
    const orders = orderIds.length
      ? await this.prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: {
            id: true,
            orderNumber: true,
            carrier: true,
            amount: true,
            currency: true,
            shippingCost: true,
            shippingZone: true,
            // Marcos 2026-06-20: contact.metadata.postalCode es el
            // fallback final de la cadena de derivación de zona —
            // cuando ni el TN label ni el rawCarrier dieron zona,
            // buscamos en el mapping CP → zona que el admin cargó.
            contact: { select: { name: true, metadata: true } },
          },
        })
      : [];
    const orderById = new Map(orders.map((o) => [o.id, o]));
    // Group. Each bucket also tracks per-zone counts and the running
    // sum of shipping_cost_owner so the card can render the
    // "CABA × 10 = $30.000" breakdown Marcos described.
    type ZoneBucket = { count: number; totalShippingCost: number };
    type Bucket = {
      count: number;
      totalShippingCost: number;
      byZone: Map<string, ZoneBucket>;
      orders: Array<any>;
    };
    const groups = new Map<string, Bucket>();
    const bumpGroup = (carrier: string, row: any) => {
      const b = groups.get(carrier) ?? {
        count: 0,
        totalShippingCost: 0,
        byZone: new Map<string, ZoneBucket>(),
        orders: [],
      };
      b.count++;
      const c = typeof row.shippingCost === 'number' ? row.shippingCost : 0;
      b.totalShippingCost += c;
      // Marcos 2026-06-16: prefer the zone hint embedded in the TN
      // shipping-method label (carries CABA / GBA 1/2/3 / Nacional)
      // over the raw shippingZone (which is just the province). Falls
      // back to a province → zone alias (Capital Federal → CABA),
      // then to the raw province, then to "Sin zona". `rawCarrier`
      // is stripped from the row before it lands in the API response.
      //
      // Marcos 2026-06-20: cuando el operador picked manualmente la
      // mensajería (s.flexCourier="JyJ"), `rawCarrier` venía como "JyJ"
      // y `deriveZoneFromShippingLabel("JyJ")` no matcheaba nada — el
      // zone hint embedded en la TN shipping-label original (ej. "GBA 1
      // GRATIS") se perdía. Ahora pasamos `shippingLabel` por separado
      // (siempre el label crudo TN/ML) y derivamos zone de ese, así la
      // mensajería elegida + zona inferida resuelven la tarifa correcta.
      const rawCarrierHint = (row as any).rawCarrier ?? null;
      const shippingLabelHint = (row as any).shippingLabel ?? null;
      const cpHint = (row as any).postalCode ?? null;
      const localityHint = (row as any).locality ?? null;
      delete (row as any).rawCarrier;
      delete (row as any).shippingLabel;
      delete (row as any).postalCode;
      delete (row as any).locality;
      // Marcos 2026-06-22: cadena de derivacion
      //   1) zona embebida en el label TN/ML (carriers gratuitos)
      //   2) rawCarrier label (override del operador)
      //   3) resolver de PostalCodeZoneService (localidad exacta →
      //      localidad normalizada → CP → default)
      //   4) provincia → zona (heuristica vieja Capital Federal→CABA)
      //   5) provincia cruda como ultimo recurso
      // El resolver internamente hace tie-break por tier mas alto
      // cuando localidad y CP devuelven zonas distintas.
      const postalResolved = (this.postalZones && cpZoneCache)
        ? this.postalZones.resolveZone({ locality: localityHint, cp: cpHint }, cpZoneCache)
        : null;
      const derivedZone =
        this.deriveZoneFromShippingLabel(shippingLabelHint) ??
        this.deriveZoneFromShippingLabel(rawCarrierHint) ??
        (postalResolved && postalResolved.zone ? postalResolved.zone : null) ??
        this.provinceToZone(row.shippingZone) ??
        (typeof row.shippingZone === 'string' && row.shippingZone.length > 0 ? row.shippingZone : null);
      const zoneLabel: string = derivedZone ?? 'Sin zona';
      row.shippingZone = zoneLabel;
      const z = b.byZone.get(zoneLabel) ?? { count: 0, totalShippingCost: 0 };
      z.count++;
      z.totalShippingCost += c;
      b.byZone.set(zoneLabel, z);
      if (b.orders.length < 200) b.orders.push(row);
      groups.set(carrier, b);
    };
    // Marcos 2026-06-20: pre-cargo el cache de CP/localidad → zona
    // una sola vez por request. Lookup in-memory en bumpGroup, sin
    // round-trips por fila. Marcos 2026-06-22: el cache ahora trae
    // tres mapas (byLocalityExact / byLocalityNormalized / byCp)
    // para la cascada nueva del resolver.
    const cpZoneCache = this.postalZones ? await this.postalZones.loadCache() : null;
    for (const s of stamps) {
      if (!s.manuallyDispatchedAt) continue;
      let rawCarrier: string | null = null;
      let orderNumber: string | null = null;
      let customer: string | null = null;
      let amount: number | null = null;
      let currency: string | null = null;
      let shippingCost: number | null = null;
      let shippingZone: string | null = null;
      let postalCode: string | null = null;
      let locality: string | null = null;
      // Per-rowKey routing.
      // Marcos 2026-06-20: shippingLabel preserva el label original
      // (TN/ML), separado de rawCarrier (que puede ser override del
      // operador). Sirve al zone derivation cuando el operador picó
      // manualmente la mensajería — la zona embebida en el TN label
      // ("GBA 1 GRATIS" → GBA 1) tiene que llegar aunque el carrier
      // ya sea "JyJ".
      let shippingLabel: string | null = null;
      let m = /^(?:crm|tn):([0-9a-f-]{36})$/i.exec(s.rowKey);
      if (m) {
        const o = orderById.get(m[1]);
        if (o) {
          // Operator's flexCourier pick overrides the source-side
          // label when set (Marcos 2026-06-12 (2)): "Flex_373" → JyJ
          // gets normalised later; if the operator explicitly tagged
          // a row (e.g. picked M2 vs Baires for a GBA row) honour
          // that first.
          rawCarrier = s.flexCourier?.trim() || o.carrier || null;
          shippingLabel = o.carrier ?? null;
          orderNumber = o.orderNumber;
          customer = o.contact?.name ?? null;
          amount = o.amount;
          currency = o.currency;
          shippingCost = o.shippingCost ?? null;
          shippingZone = o.shippingZone ?? null;
          // Marcos 2026-06-20: CP del comprador desde contact.metadata.
          // Marcos 2026-06-22: localidad tambien — es el matcher
          // PRIMARIO del resolver (porque varios CPs comparten
          // codigo entre localidades de distinto precio).
          const meta = (o.contact?.metadata ?? null) as any;
          if (meta && typeof meta === 'object') {
            const cp = meta.postalCode ?? meta.codigoPostal ?? meta.cp ?? meta.zip ?? null;
            if (cp != null) postalCode = String(cp);
            const loc = meta.locality ?? meta.localidad ?? meta.city ?? meta.ciudad ?? null;
            if (loc != null) locality = String(loc);
          }
        }
      } else if (/^ml:[12](:|$)/.test(s.rowKey)) {
        rawCarrier = s.flexCourier?.trim() || 'Mercado Libre';
        orderNumber = s.rowKey;
      } else if (/^prfv:/.test(s.rowKey)) {
        rawCarrier = 'Servifibras propio';
        orderNumber = s.rowKey;
      } else {
        rawCarrier = s.flexCourier?.trim() || null;
        orderNumber = s.rowKey;
      }
      // Marcos 2026-06-29: si la normalización tira "Sin asignar"
      // (típicamente label TN del estilo "CABA GRATUITO" sin que el
      // operador haya picado mensajería), miramos el defaultCarrier
      // cargado por el admin. Doble fallback:
      //   (a) per-CP/localidad — cuando el contacto tiene metadata
      //   (b) per-zone — cuando el TN label embebe la zona
      //       ("CABA GRATUITO" → CABA) pero el contacto no tiene
      //       postalCode/locality (común en TN orders viejas)
      // El zone-level lookup usa majority vote sobre las filas de
      // postal_code_zones con defaultCarrier seteado.
      let carrier = this.normaliseCarrier(rawCarrier);
      if (carrier === 'Sin asignar' && this.postalZones && cpZoneCache) {
        // Path (a): per-CP/localidad
        const resolved = this.postalZones.resolveZone({ locality, cp: postalCode }, cpZoneCache);
        if (resolved?.defaultCarrier) {
          carrier = this.normaliseCarrier(resolved.defaultCarrier);
        } else {
          // Path (b): per-zone via label/source-derived zone
          const labelZone =
            this.deriveZoneFromShippingLabel(shippingLabel) ??
            this.deriveZoneFromShippingLabel(rawCarrier) ??
            this.provinceToZone(shippingZone) ??
            (typeof shippingZone === 'string' ? shippingZone : null);
          if (labelZone) {
            const zoneDefault = this.postalZones.getDefaultCarrierForZone(labelZone, cpZoneCache);
            if (zoneDefault) {
              carrier = this.normaliseCarrier(zoneDefault);
            }
          }
        }
      }
      // Marcos 2026-06-30 fix: el fallback Despachos Online ahora
      // solo aplica si la pista del label sugiere out-of-zone. Las
      // etiquetas CABA / GBA <N> son IN-zone y quedan "Sin asignar"
      // hasta que el operador pique o el default-per-zona se cargue.
      carrier = this.normaliseCarrier(applyOutsideZoneFallback({
        currentCarrier: carrier,
        rawCarrier,
        shippingLabel,
      }));
      bumpGroup(carrier, {
        rowKey: s.rowKey,
        orderNumber,
        customer,
        dispatchedAt: s.manuallyDispatchedAt.toISOString(),
        amount,
        currency,
        shippingCost,
        shippingZone,
        rawCarrier,
        shippingLabel,
        postalCode,
        locality,
      });
    }
    // Marcos 2026-06-15: load the tariff table once and index by
    // (carrier, zone). Per-zone count × per-package cost = estimate.
    // Misses come back as nulls so the UI can show "sin tarifa" rather
    // than an inflated total.
    const allTariffs = await this.tariffs.listActive().catch(() => []);
    const tariffIndex = new Map<string, { costPerPackage: number; currency: string }>();
    // Marcos 2026-06-16: tariff lookup is case-insensitive on both
    // carrier and zone so "JYJ" loaded by hand still matches the
    // aggregator's normalised "JyJ", and "Caba" / "CABA" / "caba"
    // all hit the same row.
    const tariffKey = (carrier: string, zone: string) => `${carrier.trim().toLowerCase()}::${zone.trim().toLowerCase()}`;
    for (const t of allTariffs) tariffIndex.set(tariffKey(t.carrier, t.zone), { costPerPackage: t.costPerPackage, currency: t.currency });

    let globalRowsWithoutTariff = 0;
    const byCarrier = Array.from(groups.entries())
      .map(([carrier, b]) => {
        let carrierEstimate: number | null = null;
        let carrierRowsWithoutTariff = 0;
        const zones = Array.from(b.byZone.entries())
          .map(([zone, z]) => {
            const tariff = tariffIndex.get(tariffKey(carrier, zone)) ?? null;
            const estimatedCost = tariff ? tariff.costPerPackage * z.count : null;
            if (tariff == null) {
              carrierRowsWithoutTariff += z.count;
            } else {
              carrierEstimate = (carrierEstimate ?? 0) + estimatedCost!;
            }
            return {
              zone,
              count: z.count,
              totalShippingCost: Math.round(z.totalShippingCost * 100) / 100,
              estimatedCost: estimatedCost != null ? Math.round(estimatedCost * 100) / 100 : null,
              tariffPerPackage: tariff?.costPerPackage ?? null,
            };
          })
          .sort((a, b) => b.count - a.count);
        globalRowsWithoutTariff += carrierRowsWithoutTariff;
        return {
          carrier,
          count: b.count,
          totalShippingCost: Math.round(b.totalShippingCost * 100) / 100,
          totalEstimatedCost: carrierEstimate != null ? Math.round(carrierEstimate * 100) / 100 : null,
          rowsWithoutTariff: carrierRowsWithoutTariff,
          byZone: zones,
          orders: b.orders,
        };
      })
      .sort((a, b) => b.count - a.count);
    const totalShippingCost = byCarrier.reduce((s, c) => s + c.totalShippingCost, 0);
    const totalEstimatedCost = byCarrier.reduce<number | null>((s, c) => {
      if (c.totalEstimatedCost == null) return s;
      return (s ?? 0) + c.totalEstimatedCost;
    }, null);
    return {
      fromIso: args.fromIso,
      toIso: args.toIso,
      total: stamps.length,
      totalShippingCost: Math.round(totalShippingCost * 100) / 100,
      totalEstimatedCost: totalEstimatedCost != null ? Math.round(totalEstimatedCost * 100) / 100 : null,
      rowsWithoutTariff: globalRowsWithoutTariff,
      byCarrier,
    };
  }

  /**
   * Marcos 2026-06-22: costo de reposiciones agrupado por
   * responsable del paquete mal despachado. Sirve para que ADMIN vea
   * cuánto dinero perdió cada operador del depósito en cada ventana
   * de tiempo (semana / mes / personalizado).
   *
   * - Sólo cuenta pedidos con orderType=REPOSICION (los que tienen un
   *   responsable cargado).
   * - El "costo" es el shippingCost del pedido (la logística que
   *   Servifibras paga porque hubo que re-despachar).
   * - Reposiciones sin responsable cargado caen en bucket "(sin asignar)"
   *   con responsibleId=null — Marcos las puede revisar y asignarlas
   *   manualmente desde el detalle del pedido.
   */
  async getReposicionCostByResponsible(args: { fromIso: string; toIso: string }): Promise<{
    fromIso: string;
    toIso: string;
    total: number;
    totalCost: number;
    currency: string;
    byResponsible: Array<{
      responsibleId: string | null;
      name: string;
      count: number;
      totalCost: number;
    }>;
  }> {
    const from = new Date(args.fromIso);
    const to = new Date(args.toIso);
    const rows = await this.prisma.order.findMany({
      where: {
        orderType: 'REPOSICION' as any,
        createdAt: { gte: from, lte: to },
      },
      select: {
        id: true,
        shippingCost: true,
        currency: true,
        responsibleId: true,
        responsible: { select: { name: true } },
        // Marcos 2026-06-23: SIN DEVOLUCION (returnState=NONE)
        // suma productValue al panel del responsable porque el
        // producto queda en el cliente y eso es costo del error.
        // CON DEVOLUCION + RETURNED no suma (se recupera). CON
        // DEVOLUCION + LOST tampoco — ese valor va a "cobrar a
        // mensajería" (otro reporte, ver getLostProductsByCarrier).
        returnState: true,
        productValue: true,
        // Marcos 2026-07-03: el drill-down expone el costo del
        // retorno; también debe entrar al total del responsable
        // para que "suma de rows = total del responsable" cierre.
        returnShippingCost: true,
      },
    });
    const acc = new Map<string, { responsibleId: string | null; name: string; count: number; totalCost: number }>();
    for (const r of rows) {
      const key = r.responsibleId ?? '__none__';
      const name = r.responsibleId
        ? (r.responsible?.name ?? '(eliminado)')
        : '(sin asignar)';
      const prev = acc.get(key) ?? { responsibleId: r.responsibleId, name, count: 0, totalCost: 0 };
      prev.count++;
      prev.totalCost += typeof r.shippingCost === 'number' ? r.shippingCost : 0;
      // Marcos 2026-07-03: costo del retorno también es costo del
      // error — se cuenta cuando existe (aplica a CON DEVOLUCION,
      // cualquier returnState). El drill-down muestra el mismo
      // valor para que las sumas coincidan.
      if (typeof r.returnShippingCost === 'number') {
        prev.totalCost += r.returnShippingCost;
      }
      // SIN DEVOLUCION → product value queda en cliente → costo del responsable
      if ((r.returnState as any) === 'NONE' && typeof r.productValue === 'number') {
        prev.totalCost += r.productValue;
      }
      acc.set(key, prev);
    }
    const byResponsible = Array.from(acc.values())
      .map((v) => ({ ...v, totalCost: Math.round(v.totalCost * 100) / 100 }))
      .sort((a, b) => b.totalCost - a.totalCost);
    const totalCost = byResponsible.reduce((s, r) => s + r.totalCost, 0);
    return {
      fromIso: args.fromIso,
      toIso: args.toIso,
      total: rows.length,
      totalCost: Math.round(totalCost * 100) / 100,
      currency: 'ARS',
      byResponsible,
    };
  }

  /**
   * Marcos 2026-07-03: drill-down del widget "Costo de reposiciones
   * por responsable". Devuelve las órdenes concretas que componen el
   * total de un responsable en el rango — es lo que se muestra al
   * expandir el acordeón. Objetivo: número del dashboard auditable.
   *
   * Filtro: mismo rango que el summary + responsibleId (o null para
   * "(sin asignar)"). Cada row incluye el desglose (ida, retorno,
   * valor del paquete cuando aplica) y su total. La suma de los
   * totales de las rows == totalCost del responsable en el summary.
   */
  async getReposicionOrdersByResponsible(args: {
    responsibleId: string | null;
    fromIso: string;
    toIso: string;
  }): Promise<{
    responsibleId: string | null;
    name: string;
    fromIso: string;
    toIso: string;
    total: number;
    totalCost: number;
    currency: string;
    orders: Array<{
      id: string;
      orderNumber: string;
      createdAt: Date;
      contact: { id: string; name: string | null };
      productLabel: string | null;
      errorReason: string | null;
      errorReasonNote: string | null;
      shippingCost: number | null;         // costo ida
      returnShippingCost: number | null;   // costo retorno
      productValue: number | null;         // valor del paquete (cuenta cuando NONE)
      returnState: string;
      rowTotal: number;                    // ida + retorno + (valor si NONE)
    }>;
  }> {
    const from = new Date(args.fromIso);
    const to = new Date(args.toIso);

    const where: any = {
      orderType: 'REPOSICION' as any,
      createdAt: { gte: from, lte: to },
    };
    if (args.responsibleId === null) {
      where.responsibleId = null;
    } else {
      where.responsibleId = args.responsibleId;
    }

    const rows = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        productLabel: true,
        errorReason: true,
        errorReasonNote: true,
        shippingCost: true,
        returnShippingCost: true,
        returnState: true,
        productValue: true,
        contact: { select: { id: true, name: true } },
        responsible: { select: { id: true, name: true } },
      },
    });

    let name = '(sin asignar)';
    if (args.responsibleId) {
      const first = rows.find((r) => r.responsible?.name);
      if (first?.responsible?.name) name = first.responsible.name;
      else name = '(eliminado)';
    }

    const orders = rows.map((r) => {
      const ida = typeof r.shippingCost === 'number' ? r.shippingCost : 0;
      const retorno = typeof r.returnShippingCost === 'number' ? r.returnShippingCost : 0;
      const valor =
        (r.returnState as any) === 'NONE' && typeof r.productValue === 'number' ? r.productValue : 0;
      const rowTotal = Math.round((ida + retorno + valor) * 100) / 100;
      return {
        id: r.id,
        orderNumber: r.orderNumber,
        createdAt: r.createdAt,
        contact: { id: r.contact.id, name: r.contact.name ?? null },
        productLabel: r.productLabel ?? null,
        errorReason: (r.errorReason as any) ?? null,
        errorReasonNote: r.errorReasonNote ?? null,
        shippingCost: r.shippingCost ?? null,
        returnShippingCost: r.returnShippingCost ?? null,
        productValue: r.productValue ?? null,
        returnState: r.returnState as string,
        rowTotal,
      };
    });

    const totalCost = orders.reduce((s, o) => s + o.rowTotal, 0);
    return {
      responsibleId: args.responsibleId,
      name,
      fromIso: args.fromIso,
      toIso: args.toIso,
      total: orders.length,
      totalCost: Math.round(totalCost * 100) / 100,
      currency: 'ARS',
      orders,
    };
  }

  /**
   * Marcos 2026-06-23: productos perdidos (returnState=LOST) agrupados
   * por la mensajería responsable del retorno. Sirve para que ADMIN
   * vea cuánto dinero hay para reclamar a cada courier.
   */
  async getLostProductsByCarrier(args: { fromIso: string; toIso: string }): Promise<{
    fromIso: string;
    toIso: string;
    total: number;
    totalToCollect: number;
    currency: string;
    byCarrier: Array<{ carrier: string; count: number; totalToCollect: number }>;
  }> {
    const from = new Date(args.fromIso);
    const to = new Date(args.toIso);
    const rows = await this.prisma.order.findMany({
      where: {
        returnState: 'LOST' as any,
        lostAt: { gte: from, lte: to },
        status: { notIn: ['CANCELLED'] as any },
      },
      select: {
        id: true,
        carrier: true,
        returnCarrier: true,
        productValue: true,
        amount: true,
        products: true,
        orderType: true,
      },
    });
    const acc = new Map<string, { carrier: string; count: number; totalToCollect: number }>();
    for (const r of rows) {
      // Para REPOSICION usamos returnCarrier (la mensajería del retorno).
      // Para DEVOLUCION usamos `carrier` (la única — es la que tenía
      // que traer el paquete y no lo trajo).
      const carrier = (r.orderType === 'REPOSICION' ? r.returnCarrier : r.carrier) || '(sin mensajería)';
      // Valor preferido: productValue explicito; si no, suma de líneas; si no, amount.
      let value = typeof r.productValue === 'number' && r.productValue > 0 ? r.productValue : 0;
      if (value === 0) {
        const products = Array.isArray(r.products) ? (r.products as any[]) : [];
        const lineSum = products.reduce((sum, p: any) => {
          const qty = Number(p?.quantity ?? 0);
          const unit = Number(p?.unitPrice ?? 0);
          if (!Number.isFinite(qty) || !Number.isFinite(unit)) return sum;
          return sum + qty * unit;
        }, 0);
        value = lineSum > 0 ? lineSum : (typeof r.amount === 'number' && r.amount > 0 ? r.amount : 0);
      }
      const prev = acc.get(carrier) ?? { carrier, count: 0, totalToCollect: 0 };
      prev.count++;
      prev.totalToCollect += value;
      acc.set(carrier, prev);
    }
    const byCarrier = Array.from(acc.values())
      .map((v) => ({ ...v, totalToCollect: Math.round(v.totalToCollect * 100) / 100 }))
      .sort((a, b) => b.totalToCollect - a.totalToCollect);
    const totalToCollect = byCarrier.reduce((s, r) => s + r.totalToCollect, 0);
    return {
      fromIso: args.fromIso,
      toIso: args.toIso,
      total: rows.length,
      totalToCollect: Math.round(totalToCollect * 100) / 100,
      currency: 'ARS',
      byCarrier,
    };
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}

function labelForAccountKey(key: string | null): string {
  if (key === 'mercadolibre') return 'Cuenta 1';
  if (key === 'mercadolibre_cuenta2') return 'Cuenta 2';
  if (!key) return 'Sin cuenta tag (legacy)';
  return key;
}

function keyOrder(key: string | null): number {
  if (key === 'mercadolibre') return 0;
  if (key === 'mercadolibre_cuenta2') return 1;
  return 100;
}
