/**
 * USE CASES LAYER - Contact Management Interface
 * Defines contact management operations for admin dashboard
 */

import { Channel, ContactType } from '@prisma/client';

export interface ContactListFilter {
  channel?: Channel;
  search?: string; // Search in name, phone, email
  hasActiveConversation?: boolean;
  limit?: number;
  offset?: number;
}

export interface ContactDetails {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  type: ContactType;
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
   * Get single contact by ID with full details
   */
  getContactById(contactId: string): Promise<ContactDetails | null>;

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
