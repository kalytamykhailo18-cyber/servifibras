/**
 * INFRASTRUCTURE LAYER - Social Media Controller
 * HTTP endpoints for Facebook and Instagram webhooks
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SocialMediaService } from '../../../adapters/social/social-media.service';
import { ConversationHandlerService } from '../../../adapters/conversations/conversation-handler.service';

@Controller('social')
export class SocialController {
  private readonly logger = new Logger(SocialController.name);

  constructor(
    private readonly socialService: SocialMediaService,
    private readonly conversationHandler: ConversationHandlerService,
  ) {}

  /**
   * Webhook verification endpoint (GET)
   * Meta sends this during webhook setup
   */
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') verifyToken: string,
  ) {
    this.logger.log('Social webhook verification request received');

    const configuredToken = process.env.SOCIAL_WEBHOOK_VERIFY_TOKEN;

    if (mode === 'subscribe' && verifyToken === configuredToken) {
      this.logger.log('✅ Social webhook verified successfully');
      return challenge;
    } else {
      this.logger.warn('❌ Social webhook verification failed');
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
  }

  /**
   * Webhook receiver endpoint (POST)
   * Meta sends Facebook/Instagram messages here
   */
  @Post('webhook')
  async receiveWebhook(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('x-hub-signature-256') signature: string,
    @Body() body: any,
  ) {
    try {
      this.logger.debug('Social webhook received');

      // Verify signature
      const rawBody = JSON.stringify(body);
      const isValid = this.socialService.verifyWebhookSignature(signature, rawBody);

      if (!isValid && signature) {
        this.logger.warn('Invalid webhook signature');
        return res.status(403).json({ error: 'Invalid signature' });
      }

      // Parse incoming message
      const incomingMessage = this.socialService.parseIncomingMessage(body);

      if (!incomingMessage) {
        // Not a message event, acknowledge anyway
        return res.status(200).json({ status: 'ok' });
      }

      this.logger.log(
        `Message received from ${incomingMessage.platform}: ${incomingMessage.from}`,
      );

      // Acknowledge to Meta immediately (must respond within 20 seconds)
      res.status(200).json({ status: 'ok' });

      // Process with AI asynchronously
      this.processMessageWithAI(incomingMessage).catch((error) => {
        this.logger.error(`Error processing message with AI: ${error.message}`);
      });
    } catch (error: any) {
      this.logger.error(`Error processing webhook: ${error.message}`);
      return res.status(200).json({ status: 'error' });
    }
  }

  /**
   * Process message with AI and send response
   */
  private async processMessageWithAI(incomingMessage: any) {
    try {
      this.logger.log(`Processing with AI: "${incomingMessage.text.substring(0, 50)}..."`);

      // Handle message with AI
      const result = await this.conversationHandler.handleSocialMessage(
        incomingMessage,
      );

      if (!result.success || !result.response) {
        this.logger.error(`AI processing failed: ${result.error}`);
        // Send error message
        if (incomingMessage.isComment()) {
          await this.socialService.replyToComment(
            incomingMessage.messageId,
            'Disculpá, tuve un problema procesando tu consulta. Por favor intentá de nuevo.',
          );
        } else {
          await this.socialService.sendDirectMessage(
            incomingMessage.senderId,
            'Disculpá, tuve un problema procesando tu mensaje. Por favor intentá de nuevo.',
          );
        }
        return;
      }

      // Send AI response
      this.logger.log(`Sending AI response to ${incomingMessage.from}`);

      let sendResult;
      if (incomingMessage.isComment()) {
        sendResult = await this.socialService.replyToComment(
          incomingMessage.messageId,
          result.response,
        );
      } else {
        sendResult = await this.socialService.sendDirectMessage(
          incomingMessage.senderId,
          result.response,
        );
      }

      if (sendResult.success) {
        this.logger.log(`✅ Response sent successfully: ${sendResult.messageId}`);
      } else {
        this.logger.error(`❌ Failed to send response: ${sendResult.error}`);
      }
    } catch (error: any) {
      this.logger.error(`Error in AI processing: ${error.message}`);
    }
  }

  /**
   * Test endpoint to send a message
   */
  @Post('send')
  async sendMessage(
    @Body() dto: { type: 'comment' | 'dm'; to: string; text: string },
  ) {
    if (!dto.to || !dto.text || !dto.type) {
      throw new HttpException(
        'Missing required fields: type, to, text',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      let result;
      if (dto.type === 'comment') {
        result = await this.socialService.replyToComment(dto.to, dto.text);
      } else {
        result = await this.socialService.sendDirectMessage(dto.to, dto.text);
      }

      if (!result.success) {
        throw new HttpException(result.error, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      return {
        success: true,
        messageId: result.messageId,
        type: dto.type,
        to: dto.to,
        text: dto.text,
      };
    } catch (error: any) {
      throw new HttpException(
        error.message || 'Failed to send message',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Health check endpoint
   */
  @Get('health')
  async healthCheck() {
    try {
      const isHealthy = await this.socialService.healthCheck();

      if (!isHealthy) {
        throw new HttpException(
          'Social media service unavailable',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      return {
        status: 'ok',
        service: 'social-media',
        platforms: ['facebook', 'instagram'],
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new HttpException(
        'Social media service unhealthy',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
