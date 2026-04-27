/**
 * USE CASES LAYER - Conversation Handler Interface
 * Defines contract for handling customer conversations across channels
 */

import { WhatsAppIncomingMessage } from '../../domain/entities/whatsapp-message.entity';

/**
 * Result of processing a conversation message
 */
export interface ConversationHandleResult {
  success: boolean;
  response: string | null;
  error: string | null;
}

/**
 * Interface for conversation handling service
 * Processes incoming messages and generates AI responses
 */
export interface IConversationHandler {
  /**
   * Handle an incoming WhatsApp message
   * - Loads conversation history from database
   * - Sends to AI with context
   * - Returns AI response
   * - Saves messages to database
   */
  handleWhatsAppMessage(
    message: WhatsAppIncomingMessage,
  ): Promise<ConversationHandleResult>;

  /**
   * Get conversation history for a contact
   */
  getConversationHistory(phoneNumber: string, limit?: number): Promise<any[]>;
}
