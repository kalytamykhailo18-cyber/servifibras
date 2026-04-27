/**
 * ADAPTERS LAYER - WhatsApp Service Implementation
 * Implements IWhatsAppService using Meta Cloud API (WhatsApp Business API)
 */

import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { IWhatsAppService } from '../../use-cases/whatsapp/whatsapp.interface';
import {
  WhatsAppIncomingMessage,
  WhatsAppOutgoingMessage,
  WhatsAppSendResult,
  WhatsAppMessageType,
} from '../../domain/entities/whatsapp-message.entity';

@Injectable()
export class WhatsAppService implements IWhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly webhookVerifyToken: string;
  private readonly appSecret: string;
  private readonly apiUrl: string;
  private readonly isConfigured: boolean;

  constructor() {
    // ✅ RULE 1: All config from .env, never hardcoded
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    this.webhookVerifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '';
    this.appSecret = process.env.WHATSAPP_APP_SECRET || '';
    this.apiUrl = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v18.0';

    this.isConfigured =
      this.accessToken.length > 0 &&
      this.phoneNumberId.length > 0 &&
      this.webhookVerifyToken.length > 0;

    if (!this.isConfigured) {
      this.logger.warn(
        '⚠️  WhatsApp not configured. Service will start but cannot send/receive messages.',
      );
      this.logger.warn('   Add credentials to .env:');
      this.logger.warn('   - WHATSAPP_ACCESS_TOKEN');
      this.logger.warn('   - WHATSAPP_PHONE_NUMBER_ID');
      this.logger.warn('   - WHATSAPP_WEBHOOK_VERIFY_TOKEN');
      this.logger.warn('   - WHATSAPP_APP_SECRET (for signature verification)');
    } else {
      this.logger.log('✅ WhatsApp Service initialized');
      this.logger.log(`   Phone Number ID: ${this.phoneNumberId}`);
      this.logger.log(`   API URL: ${this.apiUrl}`);
    }
  }

  async sendMessage(message: WhatsAppOutgoingMessage): Promise<WhatsAppSendResult> {
    if (!this.isConfigured) {
      return WhatsAppSendResult.failure('WhatsApp not configured');
    }

    if (!message.validate()) {
      return WhatsAppSendResult.failure('Invalid message (empty or too long)');
    }

    try {
      const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;

      const payload: any = {
        messaging_product: 'whatsapp',
        to: message.to,
        type: 'text',
        text: {
          body: message.text,
        },
      };

      // Add reply context if specified
      if (message.replyToMessageId) {
        payload.context = {
          message_id: message.replyToMessageId,
        };
      }

      this.logger.debug(`Sending WhatsApp message to ${message.to}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        this.logger.error(`Failed to send WhatsApp message: ${JSON.stringify(data)}`);
        return WhatsAppSendResult.failure(
          data.error?.message || 'Failed to send message',
        );
      }

      const messageId = data.messages?.[0]?.id;
      if (!messageId) {
        return WhatsAppSendResult.failure('No message ID returned');
      }

      this.logger.log(`✅ WhatsApp message sent: ${messageId}`);
      return WhatsAppSendResult.success(messageId);
    } catch (error: any) {
      this.logger.error(`Error sending WhatsApp message: ${error.message}`);
      return WhatsAppSendResult.failure(error.message);
    }
  }

  async sendTextMessage(to: string, text: string): Promise<WhatsAppSendResult> {
    const message = new WhatsAppOutgoingMessage(to, text);
    return this.sendMessage(message);
  }

  async markAsRead(messageId: string): Promise<boolean> {
    if (!this.isConfigured) {
      return false;
    }

    try {
      const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
      });

      return response.ok;
    } catch (error: any) {
      this.logger.error(`Error marking message as read: ${error.message}`);
      return false;
    }
  }

  verifyWebhookSignature(signature: string, body: string): boolean {
    if (!this.appSecret) {
      this.logger.warn('No app secret configured, skipping signature verification');
      return true; // Allow in dev mode
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
      this.logger.error(`Error verifying webhook signature: ${error.message}`);
      return false;
    }
  }

  parseIncomingMessage(webhookPayload: any): WhatsAppIncomingMessage | null {
    try {
      // Meta webhook structure: { object: "whatsapp_business_account", entry: [...] }
      const entry = webhookPayload.entry?.[0];
      if (!entry) {
        this.logger.warn('No entry in webhook payload');
        return null;
      }

      const changes = entry.changes?.[0];
      if (!changes || changes.field !== 'messages') {
        this.logger.debug('Webhook is not a message event');
        return null;
      }

      const value = changes.value;
      const messages = value.messages;
      if (!messages || messages.length === 0) {
        this.logger.debug('No messages in webhook payload');
        return null;
      }

      // Parse first message (usually only one per webhook)
      const msg = messages[0];

      const messageId = msg.id;
      const from = msg.from;
      const timestamp = new Date(parseInt(msg.timestamp) * 1000);
      const type = msg.type as WhatsAppMessageType;

      let text: string | null = null;
      let mediaUrl: string | null = null;
      let mediaId: string | null = null;

      // Extract content based on type
      switch (type) {
        case WhatsAppMessageType.TEXT:
          text = msg.text?.body || null;
          break;
        case WhatsAppMessageType.IMAGE:
          mediaId = msg.image?.id || null;
          mediaUrl = msg.image?.link || null;
          text = msg.image?.caption || null;
          break;
        case WhatsAppMessageType.VOICE:
          mediaId = msg.audio?.id || null;
          break;
        case WhatsAppMessageType.VIDEO:
          mediaId = msg.video?.id || null;
          mediaUrl = msg.video?.link || null;
          text = msg.video?.caption || null;
          break;
        case WhatsAppMessageType.DOCUMENT:
          mediaId = msg.document?.id || null;
          mediaUrl = msg.document?.link || null;
          text = msg.document?.caption || msg.document?.filename || null;
          break;
      }

      const incomingMessage = new WhatsAppIncomingMessage(
        messageId,
        from,
        timestamp,
        type,
        text,
        mediaUrl,
        mediaId,
      );

      this.logger.log(
        `📩 Incoming WhatsApp message: ${type} from ${from} - "${text?.substring(0, 50) || '[media]'}"`,
      );

      return incomingMessage;
    } catch (error: any) {
      this.logger.error(`Error parsing incoming message: ${error.message}`);
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.isConfigured) {
      return false;
    }

    try {
      // Verify access token by fetching phone number details
      const url = `${this.apiUrl}/${this.phoneNumberId}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      });

      return response.ok;
    } catch (error: any) {
      this.logger.error(`Health check failed: ${error.message}`);
      return false;
    }
  }
}
