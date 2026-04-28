/**
 * USE CASES LAYER - Social Media Service Interface
 * Defines contract for Facebook and Instagram integration
 */

import {
  SocialIncomingMessage,
  SocialOutgoingMessage,
  SocialSendResult,
} from '../../domain/entities/social-message.entity';

/**
 * Interface for social media messaging service
 * Handles both Facebook and Instagram
 */
export interface ISocialMediaService {
  /**
   * Send a message (comment or DM)
   */
  sendMessage(message: SocialOutgoingMessage): Promise<SocialSendResult>;

  /**
   * Reply to a comment
   */
  replyToComment(commentId: string, text: string): Promise<SocialSendResult>;

  /**
   * Send a direct message
   */
  sendDirectMessage(userId: string, text: string): Promise<SocialSendResult>;

  /**
   * Verify webhook signature from Meta
   */
  verifyWebhookSignature(signature: string, body: string): boolean;

  /**
   * Parse incoming webhook payload
   */
  parseIncomingMessage(webhookPayload: any): SocialIncomingMessage | null;

  /**
   * Check if service is configured
   */
  healthCheck(): Promise<boolean>;
}
