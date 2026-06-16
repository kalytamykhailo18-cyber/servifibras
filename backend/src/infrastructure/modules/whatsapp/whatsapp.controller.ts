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
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Channel } from '@prisma/client';
import { WhatsAppService } from '../../../adapters/whatsapp/whatsapp.service';
import { ConversationHandlerService } from '../../../adapters/conversations/conversation-handler.service';
import { ChannelGateService } from '../../../adapters/channel-gate/channel-gate.service';
import {
  UploadStorageService,
  DisallowedMimeError,
  FileTooLargeError,
} from '../../../adapters/uploads/upload-storage.service';
import { WhatsAppOutgoingMessage, WhatsAppMessageType } from '../../../domain/entities/whatsapp-message.entity';

@Controller('whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private readonly whatsappService: WhatsAppService,
    private readonly conversationHandler: ConversationHandlerService,
    private readonly channelGate: ChannelGateService,
    private readonly uploads: UploadStorageService,
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
  @Throttle({ default: { ttl: 60_000, limit: Number(process.env.THROTTLE_WEBHOOK_LIMIT) || 200 } })
  @Post('webhook')
  async receiveWebhook(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('x-hub-signature-256') signature: string,
    @Body() body: any,
  ) {
    try {
      this.logger.debug('Webhook received');

      // Signature enforcement.
      //
      // When WHATSAPP_APP_SECRET is configured (production), every request
      // MUST carry a valid x-hub-signature-256 — both missing-header and
      // forged-hash get 403. The previous implementation only rejected
      // forged hashes when a header was present, which let an attacker
      // bypass verification by simply omitting the header.
      //
      // When WHATSAPP_APP_SECRET is not set (dev / onboarding before Meta
      // access), we allow the request through with a warning log so local
      // testing still works. This matches the previous dev-mode behaviour.
      const hasSecret = !!process.env.WHATSAPP_APP_SECRET;
      const rawBody = JSON.stringify(body);
      if (hasSecret) {
        if (!signature) {
          this.logger.warn('Missing x-hub-signature-256 header — rejecting');
          return res.status(403).json({ error: 'Missing signature' });
        }
        if (!this.whatsappService.verifyWebhookSignature(signature, rawBody)) {
          this.logger.warn('Invalid x-hub-signature-256 — rejecting');
          return res.status(403).json({ error: 'Invalid signature' });
        }
      }

      // Channel gate — admin can flip WhatsApp off from the panel; if so, ack
      // 200 (so Meta doesn't retry) but skip all processing.
      if (!(await this.channelGate.isEnabled(Channel.WHATSAPP))) {
        this.logger.warn('WhatsApp channel disabled — dropping inbound');
        return res.status(200).json({ status: 'channel_disabled' });
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
      // Inbound media (voice / image / video / document) — download from
      // Meta, store under UPLOADS_DIR, persist a CUSTOMER message with
      // the attachment fields. Marcos 2026-06-06: before this branch,
      // any non-text message dropped on the floor and the operator never
      // saw the customer's voice note or photo.
      if (incomingMessage.hasMedia && incomingMessage.hasMedia()) {
        await this.persistInboundMedia(incomingMessage);
      }

      // Only the text path continues into AI. A media-only inbound is
      // already persisted above; no caption means there's nothing for
      // the agent to answer. Caption-bearing media still go through AI
      // below because `incomingMessage.text` is the caption.
      if (!incomingMessage.isTextMessage()) {
        if (!incomingMessage.text || incomingMessage.text.length === 0) {
          this.logger.debug('Media-only inbound — persisted, AI skipped');
          return;
        }
      }

      this.logger.log(`Processing with AI: "${(incomingMessage.text || '').substring(0, 50)}..."`);

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
   * Download the inbound media binary from Meta, run it through
   * UploadStorageService (mime/size validation + on-disk write under
   * UPLOADS_DIR), and hand the StoredFile metadata to the conversation
   * handler so a CUSTOMER message row gets created with the attachment
   * fields populated. Errors are logged but non-fatal — the controller
   * already 200'd to Meta; failing to persist media shouldn't crash the
   * webhook handler. The text path can still run downstream.
   */
  private async persistInboundMedia(incomingMessage: any): Promise<void> {
    try {
      const mediaId: string | null = incomingMessage.mediaId ?? null;
      if (!mediaId) return;
      const downloaded = await this.whatsappService.downloadIncomingMedia(mediaId);
      if (!downloaded) return;

      // Derive a sensible filename. WA voice notes come as
      // audio/ogg with no original name — synthesize one with the
      // timestamp so the operator panel shows something readable.
      const extFromMime: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/png':  '.png',
        'image/webp': '.webp',
        'audio/ogg':  '.ogg',
        'audio/mp4':  '.m4a',
        'audio/mpeg': '.mp3',
        'audio/webm': '.webm',
        'video/mp4':  '.mp4',
        'application/pdf': '.pdf',
      };
      const ext = extFromMime[downloaded.mime] ?? '.bin';
      const type = String(incomingMessage.type || 'media');
      const ts = incomingMessage.timestamp instanceof Date
        ? incomingMessage.timestamp
        : new Date();
      const stamp =
        ts.getFullYear().toString() +
        String(ts.getMonth() + 1).padStart(2, '0') +
        String(ts.getDate()).padStart(2, '0') + '-' +
        String(ts.getHours()).padStart(2, '0') +
        String(ts.getMinutes()).padStart(2, '0');
      const filename = `wa-${type}-${stamp}${ext}`;

      let stored;
      try {
        stored = await this.uploads.store({
          buffer: downloaded.buffer,
          originalname: filename,
          mimetype: downloaded.mime,
          size: downloaded.buffer.length,
        });
      } catch (err: any) {
        if (err instanceof FileTooLargeError || err instanceof DisallowedMimeError) {
          this.logger.warn(`WA inbound media rejected (${err.message}) for ${incomingMessage.from}`);
        } else {
          throw err;
        }
        return;
      }

      await this.conversationHandler.persistInboundWhatsAppAttachment({
        from: incomingMessage.from,
        timestamp: ts,
        caption: incomingMessage.text ?? null,
        attachment: {
          url: stored.url,
          name: stored.name,
          mime: stored.mime,
          size: stored.size,
          contentType: stored.contentType,
        },
      });
      this.logger.log(
        `📥 WA inbound ${type} persisted (${stored.size}B ${stored.mime}) from ${incomingMessage.from}`,
      );
    } catch (err: any) {
      this.logger.error(`Failed to persist WA inbound media: ${err.message}`);
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
