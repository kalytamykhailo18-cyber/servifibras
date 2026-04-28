/**
 * ADAPTERS LAYER - Analytics Service
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, Channel, ConversationStatus, MessageSender } from '@prisma/client';
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

  constructor() {
    this.prisma = new PrismaClient();
    this.logger.log('✅ Analytics service initialized');
  }

  async getDashboardSummary(): Promise<DashboardSummary> {
    try {
      const [conversationMetrics, contactMetrics, aiPerformanceMetrics, knowledgeByCategory] =
        await Promise.all([
          this.getConversationMetrics(),
          this.getContactMetrics(),
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

      const [conversationsLast24h, messagesLast24h, newContactsLast24h] =
        await Promise.all([
          this.prisma.conversation.count({
            where: { createdAt: { gte: twentyFourHoursAgo } },
          }),
          this.prisma.message.count({
            where: { timestamp: { gte: twentyFourHoursAgo } },
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

  async getConversationMetrics(timeRange?: TimeRange): Promise<ConversationMetrics> {
    try {
      const where: any = {};
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
              createdAt: {
                gte: date,
                lt: nextDate,
              },
            },
          }),
          this.prisma.conversation.count({
            where: {
              createdAt: { gte: date, lt: nextDate },
              status: ConversationStatus.ACTIVE,
            },
          }),
          this.prisma.conversation.count({
            where: {
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

  async getContactMetrics(): Promise<ContactMetrics> {
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
        this.prisma.contact.count(),
        this.prisma.contact.count({ where: { createdAt: { gte: startOfDay } } }),
        this.prisma.contact.count({ where: { createdAt: { gte: startOfWeek } } }),
        this.prisma.contact.count({ where: { createdAt: { gte: startOfMonth } } }),
        this.prisma.contact.groupBy({
          by: ['channel'],
          _count: true,
        }),
        this.prisma.contact.count({
          where: {
            conversations: {
              some: {
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
      const where: any = {};
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
      const where: any = {};
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
                conversation: { channel },
                isFromAI: true,
              },
            }),
            this.prisma.message.count({
              where: {
                conversation: { channel },
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
              createdAt: {
                gte: date,
                lt: nextDate,
              },
            },
          });
        } else if (metric === 'messages') {
          value = await this.prisma.message.count({
            where: {
              timestamp: {
                gte: date,
                lt: nextDate,
              },
            },
          });
        } else if (metric === 'contacts') {
          value = await this.prisma.contact.count({
            where: {
              createdAt: {
                gte: date,
                lt: nextDate,
              },
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

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
