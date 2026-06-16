/**
 * INFRASTRUCTURE LAYER - MercadoLibre Controller
 * HTTP endpoints for MercadoLibre webhooks and messaging
 */

import { Controller, Get, Post, Body, Query, Logger, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { Channel, PrismaClient } from '@prisma/client';
import { MercadoLibreService } from '../../../adapters/mercadolibre/mercadolibre.service';
import { ConversationHandlerService } from '../../../adapters/conversations/conversation-handler.service';
import { ChannelGateService } from '../../../adapters/channel-gate/channel-gate.service';
import { MercadoLibreMessageType } from '../../../domain/entities/mercadolibre-message.entity';

@Controller('mercadolibre')
export class MercadoLibreController {
  private readonly logger = new Logger(MercadoLibreController.name);
  // Marcos 2026-06-11: small Prisma client local to the controller
  // for the review-mode helper below. Cross-module DI of
  // MercadolibreQaService would force MercadoLibreModule to import
  // AdminModule (circular), so we just hit the DB directly here.
  private readonly prisma = new PrismaClient();

  /**
   * Mark the most recent AI message in this ML buyer's conversation
   * as pending operator review. Called when ML_QA_REVIEW_MODE=true
   * — the AI draft is already saved by handleMercadoLibreMessage
   * a few ms before this runs; we just patch its metadata so the QA
   * panel can list it for release.
   */
  /**
   * Marcos 2026-06-12: read the runtime auto-reply switch backed by
   * the Configuration table. Lazy lookup per webhook — no caching;
   * if the admin flipped it 1ms ago the next inbound respects it.
   * Falls back to inverting ML_QA_REVIEW_MODE so the env-driven
   * behaviour stays correct until someone touches the toggle.
   */
  private async isAutoReplyOn(): Promise<boolean> {
    try {
      const row = await this.prisma.configuration.findUnique({
        where: { key: 'ml_qa_auto_reply_enabled' },
        select: { value: true, isActive: true },
      });
      if (!row || !row.isActive) {
        return (process.env.ML_QA_REVIEW_MODE ?? 'true').toLowerCase() !== 'true';
      }
      const v = row.value as any;
      return v === true || v === 'true';
    } catch {
      return (process.env.ML_QA_REVIEW_MODE ?? 'true').toLowerCase() !== 'true';
    }
  }

  private async markLatestDraftPending(
    questionId: string,
    mlBuyerId: string,
    mlAccountKey: string | null,
  ): Promise<void> {
    const contact = await this.prisma.contact.findFirst({
      where: {
        metadata: { path: ['mercadolibreUserId'], equals: mlBuyerId } as any,
      },
      select: { id: true },
    });
    if (!contact) return;
    const conversation = await this.prisma.conversation.findFirst({
      where: { contactId: contact.id, channel: Channel.MERCADOLIBRE },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (!conversation) return;
    const message = await this.prisma.message.findFirst({
      where: { conversationId: conversation.id, isFromAI: true },
      orderBy: { timestamp: 'desc' },
      select: { id: true, metadata: true },
    });
    if (!message) return;
    const prev = (message.metadata as Record<string, unknown> | null) ?? {};
    await this.prisma.message.update({
      where: { id: message.id },
      data: {
        metadata: {
          ...prev,
          pendingReview: true,
          mlQuestionId: questionId,
          mlAccountKey: mlAccountKey ?? null,
          markedPendingAt: new Date().toISOString(),
        } as any,
      },
    });
  }

  constructor(
    private readonly mercadolibreService: MercadoLibreService,
    private readonly conversationHandler: ConversationHandlerService,
    private readonly channelGate: ChannelGateService,
  ) {}

  /**
   * Webhook endpoint for MercadoLibre notifications
   * MercadoLibre sends notifications for new questions, messages, etc.
   */
  @Throttle({ default: { ttl: 60_000, limit: Number(process.env.THROTTLE_WEBHOOK_LIMIT) || 200 } })
  @Post('webhook')
  async handleWebhook(@Body() body: any, @Res() res: Response) {
    try {
      this.logger.log(`Webhook received: ${JSON.stringify(body)}`);

      // Immediately acknowledge webhook (MercadoLibre requires fast response)
      res.status(200).send('OK');

      if (!(await this.channelGate.isEnabled(Channel.MERCADOLIBRE))) {
        this.logger.warn('MercadoLibre channel disabled — dropping inbound');
        return;
      }

      // Parse the notification
      const notification = this.mercadolibreService.parseIncomingMessage(body);

      if (!notification) {
        this.logger.debug('Notification not processed (unsupported topic or invalid format)');
        return;
      }

      // Process asynchronously (after acknowledging MercadoLibre).
      // Bloque A items 1 + 2 — post-venta messages and claims take
      // different fetch + outbound paths than questions. Route by
      // topic instead of forcing every notification through the
      // question-answer flow.
      if (notification.type === MercadoLibreMessageType.MESSAGE) {
        this.processPostVentaWithAI(body, notification.id).catch((error) => {
          this.logger.error(`Error processing post-venta async: ${error.message}`);
        });
      } else if (notification.type === MercadoLibreMessageType.CLAIM) {
        this.processClaimWithAI(body, notification.id).catch((error) => {
          this.logger.error(`Error processing claim async: ${error.message}`);
        });
      } else {
        this.processNotificationWithAI(body, notification.id).catch((error) => {
          this.logger.error(`Error processing notification async: ${error.message}`);
        });
      }
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

      // Bloque B item 1 — resolve which cuenta this notification came
      // from so the conversation can be tagged for per-cuenta metrics.
      // The webhook carries user_id = ML seller id. Null when the
      // cuenta isn't connected to any OAuthCredential row (defensive
      // — drops back to legacy untagged behaviour).
      const mlAccountKey = await this.mercadolibreService.resolveAccountKey(
        webhookBody?.user_id,
      );

      // Fetch full question details from MercadoLibre API
      const question = await this.mercadolibreService.fetchQuestionDetails(
        questionId,
        mlAccountKey,
      );

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

      // Marcos 2026-06-11: review mode. When ML_QA_REVIEW_MODE is on,
      // the AI response stays as a draft inside the conversation
      // instead of going straight to ML — the operator opens the
      // ML QA panel, edits if needed, and clicks "Enviar a ML" to
      // release. Mark the freshly-saved AI message so the QA panel
      // can pick it up. handleMercadoLibreMessage already persisted
      // the message; we flag it here via metadata.
      // Marcos 2026-06-12: the runtime AI-auto-reply override stored
      // in the Configuration table wins over the .env flag so an
      // admin can pause / resume the autoresponder from the UI
      // without a redeploy. Default (no row, no env) stays in
      // review-mode — drafts only.
      const reviewMode = !(await this.isAutoReplyOn());
      if (reviewMode) {
        await this.markLatestDraftPending(
          question.id,
          question.fromId,
          mlAccountKey ?? null,
        ).catch((err: any) =>
          this.logger.warn(`mark-pending failed for ${questionId}: ${err?.message ?? err}`),
        );
        this.logger.log(
          `📝 ML draft pending review for ${questionId} — auto-send disabled by ML_QA_REVIEW_MODE`,
        );
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

  /**
   * Bloque A item 1 — Marcos 2026-06-06: post-venta ML pipeline. The
   * shape mirrors `processNotificationWithAI` but pulls the message
   * body from the post-purchase chat endpoint AND sends the AI reply
   * back through `/messages/packs/...` instead of `/answers`.
   *
   * Gated by ML_POST_VENTA_ENABLED so Marcos can flip the feature
   * once the ML app is subscribed to the `messages` topic.
   */
  private async processPostVentaWithAI(webhookBody: any, packId: string) {
    if ((process.env.ML_POST_VENTA_ENABLED ?? 'true').toLowerCase() === 'false') {
      this.logger.debug(`Post-venta disabled by env — skipping pack ${packId}`);
      return;
    }
    try {
      this.logger.debug(`Processing post-venta pack ${packId} with AI`);
      const mlAccountKey = await this.mercadolibreService.resolveAccountKey(
        webhookBody?.user_id,
      );
      const account: 'mercadolibre' | 'mercadolibre_cuenta2' =
        mlAccountKey === 'mercadolibre_cuenta2' ? 'mercadolibre_cuenta2' : 'mercadolibre';
      const message = await this.mercadolibreService.fetchPostVentaMessage(
        packId,
        account,
      );
      if (!message) {
        this.logger.debug(`No unread buyer message in pack ${packId} — skipping`);
        return;
      }
      const result = await this.conversationHandler.handleMercadoLibreMessage(message);
      if (!result.success || !result.response) {
        this.logger.error(`Post-venta AI failed for pack ${packId}: ${result.error}`);
        return;
      }
      // Auto-reply is gated behind a second env flag. Default OFF —
      // ML post-venta messages first land in the conversation panel
      // (already handled by `handleMercadoLibreMessage` saving the
      // inbound + draft) and Marcos / Brenda send the reply manually
      // until he greenlights the autoresponder. Flip to true to let
      // the AI close the loop.
      if ((process.env.ML_POST_VENTA_AUTO_REPLY ?? 'false').toLowerCase() !== 'true') {
        this.logger.log(
          `📝 Post-venta AI draft ready for pack ${packId} — auto-reply disabled, operator must send manually`,
        );
        return;
      }
      const send = await this.mercadolibreService.sendPostVentaMessage({
        packId,
        buyerId: message.fromId,
        text: result.response,
        accountKey: account,
      });
      if (send.success) {
        this.logger.log(`✅ Post-venta reply sent for pack ${packId}`);
      } else {
        this.logger.error(`Post-venta send failed for pack ${packId}: ${send.error}`);
      }
    } catch (error: any) {
      this.logger.error(`Error in processPostVentaWithAI: ${error.message}`);
    }
  }

  /**
   * Bloque A item 2 — Marcos 2026-06-06: reclamos ML. Pull the
   * claim detail (type / status / stage / reason) and route through
   * `handleMercadoLibreMessage` so the existing CLAIM branch saves
   * the enriched body + escalates to human handoff. We never
   * auto-reply on claims — they always land in the operator queue.
   */
  private async processClaimWithAI(webhookBody: any, claimId: string) {
    if ((process.env.ML_CLAIMS_ENABLED ?? 'true').toLowerCase() === 'false') {
      this.logger.debug(`Claims disabled by env — skipping ${claimId}`);
      return;
    }
    try {
      this.logger.debug(`Processing claim ${claimId}`);
      const mlAccountKey = await this.mercadolibreService.resolveAccountKey(
        webhookBody?.user_id,
      );
      const account: 'mercadolibre' | 'mercadolibre_cuenta2' =
        mlAccountKey === 'mercadolibre_cuenta2' ? 'mercadolibre_cuenta2' : 'mercadolibre';
      const claim = await this.mercadolibreService.fetchClaimDetails(claimId, account);
      if (!claim) {
        this.logger.warn(`Could not fetch claim details: ${claimId}`);
        return;
      }
      // handleMercadoLibreMessage's CLAIM branch already saves the
      // inbound + escalates. Sending the enriched message gets the
      // claim type/reason into the conversation panel.
      await this.conversationHandler.handleMercadoLibreMessage(claim);
      this.logger.log(`📩 Claim ${claimId} routed to human handoff queue`);
    } catch (error: any) {
      this.logger.error(`Error in processClaimWithAI: ${error.message}`);
    }
  }
}
