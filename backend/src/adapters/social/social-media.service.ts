/**
 * ADAPTERS LAYER - Social Media Service Implementation
 * Handles Facebook and Instagram through Meta Graph API
 */

import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { ISocialMediaService } from '../../use-cases/social/social.interface';
import {
  SocialIncomingMessage,
  SocialOutgoingMessage,
  SocialSendResult,
  SocialPlatform,
  SocialMessageType,
} from '../../domain/entities/social-message.entity';

@Injectable()
export class SocialMediaService implements ISocialMediaService {
  private readonly logger = new Logger(SocialMediaService.name);
  private readonly facebookAccessToken: string;
  private readonly facebookPageId: string;
  private readonly instagramAccountId: string;
  private readonly webhookVerifyToken: string;
  private readonly appSecret: string;
  private readonly apiUrl: string;
  private readonly isConfigured: boolean;

  constructor() {
    // ✅ RULE 1: All config from .env
    this.facebookAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '';
    this.facebookPageId = process.env.FACEBOOK_PAGE_ID || '';
    this.instagramAccountId = process.env.INSTAGRAM_ACCOUNT_ID || '';
    this.webhookVerifyToken = process.env.SOCIAL_WEBHOOK_VERIFY_TOKEN || '';
    this.appSecret = process.env.FACEBOOK_APP_SECRET || '';
    this.apiUrl = process.env.FACEBOOK_API_URL || 'https://graph.facebook.com/v18.0';

    this.isConfigured =
      this.facebookAccessToken.length > 0 &&
      (this.facebookPageId.length > 0 || this.instagramAccountId.length > 0) &&
      this.webhookVerifyToken.length > 0;

    if (!this.isConfigured) {
      this.logger.warn(
        '⚠️  Facebook/Instagram not configured. Service will start but cannot send/receive messages.',
      );
      this.logger.warn('   Add credentials to .env:');
      this.logger.warn('   - FACEBOOK_PAGE_ACCESS_TOKEN');
      this.logger.warn('   - FACEBOOK_PAGE_ID');
      this.logger.warn('   - INSTAGRAM_ACCOUNT_ID');
      this.logger.warn('   - SOCIAL_WEBHOOK_VERIFY_TOKEN');
      this.logger.warn('   - FACEBOOK_APP_SECRET');
    } else {
      this.logger.log('✅ Social Media Service initialized');
      if (this.facebookPageId) {
        this.logger.log(`   Facebook Page ID: ${this.facebookPageId}`);
      }
      if (this.instagramAccountId) {
        this.logger.log(`   Instagram Account ID: ${this.instagramAccountId}`);
      }
    }
  }

  async sendMessage(message: SocialOutgoingMessage): Promise<SocialSendResult> {
    if (!this.isConfigured) {
      return SocialSendResult.failure('Social media not configured');
    }

    if (!message.validate()) {
      return SocialSendResult.failure('Invalid message');
    }

    if (message.isComment()) {
      return this.replyToComment(message.to, message.text);
    } else {
      return this.sendDirectMessage(message.to, message.text);
    }
  }

