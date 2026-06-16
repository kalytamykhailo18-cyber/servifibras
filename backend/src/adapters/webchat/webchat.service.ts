/**
 * ADAPTERS LAYER - TiendaNube Webchat Service
 * Integrates with TiendaNube's live chat for e-commerce store
 */

import { Injectable, Logger } from '@nestjs/common';
import { IWebchatService } from '../../use-cases/webchat/webchat.interface';
import {
  WebchatIncomingMessage,
  WebchatOutgoingMessage,
  WebchatSendResult,
  WebchatMessageType,
} from '../../domain/entities/webchat-message.entity';
import { TiendaNubeAuthResolver } from '../oauth/tiendanube-auth.resolver';

@Injectable()
export class WebchatService implements IWebchatService {
  private readonly logger = new Logger(WebchatService.name);
  private readonly apiUrl: string;

  constructor(private readonly auth: TiendaNubeAuthResolver) {
    this.apiUrl = process.env.TIENDANUBE_API_URL || 'https://api.tiendanube.com/v1';
    this.logger.log('TiendaNube Webchat service initialized');
  }

  async sendMessage(message: WebchatOutgoingMessage): Promise<WebchatSendResult> {
    const auth = await this.auth.resolve();
    if (!auth) {
      return WebchatSendResult.failure('TiendaNube Webchat not configured');
    }

    if (!message.validate()) {
      return WebchatSendResult.failure('Invalid message: must be 1-5000 characters');
    }

    try {
      const url = `${this.apiUrl}/${auth.storeId}/conversations/${message.conversationId}/messages`;

      this.logger.debug(`Sending message to conversation ${message.conversationId}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authentication: `bearer ${auth.accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Servifibras AI Platform',
        },
        body: JSON.stringify({
          message: {
            text: message.text,
            type: message.type,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        this.logger.error(`Failed to send message: ${JSON.stringify(error)}`);
        return WebchatSendResult.failure(error.message || 'Failed to send');
      }

      const data = await response.json();
      const messageId = data.id || data.message?.id;
      this.logger.log(`✅ Message sent: ${messageId}`);
      return WebchatSendResult.success(messageId);
    } catch (error: any) {
      this.logger.error(`Error sending message: ${error.message}`);
      return WebchatSendResult.failure(error.message);
    }
  }

  parseIncomingMessage(webhookPayload: any): WebchatIncomingMessage | null {
    try {
      // TiendaNube webhook structure for webchat messages
      // { event: "message/created", data: { conversation_id, customer, message } }
      const event = webhookPayload.event;
      const data = webhookPayload.data;

      if (!event || !data) {
        this.logger.debug('Invalid webhook payload: missing event or data');
        return null;
      }

      if (event === 'message/created' || event === 'conversation/message') {
        const message = data.message;
        const customer = data.customer;
        const conversationId = data.conversation_id;

        if (!message || !customer || !conversationId) {
          this.logger.debug('Incomplete message data in webhook');
          return null;
        }

        // Only process customer messages (not store/bot messages)
        if (message.from === 'store' || message.from === 'bot') {
          this.logger.debug('Ignoring message from store/bot');
          return null;
        }

        this.logger.log(
          `💬 Webchat message from ${customer.name}: "${message.text?.substring(0, 50)}..."`,
        );

        return new WebchatIncomingMessage(
          message.id,
          conversationId,
          customer.id,
          customer.name,
          customer.email || null,
          this.mapMessageType(message.type),
          message.text || '',
          new Date(message.created_at || Date.now()),
        );
      }

      this.logger.debug(`Webhook event not supported: ${event}`);
      return null;
    } catch (error: any) {
      this.logger.error(`Error parsing webhook: ${error.message}`);
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    const auth = await this.auth.resolve();
    if (!auth) {
      return false;
    }

    try {
      const url = `${this.apiUrl}/${auth.storeId}/store`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authentication: `bearer ${auth.accessToken}`,
          'User-Agent': 'Servifibras AI Platform',
        },
      });

      return response.ok;
    } catch (error: any) {
      this.logger.error(`Health check failed: ${error.message}`);
      return false;
    }
  }

  private mapMessageType(type: string): WebchatMessageType {
    switch (type) {
      case 'text':
        return WebchatMessageType.TEXT;
      case 'image':
        return WebchatMessageType.IMAGE;
      case 'file':
        return WebchatMessageType.FILE;
      default:
        return WebchatMessageType.TEXT;
    }
  }
}
