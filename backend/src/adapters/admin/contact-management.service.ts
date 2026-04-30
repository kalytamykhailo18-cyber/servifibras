/**
 * ADAPTERS LAYER - Contact Management Service
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, Channel, ConversationStatus } from '@prisma/client';
import {
  IContactManagementService,
  ContactListFilter,
  ContactDetails,
  CreateContactInput,
  UpdateContactInput,
  ContactStatistics,
} from '../../use-cases/admin/contact-management.interface';

@Injectable()
export class ContactManagementService implements IContactManagementService {
  private readonly logger = new Logger(ContactManagementService.name);
  private readonly prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
    this.logger.log('✅ Contact Management service initialized');
  }

  async listContacts(filter: ContactListFilter): Promise<{
    contacts: ContactDetails[];
    total: number;
  }> {
    try {
      const where: any = {};

      if (filter.channel) {
        where.channel = filter.channel;
      }

      if (filter.search) {
        where.OR = [
          { name: { contains: filter.search, mode: 'insensitive' } },
          { phone: { contains: filter.search, mode: 'insensitive' } },
          { email: { contains: filter.search, mode: 'insensitive' } },
        ];
      }

      if (filter.hasActiveConversation !== undefined) {
        if (filter.hasActiveConversation) {
          where.conversations = {
            some: {
              status: {
                in: [ConversationStatus.ACTIVE, ConversationStatus.WAITING],
              },
            },
          };
        } else {
          where.conversations = {
            none: {
              status: {
                in: [ConversationStatus.ACTIVE, ConversationStatus.WAITING],
              },
            },
          };
        }
      }

      const limit = filter.limit || 50;
      const offset = filter.offset || 0;

      const [contacts, total] = await Promise.all([
        this.prisma.contact.findMany({
          where,
          include: {
            conversations: {
              orderBy: { updatedAt: 'desc' },
              take: 1,
              include: {
                _count: {
                  select: { messages: true },
                },
              },
            },
            _count: {
              select: { conversations: true },
            },
          },
          orderBy: { updatedAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        this.prisma.contact.count({ where }),
      ]);

      const contactDetails: ContactDetails[] = contacts.map((contact) => {
        const latestConversation = contact.conversations[0];

        return {
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          type: contact.type,
          channel: contact.channel,
          metadata: (contact.metadata as Record<string, any>) || {},
          createdAt: contact.createdAt,
          updatedAt: contact.updatedAt,
          conversationCount: contact._count.conversations,
          lastConversationDate: latestConversation?.updatedAt || null,
          activeConversation: latestConversation
            ? {
                id: latestConversation.id,
                status: latestConversation.status,
                lastMessage: latestConversation.lastMessage,
                updatedAt: latestConversation.updatedAt,
              }
            : null,
        };
      });

      return {
        contacts: contactDetails,
        total,
      };
    } catch (error: any) {
      this.logger.error(`Error listing contacts: ${error.message}`);
      return { contacts: [], total: 0 };
    }
  }

  async getContactById(contactId: string): Promise<ContactDetails | null> {
    try {
      const contact = await this.prisma.contact.findUnique({
        where: { id: contactId },
        include: {
          conversations: {
            orderBy: { updatedAt: 'desc' },
            take: 1,
          },
          _count: {
            select: { conversations: true },
          },
        },
      });

      if (!contact) {
        return null;
      }

      const latestConversation = contact.conversations[0];

      return {
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
          type: contact.type,
        channel: contact.channel,
        metadata: (contact.metadata as Record<string, any>) || {},
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
        conversationCount: contact._count.conversations,
        lastConversationDate: latestConversation?.updatedAt || null,
        activeConversation: latestConversation
          ? {
              id: latestConversation.id,
              status: latestConversation.status,
              lastMessage: latestConversation.lastMessage,
              updatedAt: latestConversation.updatedAt,
            }
          : null,
      };
    } catch (error: any) {
      this.logger.error(`Error getting contact: ${error.message}`);
      return null;
    }
  }

  async createContact(input: CreateContactInput): Promise<ContactDetails | null> {
    try {
      const contact = await this.prisma.contact.create({
        data: {
          name: input.name ?? null,
          phone: input.phone || null,
          email: input.email || null,
          type: input.type, // undefined → Prisma default MINORISTA
          channel: input.channel ?? null,
          metadata: input.metadata || {},
        },
        include: {
          _count: {
            select: { conversations: true },
          },
        },
      });

      this.logger.log(`✅ Contact created: ${contact.name} (${contact.channel})`);

      return {
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
          type: contact.type,
        channel: contact.channel,
        metadata: (contact.metadata as Record<string, any>) || {},
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
        conversationCount: 0,
        lastConversationDate: null,
        activeConversation: null,
      };
    } catch (error: any) {
      this.logger.error(`Error creating contact: ${error.message}`);
      return null;
    }
  }

  async updateContact(
    contactId: string,
    input: UpdateContactInput,
  ): Promise<ContactDetails | null> {
    try {
      const updateData: any = {};

      if (input.name !== undefined) updateData.name = input.name;
      if (input.phone !== undefined) updateData.phone = input.phone;
      if (input.email !== undefined) updateData.email = input.email;
      if (input.metadata !== undefined) updateData.metadata = input.metadata;

      const contact = await this.prisma.contact.update({
        where: { id: contactId },
        data: updateData,
        include: {
          conversations: {
            orderBy: { updatedAt: 'desc' },
            take: 1,
          },
          _count: {
            select: { conversations: true },
          },
        },
      });

      this.logger.log(`✅ Contact updated: ${contact.id}`);

      const latestConversation = contact.conversations[0];

      return {
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
          type: contact.type,
        channel: contact.channel,
        metadata: (contact.metadata as Record<string, any>) || {},
        createdAt: contact.createdAt,
        updatedAt: contact.updatedAt,
        conversationCount: contact._count.conversations,
        lastConversationDate: latestConversation?.updatedAt || null,
        activeConversation: latestConversation
          ? {
              id: latestConversation.id,
              status: latestConversation.status,
              lastMessage: latestConversation.lastMessage,
              updatedAt: latestConversation.updatedAt,
            }
          : null,
      };
    } catch (error: any) {
      this.logger.error(`Error updating contact: ${error.message}`);
      return null;
    }
  }

  async deleteContact(contactId: string): Promise<boolean> {
    try {
      // Check if contact has active conversations
      const activeConversations = await this.prisma.conversation.count({
        where: {
          contactId,
          status: {
            in: [ConversationStatus.ACTIVE, ConversationStatus.WAITING],
          },
        },
      });

      if (activeConversations > 0) {
        this.logger.warn(
          `Cannot delete contact ${contactId}: has ${activeConversations} active conversations`,
        );
        return false;
      }

      // Delete all messages in conversations for this contact
      await this.prisma.message.deleteMany({
        where: {
          conversation: {
            contactId,
          },
        },
      });

      // Delete all conversations for this contact
      await this.prisma.conversation.deleteMany({
        where: {
          contactId,
        },
      });

      // Delete the contact
      await this.prisma.contact.delete({
        where: { id: contactId },
      });

      this.logger.log(`✅ Contact deleted: ${contactId}`);
      return true;
    } catch (error: any) {
      this.logger.error(`Error deleting contact: ${error.message}`);
      return false;
    }
  }

  async searchContacts(query: string, limit?: number): Promise<ContactDetails[]> {
    try {
      const contacts = await this.prisma.contact.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: {
          conversations: {
            orderBy: { updatedAt: 'desc' },
            take: 1,
          },
          _count: {
            select: { conversations: true },
          },
        },
        take: limit || 20,
        orderBy: { updatedAt: 'desc' },
      });

      return contacts.map((contact) => {
        const latestConversation = contact.conversations[0];

        return {
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          email: contact.email,
          type: contact.type,
          channel: contact.channel,
          metadata: (contact.metadata as Record<string, any>) || {},
          createdAt: contact.createdAt,
          updatedAt: contact.updatedAt,
          conversationCount: contact._count.conversations,
          lastConversationDate: latestConversation?.updatedAt || null,
          activeConversation: latestConversation
            ? {
                id: latestConversation.id,
                status: latestConversation.status,
                lastMessage: latestConversation.lastMessage,
                updatedAt: latestConversation.updatedAt,
              }
            : null,
        };
      });
    } catch (error: any) {
      this.logger.error(`Error searching contacts: ${error.message}`);
      return [];
    }
  }

  async getStatistics(): Promise<ContactStatistics> {
    try {
      const now = new Date();
      const startOfDay = new Date(now.setHours(0, 0, 0, 0));
      const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const [total, byChannel, withActiveConversations, createdToday, createdThisWeek, createdThisMonth] =
        await Promise.all([
          this.prisma.contact.count(),
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
          this.prisma.contact.count({
            where: {
              createdAt: {
                gte: startOfDay,
              },
            },
          }),
          this.prisma.contact.count({
            where: {
              createdAt: {
                gte: startOfWeek,
              },
            },
          }),
          this.prisma.contact.count({
            where: {
              createdAt: {
                gte: startOfMonth,
              },
            },
          }),
        ]);

      const channelStats: Record<Channel, number> = {} as any;
      byChannel.forEach((item) => {
        channelStats[item.channel] = item._count;
      });

      return {
        total,
        byChannel: channelStats,
        withActiveConversations,
        createdToday,
        createdThisWeek,
        createdThisMonth,
      };
    } catch (error: any) {
      this.logger.error(`Error getting statistics: ${error.message}`);
      return {
        total: 0,
        byChannel: {} as any,
        withActiveConversations: 0,
        createdToday: 0,
        createdThisWeek: 0,
        createdThisMonth: 0,
      };
    }
  }

  async mergeContacts(
    primaryContactId: string,
    duplicateContactId: string,
  ): Promise<boolean> {
    try {
      // Get both contacts
      const [primary, duplicate] = await Promise.all([
        this.prisma.contact.findUnique({ where: { id: primaryContactId } }),
        this.prisma.contact.findUnique({ where: { id: duplicateContactId } }),
      ]);

      if (!primary || !duplicate) {
        this.logger.error('One or both contacts not found');
        return false;
      }

      // Merge metadata
      const mergedMetadata = {
        ...(duplicate.metadata as object),
        ...(primary.metadata as object),
      };

      // Update primary contact with merged data
      await this.prisma.contact.update({
        where: { id: primaryContactId },
        data: {
          phone: primary.phone || duplicate.phone,
          email: primary.email || duplicate.email,
          metadata: mergedMetadata,
        },
      });

      // Move all conversations from duplicate to primary
      await this.prisma.conversation.updateMany({
        where: { contactId: duplicateContactId },
        data: { contactId: primaryContactId },
      });

      // Delete duplicate contact
      await this.prisma.contact.delete({
        where: { id: duplicateContactId },
      });

      this.logger.log(
        `✅ Contacts merged: ${duplicateContactId} → ${primaryContactId}`,
      );
      return true;
    } catch (error: any) {
      this.logger.error(`Error merging contacts: ${error.message}`);
      return false;
    }
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