  async replyToComment(commentId: string, text: string): Promise<SocialSendResult> {
    if (!this.isConfigured) {
      return SocialSendResult.failure('Social media not configured');
    }

    try {
      // Reply to comment using Graph API
      const url = `${this.apiUrl}/${commentId}/comments`;

      this.logger.debug(`Replying to comment ${commentId}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.facebookAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: text,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        this.logger.error(`Failed to reply to comment: ${JSON.stringify(data)}`);
        return SocialSendResult.failure(data.error?.message || 'Failed to reply');
      }

      const replyId = data.id;
      this.logger.log(`✅ Comment reply sent: ${replyId}`);
      return SocialSendResult.success(replyId);
    } catch (error: any) {
      this.logger.error(`Error replying to comment: ${error.message}`);
      return SocialSendResult.failure(error.message);
    }
  }

  async sendDirectMessage(userId: string, text: string): Promise<SocialSendResult> {
    if (!this.isConfigured) {
      return SocialSendResult.failure('Social media not configured');
    }

    try {
      // Send DM via Graph API
      // Note: For Instagram, use Instagram account ID; for Facebook, use page ID
      const senderId = this.instagramAccountId || this.facebookPageId;
      const url = `${this.apiUrl}/${senderId}/messages`;

      this.logger.debug(`Sending DM to user ${userId}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.facebookAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: userId },
          message: { text },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        this.logger.error(`Failed to send DM: ${JSON.stringify(data)}`);
        return SocialSendResult.failure(data.error?.message || 'Failed to send');
      }

      const messageId = data.message_id;
      this.logger.log(`✅ DM sent: ${messageId}`);
      return SocialSendResult.success(messageId);
    } catch (error: any) {
      this.logger.error(`Error sending DM: ${error.message}`);
      return SocialSendResult.failure(error.message);
    }
  }

  verifyWebhookSignature(signature: string, body: string): boolean {
    if (!this.appSecret) {
      this.logger.warn('No app secret configured, skipping signature verification');
      return true;
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.appSecret)
        .update(body)
        .digest('hex');

      const signatureHash = signature.startsWith('sha256=')
        ? signature.substring(7)
        : signature;

      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signatureHash),
      );
    } catch (error: any) {
      this.logger.error(`Error verifying signature: ${error.message}`);
      return false;
    }
  }

  parseIncomingMessage(webhookPayload: any): SocialIncomingMessage | null {
    try {
      const entry = webhookPayload.entry?.[0];
      if (!entry) {
        this.logger.warn('No entry in webhook payload');
        return null;
      }

      // Check for Instagram messaging
      if (entry.messaging) {
        return this.parseInstagramMessage(entry.messaging[0]);
      }

      // Check for Facebook comment
      if (entry.changes) {
        const change = entry.changes[0];
        if (change.field === 'feed' && change.value?.item === 'comment') {
          return this.parseFacebookComment(change.value);
        }
      }

      this.logger.debug('Webhook payload not recognized as message or comment');
      return null;
    } catch (error: any) {
      this.logger.error(`Error parsing incoming message: ${error.message}`);
      return null;
    }
  }

  private parseInstagramMessage(messaging: any): SocialIncomingMessage | null {
    try {
      const sender = messaging.sender?.id;
      const message = messaging.message;

      if (!sender || !message) {
        return null;
      }

      const messageId = message.mid;
      const text = message.text || '';
      const timestamp = new Date(messaging.timestamp);

      this.logger.log(
        `📩 Instagram DM from ${sender}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`,
      );

      return new SocialIncomingMessage(
        messageId,
        SocialPlatform.INSTAGRAM,
        SocialMessageType.DIRECT_MESSAGE,
        sender,
        sender,
        text,
        timestamp,
      );
    } catch (error: any) {
      this.logger.error(`Error parsing Instagram message: ${error.message}`);
      return null;
    }
  }

  private parseFacebookComment(commentData: any): SocialIncomingMessage | null {
    try {
      const commentId = commentData.comment_id;
      const from = commentData.from;
      const message = commentData.message || '';
      const postId = commentData.post_id;
      const parentId = commentData.parent_id;

      if (!commentId || !from) {
        return null;
      }

      const timestamp = new Date(commentData.created_time * 1000);

      this.logger.log(
        `📩 Facebook comment from ${from.name}: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`,
      );

      return new SocialIncomingMessage(
        commentId,
        SocialPlatform.FACEBOOK,
        SocialMessageType.COMMENT,
        from.name,
        from.id,
        message,
        timestamp,
        postId,
        parentId,
      );
    } catch (error: any) {
      this.logger.error(`Error parsing Facebook comment: ${error.message}`);
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.isConfigured) {
      return false;
    }

    try {
      // Verify token by getting page/account info
      const pageId = this.facebookPageId || this.instagramAccountId;
      const url = `${this.apiUrl}/${pageId}`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.facebookAccessToken}`,
        },
      });

      return response.ok;
    } catch (error: any) {
      this.logger.error(`Health check failed: ${error.message}`);
      return false;
    }
  }
}
