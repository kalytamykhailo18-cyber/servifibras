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
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Channel } from '@prisma/client';
import { SocialMediaService } from '../../../adapters/social/social-media.service';
import { MetaAdsService } from '../../../adapters/social/meta-ads.service';
import { ConversationHandlerService } from '../../../adapters/conversations/conversation-handler.service';
import { ChannelGateService } from '../../../adapters/channel-gate/channel-gate.service';
import { SocialPlatform } from '../../../domain/entities/social-message.entity';

@Controller('social')
export class SocialController {
  private readonly logger = new Logger(SocialController.name);

  constructor(
    private readonly socialService: SocialMediaService,
    private readonly conversationHandler: ConversationHandlerService,
    private readonly channelGate: ChannelGateService,
    private readonly metaAds: MetaAdsService,
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
  @Throttle({ default: { ttl: 60_000, limit: Number(process.env.THROTTLE_WEBHOOK_LIMIT) || 200 } })
  @Post('webhook')
  async receiveWebhook(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('x-hub-signature-256') signature: string,
    @Body() body: any,
  ) {
    try {
      this.logger.debug('Social webhook received');

      // Signature enforcement (see WhatsAppController for the full rationale).
      // When the app secret is configured, missing-header and forged-hash
      // both get 403. Without a secret (dev/onboarding) we allow + warn.
      const hasSecret = !!process.env.FACEBOOK_APP_SECRET;
      const rawBody = JSON.stringify(body);
      if (hasSecret) {
        if (!signature) {
          this.logger.warn('Missing x-hub-signature-256 header — rejecting');
          return res.status(403).json({ error: 'Missing signature' });
        }
        if (!this.socialService.verifyWebhookSignature(signature, rawBody)) {
          this.logger.warn('Invalid x-hub-signature-256 — rejecting');
          return res.status(403).json({ error: 'Invalid signature' });
        }
      }

      // Meta Ads — leadgen branch. The same webhook URL receives
      // lead-form submissions (entry[].changes[].field='leadgen').
      // Gated by META_ADS_LEADGEN_ENABLED inside the service so the
      // call is a cheap no-op until Marcos's verification clears.
      const leadgenEvents = this.metaAds.extractLeadgenEvents(body);
      if (leadgenEvents.length > 0) {
        res.status(200).json({ status: 'ok' });
        this.metaAds.processWebhookBody(body).catch((err: any) => {
          this.logger.error(`Meta Ads leadgen processing failed: ${err?.message}`);
        });
        return;
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

      // Channel gate — checked AFTER parsing because FB and IG share one
      // webhook and we only know which channel it is once parsed.
      const channel =
        incomingMessage.platform === SocialPlatform.FACEBOOK
          ? Channel.FACEBOOK
          : Channel.INSTAGRAM;
      if (!(await this.channelGate.isEnabled(channel))) {
        this.logger.warn(`${channel} channel disabled — dropping inbound`);
        return res.status(200).json({ status: 'channel_disabled' });
      }

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
