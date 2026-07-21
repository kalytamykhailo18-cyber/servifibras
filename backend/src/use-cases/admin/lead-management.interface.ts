import { LeadStatus, Channel } from '@prisma/client';
import { RequestScope } from './conversation-management.interface';

export { LeadStatus, Channel };

export interface LeadListFilter {
  status?: LeadStatus;
  assignedToUserId?: string;
  source?: Channel;
  contactId?: string;
  limit?: number;
  offset?: number;
  scope?: RequestScope;
}

export interface LeadDetails {
  id: string;
  contact: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    type: string;
  };
  assigned: {
    id: string;
    name: string;
  } | null;
  status: LeadStatus;
  source: Channel;
  productInterest: string | null;
  estimatedValue: number | null;
  notes: string | null;
  wonAmount: number | null;
  lostReason: string | null;
  // Originating conversation if this lead was auto-generated from a
  // chat (mayorista detection). Null for manually-created leads or
  // Meta-Ads sourced leads with no chat thread. Used by the panel to
  // jump straight into the conversation.
  sourceConversationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLeadData {
  contactId: string;
  source: Channel;
  productInterest?: string;
  estimatedValue?: number;
  notes?: string;
  assignedTo?: string;
}

export interface UpdateLeadData {
  productInterest?: string;
  estimatedValue?: number;
  notes?: string;
  wonAmount?: number;
  lostReason?: string;
}

export interface LeadPipelineStats {
  totalLeads: number;
  byStatus: Record<LeadStatus, number>;
  totalEstimatedValue: number;
  totalWonValue: number;
  totalLostValue: number;
  conversionRate: number;
  averageDealSize: number;
  bySource: Record<Channel, number>;
  topProducts: Array<{ product: string; count: number }>;
  // Marcos 2026-07-21: el pipeline sólo mostraba filas de la tabla
  // leads, que estaba congelada (0 leads nuevos en 7 días) mientras
  // la actividad real de clientes seguía. Estos 3 números reflejan
  // la actividad de negocio en una ventana rodante (LEAD_ACTIVITY_WINDOW_DAYS,
  // default 30) filtrando sandbox: conversaciones cerradas por el
  // agente, pedidos generados desde la conversación, y monto total
  // facturado en ese lapso.
  closedConversationsInWindow: number;
  ordersInWindow: number;
  ordersAmountArsInWindow: number;
  activityWindowDays: number;
}

export interface ILeadManagementService {
  listLeads(filter: LeadListFilter): Promise<{
    data: LeadDetails[];
    total: number;
    limit: number;
    offset: number;
  }>;

  getLeadById(leadId: string): Promise<LeadDetails | null>;

  createLead(data: CreateLeadData): Promise<LeadDetails>;

  updateLead(leadId: string, data: UpdateLeadData): Promise<LeadDetails | null>;

  deleteLead(leadId: string): Promise<boolean>;

  assignLead(leadId: string, userId: string): Promise<boolean>;

  updateLeadStatus(
    leadId: string,
    status: LeadStatus,
    wonAmount?: number,
    lostReason?: string,
  ): Promise<boolean>;

  getPipelineStatistics(): Promise<LeadPipelineStats>;
}
