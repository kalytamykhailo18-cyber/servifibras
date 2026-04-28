/**
 * INFRASTRUCTURE LAYER - TiendaNube Webchat Controller
 */

import { Controller, Get, Post, Body, Logger, Res } from '@nestjs/common';
import { Response } from 'express';
import { WebchatService } from '../../../adapters/webchat/webchat.service';
import { ConversationHandlerService } from '../../../adapters/conversations/conversation-handler.service';
import {
  WebchatOutgoingMessage,
  WebchatMessageType,
} from '../../../domain/entities/webchat-message.entity';

@Controller('webchat')
export class WebchatController {
  private readonly logger = new Logger(WebchatController.name);

  constructor(
    private readonly webchatService: WebchatService,
    private readonly conversationHandler: ConversationHandlerService,
  ) {}

  @Post('webhook')
  async handleWebhook(@Body() body: any, @Res() res: Response) {
    try {
      this.logger.log(`Webhook received: ${JSON.stringify(body)}`);

      res.status(200).send('OK');

      const message = this.webchatService.parseIncomingMessage(body);

      if (!message) {
        this.logger.debug('Message not processed (invalid format or non-customer message)');
        return;
      }

      this.processMessageWithAI(message).catch((error) => {
        this.logger.error(`Error processing message async: ${error.message}`);
      });
    } catch (error: any) {
      this.logger.error(`Webhook error: ${error.message}`);
    }
  }

  @Get('health')
  async healthCheck() {
    const isHealthy = await this.webchatService.healthCheck();
    if (isHealthy) {
      return { status: 'ok', message: 'Webchat service healthy' };
    } else {
      return { statusCode: 503, message: 'Webchat service unhealthy' };
    }
  }

  @Post('send')
  async sendMessage(
    @Body() body: { conversationId: string; text: string },
  ) {
    const message = new WebchatOutgoingMessage(
      body.conversationId,
      body.text,
      WebchatMessageType.TEXT,
    );

    const result = await this.webchatService.sendMessage(message);

    if (result.success) {
      return { success: true, messageId: result.messageId };
    } else {
      return { success: false, error: result.error };
    }
  }

  private async processMessageWithAI(incomingMessage: any) {
    try {
      this.logger.debug(`Processing message ${incomingMessage.id} with AI`);

      const result = await this.conversationHandler.handleWebchatMessage(incomingMessage);

      if (!result.success || !result.response) {
        this.logger.error(`Failed to get AI response: ${result.error}`);
        return;
      }

      const outgoingMessage = new WebchatOutgoingMessage(
        incomingMessage.conversationId,
        result.response,
        WebchatMessageType.TEXT,
      );

      const sendResult = await this.webchatService.sendMessage(outgoingMessage);

      if (sendResult.success) {
        this.logger.log(`✅ Sent response to conversation ${incomingMessage.conversationId}`);
      } else {
        this.logger.error(`Failed to send response: ${sendResult.error}`);
      }
    } catch (error: any) {
      this.logger.error(`Error in processMessageWithAI: ${error.message}`);
    }
  }
}
