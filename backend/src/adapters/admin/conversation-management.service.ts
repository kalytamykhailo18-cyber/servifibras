/**
 * ADAPTERS LAYER - Conversation Management Service
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, Channel, ConversationStatus, MessageSender } from '@prisma/client';
import {
  IConversationManagementService,
  ConversationListFilter,
  ConversationDetails,
} from '../../use-cases/admin/conversation-management.interface';

@Injectable()
export class ConversationManagementService implements IConversationManagementService {
  private readonly logger = new Logger(ConversationManagementService.name);
  private readonly prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
    this.logger.log('✅ Conversation Management service initialized');
  }

  async listConversations(filter: ConversationListFilter): Promise<{
    conversations: ConversationDetails[];
    total: number;
  }> {
    try {
      const where: any = {};

      if (filter.channel) {
        where.channel = filter.channel;
      }

      if (filter.status) {
        where.status = filter.status;
      }

      if (filter.assignedToUserId) {
        where.assignedTo = filter.assignedToUserId;
      }

      if (filter.search) {
        where.OR = [
          { contact: { name: { contains: filter.search, mode: 'insensitive' } } },
          { lastMessage: { contains: filter.search, mode: 'insensitive' } },
        ];
      }

      const limit = filter.limit || 50;
      const offset = filter.offset || 0;

      const [conversations, total] = await Promise.all([
        this.prisma.conversation.findMany({
          where,
          include: {
            contact: true,
            assigned: true,
            messages: {
              orderBy: { timestamp: 'desc' },
              take: 1,
            },
            _count: {
              select: { messages: true },
            },
          },
          orderBy: { updatedAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        this.prisma.conversation.count({ where }),
      ]);

      const conversationDetails: ConversationDetails[] = conversations.map((conv) => ({
        id: conv.id,
        contact: {
          id: conv.contact.id,
          name: conv.contact.name,
          phone: conv.contact.phone,
          email: conv.contact.email,
          channel: conv.contact.channel,
        },
        channel: conv.channel,
        status: conv.status,
        assignedTo: conv.assigned
          ? {
              id: conv.assigned.id,
              name: conv.assigned.name,
            }
          : null,
        lastMessage: conv.lastMessage,
        messageCount: conv._count.messages,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messages: [], // Messages loaded separately in getConversationById
      }));

      return {
        conversations: conversationDetails,
        total,
      };
    } catch (error: any) {
      this.logger.error(`Error listing conversations: ${error.message}`);
      return { conversations: [], total: 0 };
    }
  }

  async getConversationById(conversationId: string): Promise<ConversationDetails | null> {
    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          contact: true,
          assigned: true,
          messages: {
            orderBy: { timestamp: 'asc' },
          },
          _count: {
            select: { messages: true },
          },
        },
      });

      if (!conversation) {
        return null;
      }

      return {
        id: conversation.id,
        contact: {
          id: conversation.contact.id,
          name: conversation.contact.name,
          phone: conversation.contact.phone,
          email: conversation.contact.email,
          channel: conversation.contact.channel,
        },
        channel: conversation.channel,
        status: conversation.status,
        assignedTo: conversation.assigned
          ? {
              id: conversation.assigned.id,
              name: conversation.assigned.name,
            }
          : null,
        lastMessage: conversation.lastMessage,
        messageCount: conversation._count.messages,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: conversation.messages.map((msg) => ({
          id: msg.id,
          content: msg.content,
          sender: msg.sender,
          isFromAI: msg.isFromAI,
          timestamp: msg.timestamp,
        })),
      };
    } catch (error: any) {
      this.logger.error(`Error getting conversation: ${error.message}`);
      return null;
    }
  }

  async assignConversation(conversationId: string, userId: string): Promise<boolean> {
    try {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          assignedTo: userId,
          status: ConversationStatus.ACTIVE,
        },
      });

      this.logger.log(`✅ Conversation ${conversationId} assigned to user ${userId}`);
      return true;
    } catch (error: any) {
      this.logger.error(`Error assigning conversation: ${error.message}`);
      return false;
    }
  }

  async updateConversationStatus(
    conversationId: string,
    status: ConversationStatus,
  ): Promise<boolean> {
    try {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { status },
      });

      this.logger.log(`✅ Conversation ${conversationId} status updated to ${status}`);
      return true;
    } catch (error: any) {
      this.logger.error(`Error updating conversation status: ${error.message}`);
      return false;
    }
  }

  async sendManualMessage(
    conversationId: string,
    userId: string,
    content: string,
  ): Promise<boolean> {
    try {
      // Create message from human agent (using ADMIN as generic agent sender)
      await this.prisma.message.create({
        data: {
          conversationId,
          sender: MessageSender.ADMIN,
          content,
          isFromAI: false,
        },
      });

      // Update conversation
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessage: content,
          assignedTo: userId,
          status: ConversationStatus.ACTIVE,
        },
      });

      this.logger.log(`✅ Manual message sent in conversation ${conversationId}`);
      return true;
    } catch (error: any) {
      this.logger.error(`Error sending manual message: ${error.message}`);
      return false;
    }
  }

  async getStatistics(): Promise<{
    total: number;
    byChannel: Record<Channel, number>;
    byStatus: Record<ConversationStatus, number>;
    activeToday: number;
  }> {
    try {
      const [total, byChannel, byStatus, activeToday] = await Promise.all([
        this.prisma.conversation.count(),
        this.prisma.conversation.groupBy({
          by: ['channel'],
          _count: true,
        }),
        this.prisma.conversation.groupBy({
          by: ['status'],
          _count: true,
        }),
        this.prisma.conversation.count({
          where: {
            updatedAt: {
              gte: new Date(new Date().setHours(0, 0, 0, 0)),
            },
          },
        }),
      ]);

      const channelStats: Record<Channel, number> = {} as any;
      byChannel.forEach((item) => {
        channelStats[item.channel] = item._count;
      });

      const statusStats: Record<ConversationStatus, number> = {} as any;
      byStatus.forEach((item) => {
        statusStats[item.status] = item._count;
      });

      return {
        total,
        byChannel: channelStats,
        byStatus: statusStats,
        activeToday,
      };
    } catch (error: any) {
      this.logger.error(`Error getting statistics: ${error.message}`);
      return {
        total: 0,
        byChannel: {} as any,
        byStatus: {} as any,
        activeToday: 0,
      };
    }
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
