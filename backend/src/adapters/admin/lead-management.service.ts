import { Injectable } from '@nestjs/common';
import { PrismaClient, LeadStatus } from '@prisma/client';
import {
  ILeadManagementService,
  LeadListFilter,
  LeadDetails,
  CreateLeadData,
  UpdateLeadData,
  LeadPipelineStats,
} from '../../use-cases/admin/lead-management.interface';
import { UserRole } from '../../domain/entities/auth.entity';
import { ContactDimensionsService } from '../lead-detection/contact-dimensions.service';

@Injectable()
export class LeadManagementService implements ILeadManagementService {
  private prisma: PrismaClient;

  constructor(private readonly contactDimensions: ContactDimensionsService) {
    this.prisma = new PrismaClient();
  }

  async listLeads(filter: LeadListFilter): Promise<{
    data: LeadDetails[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const {
      status,
      assignedToUserId,
      source,
      contactId,
      limit = 20,
      offset = 0,
    } = filter;

    const where: any = {};
    if (status) where.status = status;
    if (assignedToUserId) where.assignedTo = assignedToUserId;
    if (source) where.source = source;
    if (contactId) where.contactId = contactId;

    // Role-based scoping. Admin sees all. VENTAS sees their assigned leads
    // plus unassigned (newly detected mayoristas before auto-routing).
    if (filter.scope && filter.scope.role !== UserRole.ADMIN) {
      const me = filter.scope.userId;
      where.OR = [
        ...(where.OR ?? []),
        { assignedTo: me },
        { assignedTo: null },
      ];
    }

    const [leads, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        include: {
          contact: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              type: true,
            },
          },
          assigned: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      data: leads as LeadDetails[],
      total,
      limit,
      offset,
    };
  }

