/**
 * ADAPTERS LAYER - Contact Management Service
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, Channel, ConversationStatus, UserRole } from '@prisma/client';
import {
  IContactManagementService,
  ContactListFilter,
  ContactDetails,
  CreateContactInput,
  UpdateContactInput,
  ContactStatistics,
} from '../../use-cases/admin/contact-management.interface';
import { RequestScope } from '../../use-cases/admin/conversation-management.interface';
import { getMessageCipher } from '../security/message-cipher';

// Build the Prisma `where` clause for embedded conversations under a contact,
// using the same scoping as the conversations list endpoint:
//   ADMIN — no filter
//   ATENCION — assigned to me OR unassigned
//   VENTAS / LOGISTICA — assigned to me only
function conversationScope(scope?: RequestScope) {
  if (!scope || scope.role === UserRole.ADMIN) return {};
  if (scope.role === UserRole.ATENCION) {
    return { OR: [{ assignedTo: scope.userId }, { assignedTo: null }] };
  }
  return { assignedTo: scope.userId };
}

// Leads: ADMIN sees all; VENTAS sees own + unassigned; others can't see leads
// at all (we return [] in the service rather than letting Prisma filter).
function leadScope(scope?: RequestScope): { skip: boolean; where: any } {
  if (!scope || scope.role === UserRole.ADMIN) return { skip: false, where: {} };
  if (scope.role === UserRole.VENTAS) {
    return { skip: false, where: { OR: [{ assignedTo: scope.userId }, { assignedTo: null }] } };
  }
  return { skip: true, where: {} };
}

// Orders: ADMIN/LOGISTICA see all; everyone else hidden.
function ordersHidden(scope?: RequestScope): boolean {
  if (!scope) return false;
  return scope.role !== UserRole.ADMIN && scope.role !== UserRole.LOGISTICA;
}

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
      // Sandbox contacts (created by "Probar como cliente") are excluded
      // from every operator-facing contact surface.
      const where: any = { isSandbox: false };

      if (filter.channel) {
        where.channel = filter.channel;
      }
      if (filter.customerType) {
        where.customerType = filter.customerType;
      }
      if (filter.funnelStage) {
        where.funnelStage = filter.funnelStage;
      }

      if (filter.search) {
        // Marcos 2026-06-22: el picker del form de pedidos sólo
        // mostraba los últimos 200 contactos y filtraba in-memory por
        // nombre. Ahora la búsqueda viaja al backend y matchea contra
        // name / phone / email + DNI / CUIT que viven en contact.metadata
        // (string_contains case-sensitive en JSON, pero los DNIs son
        // numéricos así que no afecta).
        where.OR = [
          { name: { contains: filter.search, mode: 'insensitive' } },
          { phone: { contains: filter.search, mode: 'insensitive' } },
          { email: { contains: filter.search, mode: 'insensitive' } },
          { metadata: { path: ['fiscalId'], string_contains: filter.search } as any },
          { metadata: { path: ['cuit'], string_contains: filter.search } as any },
          { metadata: { path: ['dni'], string_contains: filter.search } as any },
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
          customerType: contact.customerType ?? null,
          funnelStage: contact.funnelStage ?? null,
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

  async getContactById(contactId: string, scope?: RequestScope): Promise<ContactDetails | null> {
    try {
      const lScope = leadScope(scope);
      const hideOrders = ordersHidden(scope);
      const contact = await this.prisma.contact.findUnique({
        where: { id: contactId },
        include: {
          conversations: {
            where: conversationScope(scope),
            orderBy: { updatedAt: 'desc' },
            include: {
              assigned: { select: { id: true, name: true } },
              _count: { select: { messages: true } },
            },
          },
          leads: lScope.skip
            ? false
            : {
                where: lScope.where,
                orderBy: { createdAt: 'desc' },
                include: { assigned: { select: { id: true, name: true } } },
              },
          orders: hideOrders
            ? false
            : {
                orderBy: { createdAt: 'desc' },
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
        customerType: contact.customerType ?? null,
        funnelStage: contact.funnelStage ?? null,
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
        conversations: (contact.conversations ?? []).map((c) => ({
          id: c.id,
          channel: c.channel,
          status: c.status,
          lastMessage: getMessageCipher().decrypt(c.lastMessage ?? ''),
          lastMessageAt: c.lastMessageAt,
          isUnread: c.isUnread,
          messageCount: c._count.messages,
          assigned: c.assigned ? { id: c.assigned.id, name: c.assigned.name } : null,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        })),
        leads: lScope.skip
          ? []
          : ((contact as any).leads ?? []).map((l: any) => ({
              id: l.id,
              status: l.status,
              source: l.source,
              productInterest: l.productInterest,
              estimatedValue: l.estimatedValue,
              wonAmount: l.wonAmount,
              assigned: l.assigned ? { id: l.assigned.id, name: l.assigned.name } : null,
              createdAt: l.createdAt,
              updatedAt: l.updatedAt,
            })),
        orders: hideOrders
          ? []
          : ((contact as any).orders ?? []).map((o: any) => ({
              id: o.id,
              orderNumber: o.orderNumber,
              status: o.status,
              amount: o.amount,
              currency: o.currency,
              createdAt: o.createdAt,
              updatedAt: o.updatedAt,
            })),
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
        customerType: contact.customerType ?? null,
        funnelStage: contact.funnelStage ?? null,
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
      if (input.customerType !== undefined) updateData.customerType = input.customerType;
      if (input.funnelStage !== undefined) updateData.funnelStage = input.funnelStage;

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
        customerType: contact.customerType ?? null,
        funnelStage: contact.funnelStage ?? null,
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
          isSandbox: false,
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
          customerType: contact.customerType ?? null,
          funnelStage: contact.funnelStage ?? null,
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
          this.prisma.contact.count({ where: { isSandbox: false } }),
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
          this.prisma.contact.count({
            where: { isSandbox: false, createdAt: { gte: startOfDay } },
          }),
          this.prisma.contact.count({
            where: { isSandbox: false, createdAt: { gte: startOfWeek } },
          }),
          this.prisma.contact.count({
            where: { isSandbox: false, createdAt: { gte: startOfMonth } },
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
