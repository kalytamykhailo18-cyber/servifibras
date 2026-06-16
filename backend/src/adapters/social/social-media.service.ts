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
import { MetaAuthResolver } from '../oauth/meta-auth.resolver';

@Injectable()
export class SocialMediaService implements ISocialMediaService {
  private readonly logger = new Logger(SocialMediaService.name);
  private readonly webhookVerifyToken: string;
  private readonly appSecret: string;
  private readonly apiUrl: string;

  constructor(private readonly auth: MetaAuthResolver) {
    this.webhookVerifyToken = process.env.SOCIAL_WEBHOOK_VERIFY_TOKEN || '';
    // App secret is read from META_APP_SECRET (the new OAuth-era key)
    // with a fallback to FACEBOOK_APP_SECRET for the env-only legacy
    // path. Either one configured = signature verification active.
    this.appSecret = process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET || '';
    this.apiUrl = process.env.FACEBOOK_API_URL || 'https://graph.facebook.com/v18.0';
    this.logger.log(
      `Social Media Service initialized (verify-token ${this.webhookVerifyToken ? 'present' : 'absent'}, app-secret ${this.appSecret ? 'present' : 'absent'})`,
    );
  }

  async sendMessage(message: SocialOutgoingMessage): Promise<SocialSendResult> {
    const auth = await this.auth.resolve();
    if (!auth) {
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
    const auth = await this.auth.resolve();
    if (!auth) {
      return SocialSendResult.failure('Social media not configured');
    }

    try {
      const url = `${this.apiUrl}/${commentId}/comments`;
      this.logger.debug(`Replying to comment ${commentId}`);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.pageAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: text }),
      });

      const data = await response.json();
      if (!response.ok) {
        this.logger.error(`Failed to reply to comment: ${JSON.stringify(data)}`);
        return SocialSendResult.failure(data.error?.message || 'Failed to reply');
      }
      this.logger.log(`✅ Comment reply sent: ${data.id}`);
      return SocialSendResult.success(data.id);
    } catch (error: any) {
      this.logger.error(`Error replying to comment: ${error.message}`);
      return SocialSendResult.failure(error.message);
    }
  }

  async sendDirectMessage(userId: string, text: string): Promise<SocialSendResult> {
    const auth = await this.auth.resolve();
    if (!auth) {
      return SocialSendResult.failure('Social media not configured');
    }

    try {
      // For Instagram DMs use the IG business account id; for Messenger use the page id
      const senderId = auth.instagramAccountId || auth.pageId;
      const url = `${this.apiUrl}/${senderId}/messages`;
      this.logger.debug(`Sending DM to user ${userId}`);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.pageAccessToken}`,
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
      this.logger.log(`✅ DM sent: ${data.message_id}`);
      return SocialSendResult.success(data.message_id);
    } catch (error: any) {
      this.logger.error(`Error sending DM: ${error.message}`);
      return SocialSendResult.failure(error.message);
    }
  }

  // Best-effort fetch of a user's display name + avatar from Graph API.
  // Works for FB Messenger PSIDs and IG-scoped IDs (the `profile_pic`
  // field is publicly available with the page token's scope). Returns
  // null on any failure so the caller can keep going with the initials
  // fallback — avatar is decoration, not a hard requirement.
  async fetchUserProfile(
    userId: string,
  ): Promise<{ name?: string; avatarUrl?: string } | null> {
    const auth = await this.auth.resolve();
    if (!auth) {
      return null;
    }
    try {
      const url = `${this.apiUrl}/${userId}?fields=name,profile_pic`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${auth.pageAccessToken}` },
      });
      const data = await response.json();
      if (!response.ok) {
        this.logger.debug(
          `Profile fetch for ${userId} returned ${response.status}: ${data.error?.message || 'unknown'}`,
        );
        return null;
      }
      return {
        name: typeof data.name === 'string' ? data.name : undefined,
        avatarUrl: typeof data.profile_pic === 'string' ? data.profile_pic : undefined,
      };
    } catch (error: any) {
      this.logger.debug(`Profile fetch error for ${userId}: ${error.message}`);
      return null;
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
    const auth = await this.auth.resolve();
    if (!auth) return false;

    try {
      const pageId = auth.pageId || auth.instagramAccountId || '';
      if (!pageId) return false;
      const url = `${this.apiUrl}/${pageId}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${auth.pageAccessToken}` },
      });
      return response.ok;
    } catch (error: any) {
      this.logger.error(`Health check failed: ${error.message}`);
      return false;
    }
  }
}
