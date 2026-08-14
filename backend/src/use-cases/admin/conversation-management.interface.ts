/**
 * USE CASES LAYER - Conversation Management Interface
 */

import { Channel, ConversationStatus, ContentType } from '@prisma/client';
import { UserRole } from '../../domain/entities/auth.entity';

// Scope identifies the calling user; the service applies role-based row
// filtering on top of any explicit filters.
export interface RequestScope {
  userId: string;
  role: UserRole;
}

export interface ConversationListFilter {
  channel?: Channel;
  status?: ConversationStatus;
  search?: string; // Search in contact name or last message
  assignedToUserId?: string;
  // Marcos 2026-07-21: filtro para la tab "No leídos". Cuando true,
  // devuelve sólo pending humano (needsHumanAttention=true).
  needsHumanAttention?: boolean;
  // Marcos 2026-07-21: filtro para la tab "Favoritas".
  favorite?: boolean;
  limit?: number;
  offset?: number;
  scope?: RequestScope;
}

export interface ConversationDetails {
  id: string;
  contact: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    channel: Channel;
    avatarUrl: string | null;
    type: string;
    customerType: string | null;
  };
  channel: Channel;
  status: ConversationStatus;
  assignedTo: {
    id: string;
    name: string;
  } | null;
  lastMessage: string | null;
  // Marcos 2026-07-13: sin este field, el frontend renderiza "Sin
  // mensajes" en toda fila del inbox aunque la conversación tenga
  // mensajes recientes; el timeAgo del card lee esta propiedad.
  lastMessageAt: Date | null;
  messageCount: number;
  needsHumanAttention: boolean;
  // Marcos 2026-08-14: WA-style unread flag por-fila. Expuesto para
  // que la lista + el detalle puedan diferenciar visualmente hilos
  // esperando respuesta del negocio.
  hasUnreadCustomer?: boolean;
  // Marcos 2026-08-14: fecha del último hilo previo del mismo contacto
  // (cualquier canal). null cuando es primer contacto. Se muestra en
  // el header del detalle como "Contactó antes: DD/MM/YYYY".
  priorConversationAt?: Date | null;
  escalatedAt: Date | null;
  // Marcos 2026-07-21: tab Favoritas.
  favorite: boolean;
  favoritedAt: Date | null;
  aiPaused: boolean;
  aiPausedAt: Date | null;
  aiPausedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages: Array<{
    id: string;
    content: string;
    sender: string;
    contentType: ContentType;
    isFromAI: boolean;
    timestamp: Date;
    attachmentUrl: string | null;
    attachmentName: string | null;
    attachmentMime: string | null;
    attachmentSize: number | null;
    // Per-user attribution for staff replies. Null for CUSTOMER + AI
    // messages (those identify themselves by `sender`). When present,
    // the transcript shows the actual operator name instead of the
    // generic role label.
    author: { id: string; name: string } | null;
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
   * Transfer a conversation to another user with an optional internal note.
   * Atomic: assignment + note are persisted together. Note is staff-only.
   * Returns the created note (if any) so the caller can wire notifications.
   */
  transferConversation(args: {
    conversationId: string;
    fromUserId: string;
    toUserId: string;
    note?: string;
  }): Promise<{
    success: boolean;
    note: { id: string; content: string; createdAt: Date; authorId: string } | null;
  }>;

  /**
   * List internal notes attached to a conversation.
   */
  listInternalNotes(conversationId: string): Promise<Array<{
    id: string;
    conversationId: string;
    authorId: string;
    authorName: string;
    content: string;
    createdAt: Date;
  }>>;

  /**
   * Send manual message in conversation (human takeover)
   */
  sendManualMessage(
    conversationId: string,
    userId: string,
    content: string,
  ): Promise<ConversationDetails['messages'][number] | null>;

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
