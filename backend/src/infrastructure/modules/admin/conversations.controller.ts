/**
 * INFRASTRUCTURE LAYER - Admin Conversations Controller
 * Manages conversation viewing, assignment, and manual takeover
 */

import {
  BadRequestException,
  NotFoundException,
  Controller,
  Get,
  HttpStatus,
  Post,
  Put,
  Body,
  Param,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Request,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConversationManagementService } from '../../../adapters/admin/conversation-management.service';
import { ConversationDocumentSenderService } from '../../../adapters/admin/conversation-document-sender.service';
import { OrderManagementService } from '../../../adapters/admin/order-management.service';
import { ClaudeService } from '../../../adapters/ai/claude.service';
import { ConversationSummaryService } from '../../../adapters/ai/conversation-summary.service';
import { claudeErrorMessage } from '../../../adapters/ai/claude-error-message';
import { ConversationScorerService } from '../../../adapters/quality/conversation-scorer.service';
import { PrismaClient } from '@prisma/client';
import { AIConversation, AIMessage } from '../../../domain/entities/ai-message.entity';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { Channel, ConversationStatus } from '@prisma/client';
import { NotificationsGateway } from '../../notifications/notifications.gateway';
import { MetricsBroadcaster } from '../../notifications/metrics-broadcaster.service';
import { AuditLogService } from '../../../adapters/audit/audit-log.service';
import {
  UploadStorageService,
  FileTooLargeError,
  DisallowedMimeError,
} from '../../../adapters/uploads/upload-storage.service';

@Controller('admin/conversations')
@UseGuards(AuthGuard, RolesGuard)
export class ConversationsController {
  private readonly logger = new Logger(ConversationsController.name);

  constructor(
    private readonly conversationManagement: ConversationManagementService,
    private readonly notifications: NotificationsGateway,
    private readonly metrics: MetricsBroadcaster,
    private readonly uploads: UploadStorageService,
    private readonly claude: ClaudeService,
    private readonly audit: AuditLogService,
    private readonly docSender: ConversationDocumentSenderService,
    private readonly orderManagement: OrderManagementService,
    private readonly summary: ConversationSummaryService,
    private readonly scorer: ConversationScorerService,
  ) {}

  private readonly scorePrisma = new PrismaClient();

  /**
   * Helper — extracts ip + UA off the express request for audit-log entries.
   * Same parsing the auth controller uses; centralized so we don't repeat
   * the header dance in every handler.
   */
  private auditCtx(req: any): { ip: string | null; userAgent: string | null } {
    const ip = (req?.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req?.ip || null;
    const userAgent = (req?.headers?.['user-agent'] as string) || null;
    return { ip, userAgent };
  }

  /**
   * Get conversation statistics
   * GET /admin/conversations/stats/summary
   */
  @Get('stats/summary')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getStatistics() {
    const stats = await this.conversationManagement.getStatistics();

    return {
      success: true,
      data: stats,
    };
  }

  /**
   * List all conversations with filters
   * GET /admin/conversations
   */
  @Get()
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async listConversations(
    @Request() req: any,
    @Query('channel') channel?: Channel,
    @Query('status') status?: ConversationStatus,
    @Query('search') search?: string,
    @Query('assignedTo') assignedTo?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.conversationManagement.listConversations({
      channel,
      status,
      search,
      assignedToUserId: assignedTo,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      scope: { userId: req.user.id, role: req.user.role },
    });

    return {
      success: true,
      data: result.conversations,
      total: result.total,
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
    };
  }

  /**
   * Get single conversation with full history
   * GET /admin/conversations/:id
   */
  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getConversation(@Param('id') id: string, @Request() req: any) {
    const conversation = await this.conversationManagement.getConversationById(id, {
      userId: req.user.id,
      role: req.user.role,
    });

    if (!conversation) {
      // 404 — covers both "row doesn't exist" and "exists but out of
      // your scope" (per-record scope check inside getConversationById).
      // Returning HTTP 404 keeps the frontend's catch block clean
      // instead of a 200 with success:false that the page renders by
      // crashing on undefined fields.
      throw new NotFoundException('Conversación no encontrada');
    }

    return {
      success: true,
      data: conversation,
    };
  }

  /**
   * Get the AI-generated conversational summary for this conversation.
   * Visible to anyone who can see the conversation itself — RBAC for
   * read is the same as the conversation thread (scope check via
   * getConversationById first; null means out-of-scope or doesn't
   * exist).
   * GET /admin/conversations/:id/summary
   */
  @Get(':id/summary')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getConversationSummary(@Param('id') id: string, @Request() req: any) {
    const conversation = await this.conversationManagement.getConversationById(id, {
      userId: req.user.id,
      role: req.user.role,
    });
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }
    const summary = await this.summary.getSummary(id);
    return { success: true, data: summary };
  }

