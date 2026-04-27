/**
 * USE CASES LAYER - WhatsApp Service Interface
 * Defines the contract for WhatsApp integration
 */

import {
  WhatsAppIncomingMessage,
  WhatsAppOutgoingMessage,
  WhatsAppSendResult,
} from '../../domain/entities/whatsapp-message.entity';

/**
 * Interface for WhatsApp messaging service
 * Implementation will use Meta Cloud API
 */
export interface IWhatsAppService {
  /**
   * Send a text message to a WhatsApp user
   */
  sendMessage(message: WhatsAppOutgoingMessage): Promise<WhatsAppSendResult>;

  /**
   * Send a simple text message (shorthand)
   */
  sendTextMessage(to: string, text: string): Promise<WhatsAppSendResult>;

  /**
   * Mark a message as read
   */
  markAsRead(messageId: string): Promise<boolean>;

  /**
   * Verify webhook signature from Meta
   */
  verifyWebhookSignature(signature: string, body: string): boolean;

  /**
   * Parse incoming webhook payload into domain entity
   */
  parseIncomingMessage(webhookPayload: any): WhatsAppIncomingMessage | null;

  /**
   * Check if service is configured and ready
   */
  healthCheck(): Promise<boolean>;
}
