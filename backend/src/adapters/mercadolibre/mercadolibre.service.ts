/**
 * ADAPTERS LAYER - MercadoLibre Service
 * Integrates with MercadoLibre API for questions and messages
 */

import { Injectable, Logger } from '@nestjs/common';
import { IMercadoLibreService } from '../../use-cases/mercadolibre/mercadolibre.interface';
import {
  MercadoLibreIncomingMessage,
  MercadoLibreOutgoingMessage,
  MercadoLibreSendResult,
  MercadoLibreMessageType,
  MercadoLibreStatus,
} from '../../domain/entities/mercadolibre-message.entity';

@Injectable()
export class MercadoLibreService implements IMercadoLibreService {
  private readonly logger = new Logger(MercadoLibreService.name);
  private readonly apiUrl: string;
  private readonly accessToken: string | null;
  private readonly userId: string | null;
  private readonly isConfigured: boolean;

  constructor() {
    this.apiUrl = process.env.MERCADOLIBRE_API_URL || 'https://api.mercadolibre.com';
    this.accessToken = process.env.MERCADOLIBRE_ACCESS_TOKEN || null;
    this.userId = process.env.MERCADOLIBRE_USER_ID || null;

    this.isConfigured = !!(this.accessToken && this.userId);

    if (!this.isConfigured) {
      this.logger.warn('⚠️  MercadoLibre not configured. Service will start but cannot send/receive messages.');
      this.logger.warn('   Add credentials to .env:');
      this.logger.warn('   - MERCADOLIBRE_ACCESS_TOKEN');
      this.logger.warn('   - MERCADOLIBRE_USER_ID');
      this.logger.warn('   - MERCADOLIBRE_APP_ID (for webhooks)');
    } else {
      this.logger.log('✅ MercadoLibre service initialized');
    }
  }

