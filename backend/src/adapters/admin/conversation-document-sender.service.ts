/**
 * ADAPTERS LAYER — Send-PDF-to-customer pipeline.
 *
 * One-stop service that takes either a quote or a conversation transcript,
 * renders it to a PDF buffer with the existing builders, persists it through
 * the standard `UploadStorageService`, and dispatches it through the
 * conversation's bound channel via `ConversationManagementService.
 * sendManualAttachment` (which already handles WhatsApp's native document
 * shape and writes the Message row).
 *
 * The result is a Message + a stored file the customer can fetch — exact
 * same contract whether the operator picks "send presupuesto X" or "send
 * transcript". The endpoint surface stays small (two methods); the channel
 * fan-out lives in the existing pipeline.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ContentType } from '@prisma/client';
import { ConversationManagementService } from './conversation-management.service';
import { QuoteService } from './quote.service';
import { UploadStorageService } from '../uploads/upload-storage.service';

export interface SendDocumentResult {
  ok: true;
  messageId: string;
  attachmentUrl: string;
  attachmentName: string;
}
export interface SendDocumentFailure {
  ok: false;
  reason: string;
}

@Injectable()
export class ConversationDocumentSenderService {
  private readonly logger = new Logger(ConversationDocumentSenderService.name);

  constructor(
    private readonly conversations: ConversationManagementService,
    private readonly quotes: QuoteService,
    private readonly uploads: UploadStorageService,
  ) {}

  async sendQuote(args: {
    conversationId: string;
    quoteId: string;
    userId: string;
    caption?: string;
  }): Promise<SendDocumentResult | SendDocumentFailure> {
    const buffer = await this.quotes.renderPdf(args.quoteId);
    if (!buffer) {
      return { ok: false, reason: 'quote not found' };
    }
    const quote = await this.quotes.getById(args.quoteId);
    const filename = `presupuesto-${quote?.quoteNumber ?? args.quoteId.slice(0, 8)}.pdf`;
    return this.dispatch({
      conversationId: args.conversationId,
      userId: args.userId,
      caption: args.caption ?? '',
      buffer,
      filename,
    });
  }

  async sendTranscript(args: {
    conversationId: string;
    userId: string;
    caption?: string;
  }): Promise<SendDocumentResult | SendDocumentFailure> {
    const buffer = await this.conversations.renderPdf(args.conversationId);
    if (!buffer) {
      return { ok: false, reason: 'conversation not found' };
    }
    const filename = `conversacion-${args.conversationId.slice(0, 8)}.pdf`;
    return this.dispatch({
      conversationId: args.conversationId,
      userId: args.userId,
      caption: args.caption ?? '',
      buffer,
      filename,
    });
  }

  private async dispatch(args: {
    conversationId: string;
    userId: string;
    caption: string;
    buffer: Buffer;
    filename: string;
  }): Promise<SendDocumentResult | SendDocumentFailure> {
    let stored;
    try {
      stored = await this.uploads.store({
        buffer: args.buffer,
        originalname: args.filename,
        mimetype: 'application/pdf',
        size: args.buffer.length,
      });
    } catch (err: any) {
      this.logger.error(`PDF storage failed: ${err.message}`);
      return { ok: false, reason: `failed to store PDF: ${err.message}` };
    }

    const msg = await this.conversations.sendManualAttachment({
      conversationId: args.conversationId,
      userId: args.userId,
      caption: args.caption,
      attachmentUrl: stored.url,
      attachmentName: stored.name,
      attachmentMime: stored.mime,
      attachmentSize: stored.size,
      contentType: ContentType.DOCUMENT,
    });
    if (!msg) {
      return { ok: false, reason: 'failed to save message' };
    }
    return {
      ok: true,
      messageId: msg.id,
      attachmentUrl: stored.url,
      attachmentName: stored.name,
    };
  }
}