  /**
   * Force a regenerate of the conversational summary. Useful when the
   * operator wants fresh context without waiting for the next customer
   * message to trigger the debounced background job. RBAC mirrors read.
   * POST /admin/conversations/:id/summary/regenerate
   */
  @Post(':id/summary/regenerate')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async regenerateConversationSummary(@Param('id') id: string, @Request() req: any) {
    const conversation = await this.conversationManagement.getConversationById(id, {
      userId: req.user.id,
      role: req.user.role,
    });
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }
    this.summary.scheduleRegenerate(id, true);
    return { success: true };
  }

  /**
   * Get the current quality score for this conversation. Returns null
   * when the conversation hasn't been scored yet (too short, or scorer
   * disabled). Visible to the same roles as conversation read.
   * GET /admin/conversations/:id/score
   */
  @Get(':id/score')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getConversationScore(@Param('id') id: string, @Request() req: any) {
    const conversation = await this.conversationManagement.getConversationById(id, {
      userId: req.user.id,
      role: req.user.role,
    });
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }
    const row = await this.scorePrisma.conversationScore.findUnique({
      where: { conversationId: id },
    });
    if (!row) {
      return { success: true, data: null };
    }
    return {
      success: true,
      data: {
        score: row.score,
        strengths: row.strengths,
        improvement: row.improvement,
        missedOpportunity: row.missedOpportunity,
        severeFlag: row.severeFlag,
        severeReason: row.severeReason,
        updatedAt: row.updatedAt.toISOString(),
      },
    };
  }

  /**
   * Force a Claude rescore of this conversation. Mirrors the summary
   * regenerate endpoint — useful when the operator wants fresh
   * feedback without waiting for the next message-debounce window.
   * POST /admin/conversations/:id/score/regenerate
   */
  @Post(':id/score/regenerate')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async regenerateConversationScore(@Param('id') id: string, @Request() req: any) {
    const conversation = await this.conversationManagement.getConversationById(id, {
      userId: req.user.id,
      role: req.user.role,
    });
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }
    this.scorer.scheduleLiveRescore(id, true);
    return { success: true };
  }

  /**
   * Assign conversation to user (manual takeover)
   * POST /admin/conversations/:id/assign
   */
  @Post(':id/assign')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async assignConversation(
    @Param('id') id: string,
    @Body() body: { userId: string },
    @Request() req: any,
  ) {
    const success = await this.conversationManagement.assignConversation(
      id,
      body.userId,
    );

    if (success) {
      this.logger.log(
        `Conversation ${id} assigned to user ${body.userId} by ${req.user.email}`,
      );
      const ctx = this.auditCtx(req);
      await this.audit.log({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'conversation.assign',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { conversationId: id, targetUserId: body.userId },
      });
      return { success: true, message: 'Conversation assigned' };
    } else {
      return { success: false, error: 'Failed to assign conversation' };
    }
  }

  /**
   * Take over conversation (assign to self)
   * POST /admin/conversations/:id/takeover
   */
  @Post(':id/takeover')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async takeoverConversation(@Param('id') id: string, @Request() req: any) {
    const userId = req.user.id;

    const success = await this.conversationManagement.assignConversation(id, userId);

    if (success) {
      this.logger.log(`Conversation ${id} taken over by ${req.user.email}`);
      const ctx = this.auditCtx(req);
      await this.audit.log({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'conversation.takeover',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { conversationId: id },
      });
      return { success: true, message: 'Conversation taken over' };
    } else {
      return { success: false, error: 'Failed to take over conversation' };
    }
  }

  /**
   * Update conversation status
   * PUT /admin/conversations/:id/status
   */
  @Put(':id/status')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: ConversationStatus },
    @Request() req: any,
  ) {
    const success = await this.conversationManagement.updateConversationStatus(
      id,
      body.status,
    );

    if (success) {
      const ctx = this.auditCtx(req);
      await this.audit.log({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'conversation.status.update',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { conversationId: id, newStatus: body.status },
      });
      return { success: true, message: 'Status updated' };
    } else {
      return { success: false, error: 'Failed to update status' };
    }
  }

  /**
   * Transfer a conversation to another user with an optional internal note.
   * The note is staff-only — never sent to the customer's channel.
   * POST /admin/conversations/:id/transfer
   */
  @Post(':id/transfer')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async transferConversation(
    @Param('id') id: string,
    @Body() body: { targetUserId: string; note?: string },
    @Request() req: any,
  ) {
    if (!body?.targetUserId) {
      return { success: false, error: 'targetUserId is required' };
    }
    const result = await this.conversationManagement.transferConversation({
      conversationId: id,
      fromUserId: req.user.id,
      toUserId: body.targetUserId,
      note: body.note,
    });
    if (result.success) {
      this.logger.log(
        `Conversation ${id} transferred by ${req.user.email} to user ${body.targetUserId}`,
      );
      this.notifications.emitToUser(body.targetUserId, 'conversation:transferred', {
        conversationId: id,
        fromUserId: req.user.id,
        fromUserName: req.user.name,
        note: result.note?.content ?? null,
        at: new Date().toISOString(),
      });
      this.metrics.emitTick('conversation_transferred');
      const ctx = this.auditCtx(req);
      await this.audit.log({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'conversation.transfer',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: {
          conversationId: id,
          targetUserId: body.targetUserId,
          hasNote: !!body.note,
        },
      });
    }
    return result;
  }

  /**
   * List internal notes attached to a conversation. Staff-only by definition.
   * GET /admin/conversations/:id/internal-notes
   */
  @Get(':id/internal-notes')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async listInternalNotes(@Param('id') id: string) {
    const notes = await this.conversationManagement.listInternalNotes(id);
    return { success: true, data: notes };
  }

  /**
   * Send manual message (human agent reply)
   * POST /admin/conversations/:id/message
   */
  /**
   * PATCH /admin/conversations/:id/ai-state
   * Body: { paused: boolean }
   *
   * Pause or resume the AI on a single conversation. While paused the
   * inbound pipeline still saves customer messages and runs lead/handoff
   * detection, but the AI does not respond — operators must reply
   * manually from the panel.
   *
   * Audit-logged. Broadcasts `conversation:ai_state_changed` so all open
   * panels update without a refresh.
   */
  @Put(':id/ai-state')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async setAiState(
    @Param('id') id: string,
    @Body() body: { paused: boolean },
    @Request() req: any,
  ) {
    const paused = body?.paused === true;
    const actorId = req.user.id;

    const updated = await this.conversationManagement.setAiPaused(id, paused, actorId);
    if (!updated) {
      return { success: false, error: 'conversation not found or update failed' };
    }

    // Notify any open panel so the toggle reflects elsewhere instantly.
    this.notifications.broadcast('conversation:ai_state_changed', {
      conversationId: updated.id,
      aiPaused: updated.aiPaused,
      aiPausedAt: updated.aiPausedAt ? updated.aiPausedAt.toISOString() : null,
      aiPausedBy: updated.aiPausedBy,
      actorId,
      at: new Date().toISOString(),
    });

    this.logger.log(
      `${paused ? 'Paused' : 'Resumed'} AI on conversation ${id} by ${req.user.email}`,
    );
    const ctx = this.auditCtx(req);
    await this.audit.log({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'conversation.ai_state.toggle',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { conversationId: id, paused },
    });
    return { success: true, data: updated };
  }

  /**
   * POST /admin/conversations/:id/upload
   * multipart/form-data: { file: <binary>, caption?: string }
   *
   * Uploads a file attachment (photo, PDF, video, audio) and saves it as
   * an outbound message in this conversation. Caption is the optional text
   * accompanying the media. RBAC mirrors the manual-message endpoint.
   */
  @Post(':id/upload')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  @UseInterceptors(FileInterceptor('file'))
  async uploadAttachment(
    @Param('id') id: string,
    @UploadedFile() file: any,
    @Body() body: { caption?: string },
    @Request() req: any,
  ) {
    if (!file) throw new BadRequestException('file field is required');

    let stored;
    try {
      stored = await this.uploads.store(file);
    } catch (err: any) {
      if (err instanceof FileTooLargeError || err instanceof DisallowedMimeError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const caption = (body?.caption ?? '').trim();
    const msg = await this.conversationManagement.sendManualAttachment({
      conversationId: id,
      userId: req.user.id,
      caption,
      attachmentUrl: stored.url,
      attachmentName: stored.name,
      attachmentMime: stored.mime,
      attachmentSize: stored.size,
      contentType: stored.contentType,
    });
    if (!msg) {
      return { success: false, error: 'Failed to save message' };
    }

    this.logger.log(
      `Attachment uploaded to ${id} by ${req.user.email} — ${stored.mime} ${stored.size}B`,
    );
    return {
      success: true,
      data: {
        messageId: msg.id,
        timestamp: msg.timestamp,
        attachment: {
          url: stored.url,
          name: stored.name,
          mime: stored.mime,
          size: stored.size,
          contentType: stored.contentType,
        },
        caption,
      },
    };
  }

  /**
   * POST /admin/conversations/:id/redact
   * Body: { draft?: string, mode?: 'improve' | 'suggest' }
   *
   * "Redactar con IA" — runs Claude on the operator's draft (or proposes a
   * fresh reply if the draft is empty), giving back polished Spanish text
   * to insert into the composer. Returns 200/`{success:false, reason:...}`
   * when Claude isn't configured so the UI can surface a friendly toast
   * rather than treat it as an error.
   */
  @Post(':id/redact')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async redactWithAi(
    @Param('id') id: string,
    @Body() body: { draft?: string; mode?: 'improve' | 'suggest' },
    @Request() req: any,
  ) {
    if (!this.claude.isAvailable()) {
      return {
        success: false,
        reason: 'CLAUDE_API_KEY no está configurada. Conectá la API key para activar la redacción con IA.',
      };
    }

    // Pull the conversation history we want Claude to see — last 10 turns
    // is plenty of context without blowing through the token budget.
    const detail = await this.conversationManagement.getConversationById(id);
    if (!detail) throw new BadRequestException('conversation not found');

    const history = new AIConversation(
      detail.messages.slice(-10).map((m) =>
        m.sender === 'CUSTOMER'
          ? AIMessage.fromUser(m.content)
          : AIMessage.fromAssistant(m.content),
      ),
    );

    try {
      const text = await this.claude.redactDraft({
        history,
        draft: body?.draft ?? '',
        mode: body?.mode,
      });
      if (text == null) {
        return { success: false, reason: claudeErrorMessage('claude returned null') };
      }
      this.logger.log(
        `Redactar con IA used by ${req.user.email} on ${id} (mode=${body?.mode ?? 'auto'})`,
      );
      return { success: true, data: { text } };
    } catch (err: any) {
      // Translate Anthropic SDK errors to operator-friendly Spanish so
      // billing / rate-limit / network problems surface with the right
      // action ("avisale a Marcos" vs "reintentá") instead of opaque
      // English JSON. We don't 500 — the rest of the page is fine.
      this.logger.warn(
        `Redactar con IA failed on ${id} for ${req.user.email}: ${err?.message ?? err}`,
      );
      return { success: false, reason: claudeErrorMessage(err) };
    }
  }

  /**
   * POST /admin/conversations/:id/send-quote/:quoteId
   * Body: { caption?: string }
   *
   * Renders the persisted quote as a PDF and dispatches it to the
   * conversation's customer through the channel pipeline. WhatsApp gets a
   * native document message (Meta Cloud API); other channels get a text
   * message with an HMAC-signed `/p/file/...` download link. Saves a
   * Message row with attachment metadata regardless, so the operator's
   * panel reflects the action immediately.
   */
  @Post(':id/send-quote/:quoteId')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async sendQuotePdf(
    @Param('id') id: string,
    @Param('quoteId') quoteId: string,
    @Body() body: { caption?: string },
    @Request() req: any,
  ) {
    const result = await this.docSender.sendQuote({
      conversationId: id,
      quoteId,
      userId: req.user.id,
      caption: body?.caption ?? '',
    });
    if (result.ok === false) {
      return { success: false, error: result.reason };
    }
    this.logger.log(`📄 Quote ${quoteId} sent to conversation ${id} by ${req.user.email}`);
    const ctx = this.auditCtx(req);
    await this.audit.log({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'conversation.quote.sent',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { conversationId: id, quoteId, messageId: result.messageId },
    });
    return {
      success: true,
      data: {
        messageId: result.messageId,
        attachmentUrl: result.attachmentUrl,
        attachmentName: result.attachmentName,
      },
    };
  }

  /**
   * POST /admin/conversations/:id/send-transcript
   * Body: { caption?: string }
   *
   * Renders the conversation transcript (Spanish PDF) and sends it to the
   * customer through the same channel pipeline used by send-quote. Useful
   * at end-of-conversation when the customer asks for a copy of what was
   * agreed.
   */
  @Post(':id/send-transcript')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async sendTranscript(
    @Param('id') id: string,
    @Body() body: { caption?: string },
    @Request() req: any,
  ) {
    const result = await this.docSender.sendTranscript({
      conversationId: id,
      userId: req.user.id,
      caption: body?.caption ?? '',
    });
    if (result.ok === false) {
      return { success: false, error: result.reason };
    }
    this.logger.log(`📄 Transcript sent to conversation ${id} by ${req.user.email}`);
    const ctx = this.auditCtx(req);
    await this.audit.log({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'conversation.transcript.sent',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { conversationId: id, messageId: result.messageId },
    });
    return {
      success: true,
      data: {
        messageId: result.messageId,
        attachmentUrl: result.attachmentUrl,
        attachmentName: result.attachmentName,
      },
    };
  }

  /**
   * GET /admin/conversations/:id/orders
   *
   * Lists the orders linked to this conversation. Open to all operator
   * roles so the chat sidebar can render "Pedidos de esta conversación"
   * without leaning on the global /admin/orders endpoint (which is
   * ADMIN+LOGISTICA only). Most recent first.
   */
  @Get(':id/orders')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async listConversationOrders(@Param('id') id: string) {
    const result = await this.orderManagement.listOrders({
      conversationId: id,
      limit: 50,
      offset: 0,
    });
    return { success: true, data: result.data, total: result.total };
  }

  /**
   * GET /admin/conversations/:id/pdf
   *
   * Streams the conversation as a PDF (Spanish format) suitable for
   * archives and defensa-al-consumidor responses. Open to all operator
   * roles since any of them might need to print history they're working
   * on.
   */
  @Get(':id/pdf')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async exportPdf(@Param('id') id: string, @Res() res: any) {
    const buf = await this.conversationManagement.renderPdf(id);
    if (!buf) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, error: 'not found' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="conversacion-${id.slice(0, 8)}.pdf"`);
    res.setHeader('Content-Length', String(buf.length));
    res.send(buf);
  }

  @Post(':id/message')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async sendMessage(
    @Param('id') id: string,
    @Body() body: { content: string },
    @Request() req: any,
  ) {
    const userId = req.user.id;

    const msg = await this.conversationManagement.sendManualMessage(
      id,
      userId,
      body.content,
    );

    if (msg) {
      this.logger.log(
        `Manual message sent in conversation ${id} by ${req.user.email}`,
      );
      // Return the persisted row so the client can drop it in place of
      // the optimistic temp message instead of refetching the whole
      // conversation. Wrapping under `data` triggers the response
      // interceptor to unwrap to the message object on the frontend.
      return { success: true, data: msg };
    } else {
      return { success: false, error: 'Failed to send message' };
    }
  }
}
