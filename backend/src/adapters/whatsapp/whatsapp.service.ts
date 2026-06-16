/**
 * ADAPTERS LAYER - WhatsApp Service Implementation
 * Implements IWhatsAppService using Meta Cloud API (WhatsApp Business API)
 */

import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ContentType } from '@prisma/client';
import { IWhatsAppService } from '../../use-cases/whatsapp/whatsapp.interface';
import {
  WhatsAppIncomingMessage,
  WhatsAppOutgoingMessage,
  WhatsAppSendResult,
  WhatsAppMessageType,
} from '../../domain/entities/whatsapp-message.entity';

/** Meta Cloud API media-message types we emit. */
type MetaMediaType = 'audio' | 'image' | 'video' | 'document';

export interface SendMediaArgs {
  /** E.164 phone of the recipient. */
  to: string;
  /** Absolute path to the file on disk. Must be readable by the backend. */
  filePath: string;
  /** Original filename — only used for `document` so the customer sees a sane name. */
  filename: string;
  /** MIME type as detected at upload time. */
  mime: string;
  /** Domain ContentType so we can derive the right Meta media-message shape. */
  contentType: ContentType;
  /** Optional text the customer will see alongside the media (image/video/document only). */
  caption?: string;
}

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

  /**
   * Send a media attachment (audio, image, video, document) to a WhatsApp
   * recipient. Two HTTP calls to Meta:
   *   1. POST /{phoneNumberId}/media — uploads the binary, returns `{id}`.
   *   2. POST /{phoneNumberId}/messages — sends `type:<media>` referencing
   *      the returned id.
   *
   * Voice notes specifically need `voice:true` on the audio shape; otherwise
   * Meta renders the audio as a generic file attachment instead of the
   * native voice-note bubble. That distinction is exactly what Marcos
   * flagged about prometheo's outbound — files-instead-of-voice-notes
   * generates customer mistrust.
   */
  async sendMedia(args: SendMediaArgs): Promise<WhatsAppSendResult> {
    if (!this.isConfigured) {
      return WhatsAppSendResult.failure('WhatsApp not configured');
    }
    if (!args.to || !args.filePath || !args.mime) {
      return WhatsAppSendResult.failure('Invalid media args');
    }
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(args.filePath);
    } catch (err: any) {
      this.logger.error(`Cannot read media file ${args.filePath}: ${err.message}`);
      return WhatsAppSendResult.failure('Media file unreadable');
    }

    const metaType = mediaTypeFromContentType(args.contentType);
    if (!metaType) {
      return WhatsAppSendResult.failure(
        `ContentType ${args.contentType} not sendable as media`,
      );
    }

    let mediaId: string;
    try {
      mediaId = await this.uploadMedia(buffer, args.filename, args.mime);
    } catch (err: any) {
      this.logger.error(`Meta media upload failed: ${err.message}`);
      return WhatsAppSendResult.failure(`Media upload failed: ${err.message}`);
    }

    return this.sendMediaMessage(args.to, metaType, mediaId, args);
  }

  /**
   * Upload binary to Meta's /media endpoint and return the media-id we'll
   * reference when sending the message. Public so tests can exercise the
   * upload path independently from the message-send path.
   */
  async uploadMedia(buffer: Buffer, filename: string, mime: string): Promise<string> {
    if (!this.isConfigured) {
      throw new Error('WhatsApp not configured');
    }
    const url = `${this.apiUrl}/${this.phoneNumberId}/media`;
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mime);
    // Use the runtime Blob so undici picks the right multipart shape; node's
    // FormData rejects raw Buffers as fields.
    // Cast to Uint8Array — Buffer is a subclass but TypeScript's lib.dom
    // BlobPart constraint specifically forbids SharedArrayBuffer-backed
    // views, which `Buffer` technically allows.
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), filename);

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: form,
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data?.id) {
      const reason = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(reason);
    }
    return String(data.id);
  }

  /**
   * Inbound media download — given a Meta `mediaId` (from a customer's
   * image / voice note / video / document message), fetch the temporary
   * Graph API URL and download the binary. Returns the bytes + the
   * server-reported MIME type so the caller can stash it under
   * UPLOADS_DIR via `UploadStorageService.store`.
   *
   * Marcos 2026-06-06: Phase 1 wrap-up. Before this, the inbound handler
   * dropped any non-text message on the floor — customers' voice notes
   * and photos never reached the operator panel. With this in place the
   * conversation handler can persist the media + show it in the bubble.
   *
   * Returns `null` when WA isn't configured, the mediaId resolution
   * fails, or the binary fetch errors. Errors are non-fatal.
   */
  async downloadIncomingMedia(mediaId: string): Promise<{
    buffer: Buffer;
    mime: string;
  } | null> {
    if (!this.isConfigured || !mediaId) return null;
    try {
      // Step 1 — resolve the mediaId to a short-lived signed URL.
      const metaRes = await fetch(`${this.apiUrl}/${mediaId}`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (!metaRes.ok) {
        this.logger.warn(`WA media resolve failed for ${mediaId}: HTTP ${metaRes.status}`);
        return null;
      }
      const metaJson: any = await metaRes.json().catch(() => ({}));
      const url = metaJson?.url;
      const mime = String(metaJson?.mime_type || '').toLowerCase();
      if (!url) {
        this.logger.warn(`WA media resolve returned no url for ${mediaId}`);
        return null;
      }
      // Step 2 — download the binary. Meta's CDN requires the same bearer.
      const binRes = await fetch(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (!binRes.ok) {
        this.logger.warn(`WA media download failed for ${mediaId}: HTTP ${binRes.status}`);
        return null;
      }
      const arrayBuf = await binRes.arrayBuffer();
      return { buffer: Buffer.from(arrayBuf), mime };
    } catch (err: any) {
      this.logger.warn(`WA media download errored for ${mediaId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Build the messages payload referencing an already-uploaded media id and
   * POST it. Split out from `sendMedia` so caller paths that already have a
   * media-id (e.g. forwarding) can reuse it.
   */
  async sendMediaMessage(
    to: string,
    metaType: MetaMediaType,
    mediaId: string,
    extras: { caption?: string; filename?: string },
  ): Promise<WhatsAppSendResult> {
    if (!this.isConfigured) {
      return WhatsAppSendResult.failure('WhatsApp not configured');
    }

    const mediaShape: any = { id: mediaId };
    // `voice:true` is what flips the bubble from "audio file" to native
    // voice note in the customer's WhatsApp. Defining it on the audio
    // path only — image/video/document don't accept it.
    if (metaType === 'audio') {
      mediaShape.voice = true;
    } else if (extras.caption && extras.caption.length > 0) {
      mediaShape.caption = extras.caption;
    }
    if (metaType === 'document' && extras.filename) {
      mediaShape.filename = extras.filename;
    }

    const payload: any = {
      messaging_product: 'whatsapp',
      to,
      type: metaType,
      [metaType]: mediaShape,
    };

    try {
      const res = await fetch(`${this.apiUrl}/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        return WhatsAppSendResult.failure(data?.error?.message || `HTTP ${res.status}`);
      }
      const messageId = data.messages?.[0]?.id;
      if (!messageId) return WhatsAppSendResult.failure('No message ID returned');
      this.logger.log(`✅ WhatsApp ${metaType} sent: ${messageId}`);
      return WhatsAppSendResult.success(messageId);
    } catch (err: any) {
      this.logger.error(`Error sending WhatsApp ${metaType}: ${err.message}`);
      return WhatsAppSendResult.failure(err.message);
    }
  }

  /**
   * Build the exact JSON payload that `sendMediaMessage` would POST. Pure,
   * side-effect free — used by tests to assert payload shape (especially
   * `voice:true` on audio) without hitting the real Meta endpoint.
   */
  buildMediaPayload(
    to: string,
    contentType: ContentType,
    mediaId: string,
    extras: { caption?: string; filename?: string } = {},
  ): { ok: true; payload: any } | { ok: false; reason: string } {
    const metaType = mediaTypeFromContentType(contentType);
    if (!metaType) {
      return { ok: false, reason: `ContentType ${contentType} not sendable as media` };
    }
    const mediaShape: any = { id: mediaId };
    if (metaType === 'audio') {
      mediaShape.voice = true;
    } else if (extras.caption && extras.caption.length > 0) {
      mediaShape.caption = extras.caption;
    }
    if (metaType === 'document' && extras.filename) {
      mediaShape.filename = extras.filename;
    }
    return {
      ok: true,
      payload: {
        messaging_product: 'whatsapp',
        to,
        type: metaType,
        [metaType]: mediaShape,
      },
    };
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

function mediaTypeFromContentType(c: ContentType): MetaMediaType | null {
  switch (c) {
    case ContentType.VOICE:    return 'audio';
    case ContentType.IMAGE:    return 'image';
    case ContentType.VIDEO:    return 'video';
    case ContentType.DOCUMENT: return 'document';
    default: return null; // TEXT, LOCATION — caller bug or unsupported
  }
}
