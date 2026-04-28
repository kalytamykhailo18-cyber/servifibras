/**
 * INFRASTRUCTURE LAYER - MercadoLibre Controller
 * HTTP endpoints for MercadoLibre webhooks and messaging
 */

import { Controller, Get, Post, Body, Query, Logger, Res } from '@nestjs/common';
import { Response } from 'express';
import { MercadoLibreService } from '../../../adapters/mercadolibre/mercadolibre.service';
import { ConversationHandlerService } from '../../../adapters/conversations/conversation-handler.service';
import {
  MercadoLibreOutgoingMessage,
  MercadoLibreMessageType,
} from '../../../domain/entities/mercadolibre-message.entity';

@Controller('mercadolibre')
export class MercadoLibreController {
  private readonly logger = new Logger(MercadoLibreController.name);

  constructor(
    private readonly mercadolibreService: MercadoLibreService,
    private readonly conversationHandler: ConversationHandlerService,
  ) {}

  /**
   * Webhook endpoint for MercadoLibre notifications
   * MercadoLibre sends notifications for new questions, messages, etc.
   */
  @Post('webhook')
  async handleWebhook(@Body() body: any, @Res() res: Response) {
    try {
      this.logger.log(`Webhook received: ${JSON.stringify(body)}`);

      // Immediately acknowledge webhook (MercadoLibre requires fast response)
      res.status(200).send('OK');

      // Parse the notification
      const notification = this.mercadolibreService.parseIncomingMessage(body);

      if (!notification) {
        this.logger.debug('Notification not processed (unsupported topic or invalid format)');
        return;
      }

      // Process asynchronously (after acknowledging MercadoLibre)
      this.processNotificationWithAI(body, notification.id).catch((error) => {
        this.logger.error(`Error processing notification async: ${error.message}`);
      });
    } catch (error: any) {
      this.logger.error(`Webhook error: ${error.message}`);
      // Already sent 200 OK, so just log the error
    }
  }

  /**
   * Health check endpoint
   */
  @Get('health')
  async healthCheck() {
    const isHealthy = await this.mercadolibreService.healthCheck();
    if (isHealthy) {
      return { status: 'ok', message: 'MercadoLibre service healthy' };
    } else {
      return { statusCode: 503, message: 'MercadoLibre service unhealthy' };
    }
  }

  /**
   * Get unanswered questions
   */
  @Get('questions/unanswered')
  async getUnansweredQuestions() {
    const questions = await this.mercadolibreService.getUnansweredQuestions();
    return {
      count: questions.length,
      questions: questions,
    };
  }

  /**
   * Test endpoint to answer a specific question
   */
  @Post('questions/:questionId/answer')
  async answerQuestion(
    @Query('questionId') questionId: string,
    @Body() body: { text: string },
  ) {
    const result = await this.mercadolibreService.answerQuestion(
      questionId,
      body.text,
    );

    if (result.success) {
      return { success: true, answerId: result.messageId };
    } else {
      return { success: false, error: result.error };
    }
  }

  /**
   * Process notification with AI (async)
   */
  private async processNotificationWithAI(webhookBody: any, questionId: string) {
    try {
      this.logger.debug(`Processing question ${questionId} with AI`);

      // Fetch full question details from MercadoLibre API
      const question = await this.mercadolibreService.fetchQuestionDetails(questionId);

      if (!question) {
        this.logger.warn(`Could not fetch question details: ${questionId}`);
        return;
      }

      if (!question.needsAnswer()) {
        this.logger.debug(`Question ${questionId} does not need answer`);
        return;
      }

      // Process with conversation handler (includes AI + pricing)
      const result = await this.conversationHandler.handleMercadoLibreMessage(question);

      if (!result.success || !result.response) {
        this.logger.error(`Failed to get AI response: ${result.error}`);
        return;
      }

      // Send answer via MercadoLibre API
      const sendResult = await this.mercadolibreService.answerQuestion(
        question.id,
        result.response,
      );

      if (sendResult.success) {
        this.logger.log(`✅ Answered question ${questionId}`);
      } else {
        this.logger.error(`Failed to send answer: ${sendResult.error}`);
      }
    } catch (error: any) {
      this.logger.error(`Error in processNotificationWithAI: ${error.message}`);
    }
  }
}
