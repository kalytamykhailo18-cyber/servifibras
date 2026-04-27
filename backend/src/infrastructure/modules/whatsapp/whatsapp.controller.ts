/**
 * INFRASTRUCTURE LAYER - WhatsApp Controller
 * HTTP endpoints for WhatsApp webhook and testing
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
import { WhatsAppService } from '../../../adapters/whatsapp/whatsapp.service';
import { ConversationHandlerService } from '../../../adapters/conversations/conversation-handler.service';
import { WhatsAppOutgoingMessage } from '../../../domain/entities/whatsapp-message.entity';

@Controller('whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private readonly whatsappService: WhatsAppService,
    private readonly conversationHandler: ConversationHandlerService,
  ) {}

  /**
   * Webhook verification endpoint (GET)
   * Meta sends this during webhook setup to verify ownership
   */
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') verifyToken: string,
  ) {
    this.logger.log('Webhook verification request received');

    // Get configured verify token from env
    const configuredToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

    if (mode === 'subscribe' && verifyToken === configuredToken) {
      this.logger.log('✅ Webhook verified successfully');
      return challenge; // Return challenge as plain text
    } else {
      this.logger.warn('❌ Webhook verification failed');
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
  }

  /**
   * Webhook receiver endpoint (POST)
   * Meta sends incoming messages here
   */
  @Post('webhook')
  async receiveWebhook(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('x-hub-signature-256') signature: string,
    @Body() body: any,
  ) {
    try {
      this.logger.debug('Webhook received');

      // Verify signature (security check)
      const rawBody = JSON.stringify(body);
      const isValid = this.whatsappService.verifyWebhookSignature(signature, rawBody);

      if (!isValid && signature) {
        // If signature provided but invalid, reject
        this.logger.warn('Invalid webhook signature');
        return res.status(403).json({ error: 'Invalid signature' });
      }

      // Parse incoming message
      const incomingMessage = this.whatsappService.parseIncomingMessage(body);

      if (!incomingMessage) {
        // Not a message event (could be status update), acknowledge anyway
        return res.status(200).json({ status: 'ok' });
      }

      this.logger.log(
        `Message received from ${incomingMessage.from}: "${incomingMessage.text}"`,
      );

      // Mark as read immediately (blue checkmarks)
      await this.whatsappService.markAsRead(incomingMessage.messageId);

      // Acknowledge to Meta immediately (must respond within 20 seconds)
      // Process AI response asynchronously to avoid timeout
      res.status(200).json({ status: 'ok' });

      // Process with AI and send response (async, don't await)
      this.processMessageWithAI(incomingMessage).catch((error) => {
        this.logger.error(`Error processing message with AI: ${error.message}`);
      });
    } catch (error: any) {
      this.logger.error(`Error processing webhook: ${error.message}`);
      // Still return 200 to prevent Meta from retrying
      return res.status(200).json({ status: 'error' });
    }
  }

  /**
   * Process message with AI and send response
   * Called asynchronously after webhook acknowledgment
   */
  private async processMessageWithAI(incomingMessage: any) {
    try {
      // Only process text messages
      if (!incomingMessage.isTextMessage()) {
        this.logger.debug('Non-text message, skipping AI processing');
        return;
      }

      this.logger.log(`Processing with AI: "${incomingMessage.text.substring(0, 50)}..."`);

      // Handle message with AI
      const result = await this.conversationHandler.handleWhatsAppMessage(
        incomingMessage,
      );

      if (!result.success || !result.response) {
        this.logger.error(`AI processing failed: ${result.error}`);
        // Send error message to customer
        await this.whatsappService.sendTextMessage(
          incomingMessage.from,
          'Disculpá, tuve un problema procesando tu mensaje. Por favor intentá de nuevo.',
        );
        return;
      }

      // Send AI response via WhatsApp
      this.logger.log(`Sending AI response to ${incomingMessage.from}`);
      const sendResult = await this.whatsappService.sendTextMessage(
        incomingMessage.from,
        result.response,
      );

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
   * For testing without needing to receive a webhook
   */
  @Post('send')
  async sendMessage(@Body() dto: { to: string; text: string }) {
    if (!dto.to || !dto.text) {
      throw new HttpException(
        'Missing required fields: to, text',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.whatsappService.sendTextMessage(dto.to, dto.text);

      if (!result.success) {
        throw new HttpException(result.error, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      return {
        success: true,
        messageId: result.messageId,
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
      const isHealthy = await this.whatsappService.healthCheck();

      if (!isHealthy) {
        throw new HttpException(
          'WhatsApp service unavailable',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      return {
        status: 'ok',
        service: 'whatsapp',
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new HttpException(
        'WhatsApp service unhealthy',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