  async answerQuestion(questionId: string, text: string): Promise<MercadoLibreSendResult> {
    if (!this.isConfigured) {
      return MercadoLibreSendResult.failure('MercadoLibre not configured');
    }

    try {
      // Answer question via MercadoLibre API
      // POST /answers
      const url = `${this.apiUrl}/answers`;

      this.logger.debug(`Answering question ${questionId}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question_id: questionId,
          text: text,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        this.logger.error(`Failed to answer question: ${JSON.stringify(data)}`);
        return MercadoLibreSendResult.failure(data.message || 'Failed to answer');
      }

      const answerId = data.id;
      this.logger.log(`✅ Question answered: ${questionId} -> ${answerId}`);
      return MercadoLibreSendResult.success(answerId);
    } catch (error: any) {
      this.logger.error(`Error answering question: ${error.message}`);
      return MercadoLibreSendResult.failure(error.message);
    }
  }

  async sendMessage(message: MercadoLibreOutgoingMessage): Promise<MercadoLibreSendResult> {
    if (!this.isConfigured) {
      return MercadoLibreSendResult.failure('MercadoLibre not configured');
    }

    if (!message.validate()) {
      return MercadoLibreSendResult.failure('Invalid message: must be 1-2000 characters');
    }

    try {
      if (message.type === MercadoLibreMessageType.QUESTION && message.questionId) {
        return await this.answerQuestion(message.questionId, message.text);
      }

      // For direct messages, use messages API
      // This is a simplified implementation
      return MercadoLibreSendResult.failure('Direct messaging not yet implemented');
    } catch (error: any) {
      this.logger.error(`Error sending message: ${error.message}`);
      return MercadoLibreSendResult.failure(error.message);
    }
  }

  parseIncomingMessage(webhookPayload: any): MercadoLibreIncomingMessage | null {
    try {
      // MercadoLibre webhook structure:
      // { topic: "questions", resource: "/questions/123456", user_id: "789", sent: "..." }
      const topic = webhookPayload.topic;
      const resource = webhookPayload.resource;

      if (!topic || !resource) {
        this.logger.debug('Invalid webhook payload: missing topic or resource');
        return null;
      }

      // For questions topic, we need to fetch the question details
      if (topic === 'questions') {
        // Extract question ID from resource path
        const questionId = resource.split('/').pop();
        this.logger.log(`📩 MercadoLibre question notification: ${questionId}`);

        // In real implementation, we'd fetch question details here
        // For now, return a placeholder
        return new MercadoLibreIncomingMessage(
          questionId,
          MercadoLibreMessageType.QUESTION,
          'unknown', // Would be fetched from API
          webhookPayload.user_id || 'unknown',
          '', // Would be fetched from API
          null,
          MercadoLibreStatus.UNANSWERED,
          new Date(),
        );
      }

      this.logger.debug(`Webhook topic not supported: ${topic}`);
      return null;
    } catch (error: any) {
      this.logger.error(`Error parsing webhook: ${error.message}`);
      return null;
    }
  }

  async getUnansweredQuestions(): Promise<MercadoLibreIncomingMessage[]> {
    if (!this.isConfigured) {
      return [];
    }

    try {
      // GET /questions/search with seller_id and status filters
      const url = `${this.apiUrl}/questions/search?seller_id=${this.userId}&status=UNANSWERED&sort_fields=date_created&sort_types=DESC`;

      this.logger.debug('Fetching unanswered questions');

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        this.logger.error(`Failed to fetch questions: ${JSON.stringify(error)}`);
        return [];
      }

      const data = await response.json();
      const questions: MercadoLibreIncomingMessage[] = [];

      for (const q of data.questions || []) {
        questions.push(
          new MercadoLibreIncomingMessage(
            q.id.toString(),
            MercadoLibreMessageType.QUESTION,
            q.from.nickname || q.from.id.toString(),
            q.from.id.toString(),
            q.text,
            q.item_id,
            this.mapStatus(q.status),
            new Date(q.date_created),
          ),
        );
      }

      this.logger.log(`Found ${questions.length} unanswered questions`);
      return questions;
    } catch (error: any) {
      this.logger.error(`Error fetching unanswered questions: ${error.message}`);
      return [];
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.isConfigured) {
      return false;
    }

    try {
      // Test API connection by fetching user info
      const url = `${this.apiUrl}/users/${this.userId}`;

      const response = await fetch(url, {
        method: 'GET',
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

  /**
   * Fetch question details from API
   * This is called after receiving a webhook notification
   */
  async fetchQuestionDetails(questionId: string): Promise<MercadoLibreIncomingMessage | null> {
    if (!this.isConfigured) {
      return null;
    }

    try {
      const url = `${this.apiUrl}/questions/${questionId}`;

      this.logger.debug(`Fetching question details: ${questionId}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      });

      if (!response.ok) {
        this.logger.error(`Failed to fetch question ${questionId}`);
        return null;
      }

      const q = await response.json();

      this.logger.log(`📩 Question from ${q.from.nickname}: "${q.text.substring(0, 50)}..."`);

      return new MercadoLibreIncomingMessage(
        q.id.toString(),
        MercadoLibreMessageType.QUESTION,
        q.from.nickname || q.from.id.toString(),
        q.from.id.toString(),
        q.text,
        q.item_id,
        this.mapStatus(q.status),
        new Date(q.date_created),
      );
    } catch (error: any) {
      this.logger.error(`Error fetching question details: ${error.message}`);
      return null;
    }
  }

  private mapStatus(status: string): MercadoLibreStatus {
    switch (status) {
      case 'UNANSWERED':
        return MercadoLibreStatus.UNANSWERED;
      case 'ANSWERED':
        return MercadoLibreStatus.ANSWERED;
      case 'CLOSED_UNANSWERED':
        return MercadoLibreStatus.CLOSED_UNANSWERED;
      case 'UNDER_REVIEW':
        return MercadoLibreStatus.UNDER_REVIEW;
      case 'BANNED':
        return MercadoLibreStatus.BANNED;
      default:
        return MercadoLibreStatus.UNANSWERED;
    }
  }
}
