/**
 * USE CASES LAYER - Conversation Handler Interface
 * Defines contract for handling customer conversations across channels
 */

import { WhatsAppIncomingMessage } from '../../domain/entities/whatsapp-message.entity';
import { SocialIncomingMessage } from '../../domain/entities/social-message.entity';
import { MercadoLibreIncomingMessage } from '../../domain/entities/mercadolibre-message.entity';
import { WebchatIncomingMessage } from '../../domain/entities/webchat-message.entity';

/**
 * Result of processing a conversation message
 */
export interface ConversationHandleResult {
  success: boolean;
  response: string | null;
  error: string | null;
  /**
   * Marcos 2026-06-24 (Phase D): cuando la respuesta vino del modo
   * cerrado Y el self-eval del modelo dio >=8.5, este flag pide al
   * caller (e.g. webhook controller) que bypass el review-mode y
   * envíe a ML automáticamente. Default false → respeta review mode.
   */
  forceAutoSend?: boolean;
  /** Score del self-eval (0..10) — para logging/auditoría. */
  selfEvalScore?: number;
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
   * Handle an incoming social media message (Facebook/Instagram)
   */
  handleSocialMessage(
    message: SocialIncomingMessage,
  ): Promise<ConversationHandleResult>;

  /**
   * Handle an incoming MercadoLibre message (question or DM)
   */
  handleMercadoLibreMessage(
    message: MercadoLibreIncomingMessage,
  ): Promise<ConversationHandleResult>;

  /**
   * Handle an incoming TiendaNube Webchat message
   */
  handleWebchatMessage(
    message: WebchatIncomingMessage,
  ): Promise<ConversationHandleResult>;

  /**
   * Get conversation history for a contact
   */
  getConversationHistory(contactIdentifier: string, limit?: number): Promise<any[]>;
}
