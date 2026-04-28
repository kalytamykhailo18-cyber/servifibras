/**
 * USE CASES LAYER - Conversation Management Interface
 */

import { Channel, ConversationStatus } from '@prisma/client';

export interface ConversationListFilter {
  channel?: Channel;
  status?: ConversationStatus;
  search?: string; // Search in contact name or last message
  assignedToUserId?: string;
  limit?: number;
  offset?: number;
}

export interface ConversationDetails {
  id: string;
  contact: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    channel: Channel;
  };
  channel: Channel;
  status: ConversationStatus;
  assignedTo: {
    id: string;
    name: string;
  } | null;
  lastMessage: string | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{
    id: string;
    content: string;
    sender: string;
    isFromAI: boolean;
    timestamp: Date;
  }>;
}

export interface IConversationManagementService {
  /**
   * List conversations with filters
   */
  listConversations(filter: ConversationListFilter): Promise<{
    conversations: ConversationDetails[];
    total: number;
  }>;

  /**
   * Get single conversation with full message history
   */
  getConversationById(conversationId: string): Promise<ConversationDetails | null>;

  /**
   * Assign conversation to user (manual takeover)
   */
  assignConversation(conversationId: string, userId: string): Promise<boolean>;

  /**
   * Update conversation status
   */
  updateConversationStatus(conversationId: string, status: ConversationStatus): Promise<boolean>;

  /**
   * Send manual message in conversation (human takeover)
   */
  sendManualMessage(conversationId: string, userId: string, content: string): Promise<boolean>;

  /**
   * Get conversation statistics
   */
  getStatistics(): Promise<{
    total: number;
    byChannel: Record<Channel, number>;
    byStatus: Record<ConversationStatus, number>;
    activeToday: number;
  }>;
}
