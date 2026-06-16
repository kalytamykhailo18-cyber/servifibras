/**
 * USE CASES LAYER - Contact Management Interface
 * Defines contact management operations for admin dashboard
 */

import { Channel, ContactType, ConversationStatus, LeadStatus, OrderStatus, CustomerType, FunnelStage } from '@prisma/client';
import { RequestScope } from './conversation-management.interface';

export interface ContactListFilter {
  channel?: Channel;
  search?: string; // Search in name, phone, email
  hasActiveConversation?: boolean;
  // 2D classification filters — combine for "MAYORISTA + NO_CONCRETO"
  // style segmentation.
  customerType?: CustomerType;
  funnelStage?: FunnelStage;
  limit?: number;
  offset?: number;
}

export interface ContactConversationSummary {
  id: string;
  channel: Channel;
  status: ConversationStatus;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  isUnread: boolean;
  messageCount: number;
  assigned: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactLeadSummary {
  id: string;
  status: LeadStatus;
  source: Channel | null;
  productInterest: string | null;
  estimatedValue: number | null;
  wonAmount: number | null;
  assigned: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactOrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  amount: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactDetails {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  type: ContactType;
  // 2D classification (Marcos's redesign). Either may be null until the
  // contact has been classified or admin-overridden.
  customerType: CustomerType | null;
  funnelStage: FunnelStage | null;
  channel: Channel | null;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  conversationCount: number;
  lastConversationDate: Date | null;
  activeConversation?: {
    id: string;
    status: string;
    lastMessage: string | null;
    updatedAt: Date;
  } | null;
  // Full relation snapshots — present only on getContactById; list endpoints
  // skip these to keep payloads small.
  conversations?: ContactConversationSummary[];
  leads?: ContactLeadSummary[];
  orders?: ContactOrderSummary[];
}

export interface CreateContactInput {
  name?: string;
  phone?: string;
  email?: string;
  type?: ContactType;
  channel?: Channel;
  metadata?: Record<string, any>;
}

export interface UpdateContactInput {
  name?: string;
  phone?: string;
  email?: string;
  metadata?: Record<string, any>;
  customerType?: CustomerType | null;
  funnelStage?: FunnelStage | null;
}

export interface ContactStatistics {
  total: number;
  byChannel: Record<Channel, number>;
  withActiveConversations: number;
  createdToday: number;
  createdThisWeek: number;
  createdThisMonth: number;
}

export interface IContactManagementService {
  /**
   * List contacts with filters and pagination
   */
  listContacts(filter: ContactListFilter): Promise<{
    contacts: ContactDetails[];
    total: number;
  }>;

  /**
   * Get single contact by ID with full details. When `scope` is provided,
   * embedded conversations / leads / orders are filtered by the caller's role
   * so the same RBAC rules used by the list endpoints apply here too.
   */
  getContactById(contactId: string, scope?: RequestScope): Promise<ContactDetails | null>;

  /**
   * Create new contact
   */
  createContact(input: CreateContactInput): Promise<ContactDetails | null>;

  /**
   * Update existing contact
   */
  updateContact(
    contactId: string,
    input: UpdateContactInput,
  ): Promise<ContactDetails | null>;

  /**
   * Delete contact (soft delete - mark as inactive)
   */
  deleteContact(contactId: string): Promise<boolean>;

  /**
   * Search contacts by name, phone, or email
   */
  searchContacts(query: string, limit?: number): Promise<ContactDetails[]>;

  /**
   * Get contact statistics
   */
  getStatistics(): Promise<ContactStatistics>;

  /**
   * Merge duplicate contacts
   */
  mergeContacts(
    primaryContactId: string,
    duplicateContactId: string,
  ): Promise<boolean>;
}