  async getLeadById(
    leadId: string,
    scope?: { userId: string; role: UserRole },
  ): Promise<LeadDetails | null> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            type: true,
          },
        },
        assigned: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!lead) return null;

    // Per-record scope: VENTAS sees their assigned leads + unassigned ones
    // (the mayorista queue). ADMIN sees everything. Mirror the list-level
    // rule so a deep-link to a lead Franco doesn't own returns 404, not
    // a leak.
    if (scope && scope.role !== UserRole.ADMIN) {
      const owns = lead.assignedTo === scope.userId;
      const unassigned = lead.assignedTo === null;
      if (!(owns || unassigned)) {
        return null;
      }
    }

    // Legacy backfill — leads created before the `sourceConversationId`
    // column existed don't carry it. Best-effort resolve: latest
    // conversation on the same channel for this contact. This lets
    // Marcos's "Ir a la conversación" deep-link work on every lead, not
    // just ones created after the migration.
    if (!lead.sourceConversationId) {
      const fallback = await this.prisma.conversation.findFirst({
        where: { contactId: lead.contactId, channel: lead.source },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      if (fallback) {
        (lead as any).sourceConversationId = fallback.id;
      }
    }

    return lead as LeadDetails | null;
  }

  async createLead(data: CreateLeadData): Promise<LeadDetails> {
    const lead = await this.prisma.lead.create({
      data: {
        contactId: data.contactId,
        source: data.source,
        productInterest: data.productInterest,
        estimatedValue: data.estimatedValue,
        notes: data.notes,
        assignedTo: data.assignedTo,
        status: LeadStatus.NEW,
      },
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            type: true,
          },
        },
        assigned: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return lead as LeadDetails;
  }

  async updateLead(
    leadId: string,
    data: UpdateLeadData,
  ): Promise<LeadDetails | null> {
    const lead = await this.prisma.lead.update({
      where: { id: leadId },
      data,
      include: {
        contact: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            type: true,
          },
        },
        assigned: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return lead as LeadDetails | null;
  }

  async deleteLead(leadId: string): Promise<boolean> {
    await this.prisma.lead.delete({
      where: { id: leadId },
    });
    return true;
  }

  async assignLead(leadId: string, userId: string): Promise<boolean> {
    await this.prisma.lead.update({
      where: { id: leadId },
      data: { assignedTo: userId },
    });
    return true;
  }

  async updateLeadStatus(
    leadId: string,
    status: LeadStatus,
    wonAmount?: number,
    lostReason?: string,
  ): Promise<boolean> {
    const updateData: any = { status };

    if (status === LeadStatus.WON && wonAmount !== undefined) {
      updateData.wonAmount = wonAmount;
    }

    if (status === LeadStatus.LOST && lostReason) {
      updateData.lostReason = lostReason;
    }

    const updated = await this.prisma.lead.update({
      where: { id: leadId },
      data: updateData,
      select: { contactId: true },
    });

    // Reflect the lead's lifecycle on the contact's funnel-stage dimension.
    // Non-blocking — funnel-stage drift never breaks the lead update path.
    void this.contactDimensions.onLeadStatusChange(updated.contactId, status);

    return true;
  }

  async getPipelineStatistics(
    scope?: { userId: string; role: UserRole },
  ): Promise<LeadPipelineStats> {
    // Scope the query to the caller's slice. Mirrors the list-level rule:
    // ADMIN sees all; VENTAS sees own + unassigned. Without this, Franco's
    // pipeline page showed totals from leads he doesn't own.
    const where: any = {};
    if (scope && scope.role !== UserRole.ADMIN) {
      where.OR = [{ assignedTo: scope.userId }, { assignedTo: null }];
    }
    const allLeads = await this.prisma.lead.findMany({
      where,
      select: {
        status: true,
        estimatedValue: true,
        wonAmount: true,
        source: true,
        productInterest: true,
      },
    });

    const totalLeads = allLeads.length;

    // Count by status
    const byStatus: Record<LeadStatus, number> = {
      [LeadStatus.NEW]: 0,
      [LeadStatus.CONTACTED]: 0,
      [LeadStatus.QUOTE_SENT]: 0,
      [LeadStatus.NEGOTIATING]: 0,
      [LeadStatus.WON]: 0,
      [LeadStatus.LOST]: 0,
    };

    allLeads.forEach((lead) => {
      byStatus[lead.status]++;
    });

    // Calculate values
    const totalEstimatedValue = allLeads
      .filter((l) => l.estimatedValue !== null)
      .reduce((sum, l) => sum + (l.estimatedValue || 0), 0);

    const totalWonValue = allLeads
      .filter((l) => l.status === LeadStatus.WON && l.wonAmount !== null)
      .reduce((sum, l) => sum + (l.wonAmount || 0), 0);

    const wonLeads = allLeads.filter((l) => l.status === LeadStatus.WON);
    const lostLeads = allLeads.filter((l) => l.status === LeadStatus.LOST);
    const totalLostValue = lostLeads
      .filter((l) => l.estimatedValue !== null)
      .reduce((sum, l) => sum + (l.estimatedValue || 0), 0);

    const conversionRate =
      totalLeads > 0 ? (wonLeads.length / totalLeads) * 100 : 0;

    const averageDealSize =
      wonLeads.length > 0 ? totalWonValue / wonLeads.length : 0;

    // Count by source
    const bySource: any = {};
    allLeads.forEach((lead) => {
      bySource[lead.source] = (bySource[lead.source] || 0) + 1;
    });

    // Top products
    const productCounts: Record<string, number> = {};
    allLeads
      .filter((l) => l.productInterest)
      .forEach((lead) => {
        const product = lead.productInterest!;
        productCounts[product] = (productCounts[product] || 0) + 1;
      });

    const topProducts = Object.entries(productCounts)
      .map(([product, count]) => ({ product, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalLeads,
      byStatus,
      totalEstimatedValue,
      totalWonValue,
      totalLostValue,
      conversionRate,
      averageDealSize,
      bySource,
      topProducts,
    };
  }
}
