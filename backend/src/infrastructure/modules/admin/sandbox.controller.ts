/**
 * INFRASTRUCTURE LAYER - Sandbox ("Probar como cliente") Controller
 *
 * Lets an authenticated operator chat with the agent in the customer
 * role from inside the panel, on either the TiendaNube webchat or the
 * MercadoLibre Q&A channel. Each (channel, sessionId) pair gets its
 * own isolated Contact + Conversation tagged `isSandbox=true` so the
 * inbox / analytics / role-metrics queries skip these rows. The AI
 * pipeline (classifier → handoff → Claude / canned reply) runs
 * identically against sandbox traffic, so what an operator sees here
 * is what a real customer on that channel would get.
 *
 * 2026-05-14: started as a webchat-only sandbox.
 * 2026-05-14 (evening): Marcos asked for a MercadoLibre variant —
 * "otro agente de prueba pero que sea un simulacro de cómo responde
 * a preguntas de MercadoLibre. Ya que es distinto". ML questions go
 * through a different handler (`handleMercadoLibreMessage`) and the
 * Lucas v5 prompt is enriched with an ML-specific framing block so
 * the agent answers in ML-question style (no internal links, short,
 * matter-of-fact about envíos/stock/precio).
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Channel, ContactType, ConversationStatus, MessageSender, PrismaClient } from '@prisma/client';
import { ConversationHandlerService } from '../../../adapters/conversations/conversation-handler.service';
import {
  WebchatIncomingMessage,
  WebchatMessageType,
} from '../../../domain/entities/webchat-message.entity';
import {
  MercadoLibreIncomingMessage,
  MercadoLibreMessageType,
  MercadoLibreStatus,
} from '../../../domain/entities/mercadolibre-message.entity';
import {
  SocialIncomingMessage,
  SocialMessageType,
  SocialPlatform,
} from '../../../domain/entities/social-message.entity';
import { getMessageCipher } from '../../../adapters/security/message-cipher';
import { claudeErrorMessage } from '../../../adapters/ai/claude-error-message';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { randomUUID } from 'crypto';

type SandboxChannel = 'WEBCHAT' | 'MERCADOLIBRE' | 'INSTAGRAM';

const SANDBOX_ROLES = [
  UserRole.ADMIN,
  UserRole.ATENCION,
  UserRole.VENTAS,
  UserRole.LOGISTICA,
] as const;

@Controller('admin/sandbox')
@UseGuards(AuthGuard, RolesGuard)
export class SandboxController {
  private readonly logger = new Logger(SandboxController.name);
  private readonly prisma = new PrismaClient();

  constructor(private readonly conversationHandler: ConversationHandlerService) {}

  /**
   * Normalise the channel query/body parameter into the internal
   * representation. Defaults to webchat for backward compat with the
   * pre-ML clients.
   */
  private resolveChannel(raw: string | undefined): SandboxChannel {
    const v = (raw || 'WEBCHAT').toUpperCase();
    if (v === 'MERCADOLIBRE' || v === 'ML') return 'MERCADOLIBRE';
    if (v === 'INSTAGRAM' || v === 'IG') return 'INSTAGRAM';
    return 'WEBCHAT';
  }

  /** Channel-specific metadata key used to find the sandbox contact.
   * For Instagram we deliberately reuse `socialId` — that's the same
   * key `handleSocialMessage` → `findOrCreateSocialContact` looks up
   * by, so the pre-created sandbox contact is picked up instead of the
   * handler spawning a second contact behind our back. */
  private metadataKeyForChannel(c: SandboxChannel): string {
    switch (c) {
      case 'MERCADOLIBRE': return 'mercadolibreUserId';
      case 'INSTAGRAM':    return 'socialId';
      default:             return 'webchatCustomerId';
    }
  }

  /** Channel enum on Conversation rows for this sandbox channel. */
  private prismaChannel(c: SandboxChannel): Channel {
    switch (c) {
      case 'MERCADOLIBRE': return Channel.MERCADOLIBRE;
      case 'INSTAGRAM':    return Channel.INSTAGRAM;
      default:             return Channel.TIENDANUBE_WEBCHAT;
    }
  }

  /** Stable customer id for a (channel, sessionId) pair. */
  private customerIdFor(c: SandboxChannel, sessionId: string): string {
    switch (c) {
      case 'MERCADOLIBRE': return `ml-sandbox-${sessionId}`;
      case 'INSTAGRAM':    return `ig-sandbox-${sessionId}`;
      default:             return `sandbox-${sessionId}`;
    }
  }

  /**
   * GET /admin/sandbox/:sessionId?channel=WEBCHAT|MERCADOLIBRE — fetch
   * the message history for a sandbox session. Returns an empty list if
   * the session has no messages yet (first visit after Reset).
   */
  @Get(':sessionId')
  @Roles(...SANDBOX_ROLES)
  async getHistory(
    @Param('sessionId') sessionId: string,
    @Query('channel') channelRaw?: string,
  ) {
    const channel = this.resolveChannel(channelRaw);
    const customerId = this.customerIdFor(channel, sessionId);
    const contact = await this.prisma.contact.findFirst({
      where: {
        metadata: { path: [this.metadataKeyForChannel(channel)], equals: customerId },
        isSandbox: true,
      },
    });
    if (!contact) {
      return { success: true, data: { conversationId: null, channel, messages: [] } };
    }
    const conv = await this.prisma.conversation.findFirst({
      where: {
        contactId: contact.id,
        channel: this.prismaChannel(channel),
        isSandbox: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!conv) {
      return { success: true, data: { conversationId: null, channel, messages: [] } };
    }
    const rows = await this.prisma.message.findMany({
      where: { conversationId: conv.id },
      orderBy: { timestamp: 'asc' },
      take: 200,
    });
    const cipher = getMessageCipher();
    const messages = rows.map((m) => ({
      id: m.id,
      sender: m.sender,
      content: cipher.decrypt(m.content),
      timestamp: m.timestamp.toISOString(),
    }));
    return { success: true, data: { conversationId: conv.id, channel, messages } };
  }

  /**
   * POST /admin/sandbox/message — send a sandbox message as the
   * "customer" and wait synchronously for the agent's reply. Routes
   * to the appropriate channel handler (webchat vs ML); both return
   * the same shape for the UI.
   */
  @Post('message')
  @Roles(...SANDBOX_ROLES)
  async sendMessage(
    @Request() req: any,
    @Body() body: { sessionId?: string; text?: string; channel?: string; mlItemId?: string },
  ) {
    const sessionId = (body?.sessionId || '').trim();
    const text = (body?.text || '').trim();
    // Optional ML listing id (e.g. MLA1234567890) — when set on a
    // MERCADOLIBRE-channel sandbox call, the inbound is built with the
    // real item id instead of the synthetic `sandbox-{sessionId}`,
    // which makes the conversation handler fetch the actual ML
    // listing and inject the publication-context block. Empty falls
    // back to today's synthetic behavior so the ML guardrail tests
    // still work unchanged.
    const mlItemId = typeof body?.mlItemId === 'string' ? body.mlItemId.trim() : '';
    if (!sessionId) throw new BadRequestException('sessionId requerido');
    if (!text) throw new BadRequestException('text requerido');
    if (text.length > 4000) throw new BadRequestException('text demasiado largo (máx 4000)');

    const channel = this.resolveChannel(body?.channel);
    const customerId = this.customerIdFor(channel, sessionId);
    const operatorName = req?.user?.name || req?.user?.email || 'operador';
    const customerName = (() => {
      switch (channel) {
        case 'MERCADOLIBRE': return `Sandbox ML · ${operatorName}`;
        case 'INSTAGRAM':    return `Sandbox IG · ${operatorName}`;
        default:             return `Sandbox · ${operatorName}`;
      }
    })();
    const metaKey = this.metadataKeyForChannel(channel);
    const dbChannel = this.prismaChannel(channel);

    // Pre-create / upsert the sandbox Contact + Conversation with
    // isSandbox=true BEFORE the handler runs — the handler's own
    // findOrCreate will then locate these rows by metadata and reuse
    // them. Same trick on both channels; only the metadata key changes.
    let contact = await this.prisma.contact.findFirst({
      where: { metadata: { path: [metaKey], equals: customerId } },
    });
    if (!contact) {
      const platformTag = (() => {
        switch (channel) {
          case 'MERCADOLIBRE': return 'ml-sandbox';
          case 'INSTAGRAM':    return 'ig-sandbox';
          default:             return 'sandbox';
        }
      })();
      contact = await this.prisma.contact.create({
        data: {
          name: customerName,
          email: null,
          type: ContactType.MINORISTA,
          channel: dbChannel,
          isSandbox: true,
          metadata: { [metaKey]: customerId, platform: platformTag },
        },
      });
    } else if (!contact.isSandbox) {
      await this.prisma.contact.update({ where: { id: contact.id }, data: { isSandbox: true } });
    }

    let conv = await this.prisma.conversation.findFirst({
      where: {
        contactId: contact.id,
        channel: dbChannel,
        status: { in: [ConversationStatus.ACTIVE, ConversationStatus.WAITING] },
      },
    });
    if (!conv) {
      conv = await this.prisma.conversation.create({
        data: {
          contactId: contact.id,
          channel: dbChannel,
          status: ConversationStatus.ACTIVE,
          isSandbox: true,
        },
      });
    } else if (!conv.isSandbox) {
      await this.prisma.conversation.update({ where: { id: conv.id }, data: { isSandbox: true } });
    }

    let result;
    if (channel === 'INSTAGRAM') {
      // IG DMs route through the social-message handler exactly like a
      // real inbound from Meta's webhook. Dev-mode caveat: the public
      // app is in Meta-development until the verification clears, so
      // real customer DMs don't reach this path. The sandbox lets
      // Marcos exercise the full pipeline (intent → catalog → reply
      // shape + 1000-char IG limit) using his admin account.
      const inbound = new SocialIncomingMessage(
        randomUUID(),
        SocialPlatform.INSTAGRAM,
        SocialMessageType.DIRECT_MESSAGE,
        customerName,
        customerId,
        text,
        new Date(),
      );
      result = await this.conversationHandler.handleSocialMessage(inbound);
    } else if (channel === 'MERCADOLIBRE') {
      // ML questions arrive without a deliverable channel (no DMs back
      // until after the sale closes) — we model them with a synthetic
      // `itemId` that's just the sessionId, status=UNANSWERED so the
      // handler treats it as a question that needs answering.
      //
      // When the operator passes a real ML item id (e.g. MLA1234567890)
      // via the optional `mlItemId` field, we feed that through instead
      // so the ML handler can fetch the real listing and inject the
      // publication-context block. The `sandbox-` prefix on the
      // synthetic path is what `handleMercadoLibreMessage` checks to
      // skip the listing fetch.
      const effectiveItemId = mlItemId.length > 0 ? mlItemId : `sandbox-${sessionId}`;
      const inbound = new MercadoLibreIncomingMessage(
        randomUUID(),
        MercadoLibreMessageType.QUESTION,
        customerName,
        customerId,
        text,
        effectiveItemId,
        MercadoLibreStatus.UNANSWERED,
        new Date(),
      );
      result = await this.conversationHandler.handleMercadoLibreMessage(inbound);
    } else {
      const inbound = new WebchatIncomingMessage(
        randomUUID(),
        conv.id,
        customerId,
        customerName,
        null,
        WebchatMessageType.TEXT,
        text,
        new Date(),
      );
      result = await this.conversationHandler.handleWebchatMessage(inbound);
    }

    // Re-read both messages from DB so the timestamps + ids match what
    // the panel will see on subsequent loads. The handler may have
    // skipped saving the AI message (L3 / paused / mayorista escalation
    // paths) — in that case we surface the channel-appropriate signal
    // to the UI instead of leaving it blank.
    const tail = await this.prisma.message.findMany({
      where: { conversationId: conv.id },
      orderBy: { timestamp: 'desc' },
      take: 2,
    });
    const cipher = getMessageCipher();
    const shaped = tail
      .map((m) => ({
        id: m.id,
        sender: m.sender,
        content: cipher.decrypt(m.content),
        timestamp: m.timestamp.toISOString(),
      }))
      .reverse();

    let agentReply: string | null = result?.response ?? null;
    if (!agentReply) {
      const last = shaped[shaped.length - 1];
      if (last && last.sender !== MessageSender.CUSTOMER) {
        agentReply = last.content;
      }
    }

    const handlerError = result && result.success === false ? result.error : null;
    const agentErrorReason = handlerError ? claudeErrorMessage(handlerError) : null;

    return {
      success: true,
      data: {
        conversationId: conv.id,
        channel,
        agentReply: agentReply ?? null,
        agentReplied: !!agentReply,
        agentErrorReason,
        recent: shaped,
      },
    };
  }

  /**
   * POST /admin/sandbox/:sessionId/reset?channel=WEBCHAT|MERCADOLIBRE
   * — close the current sandbox conversation so the next message
   * starts a fresh thread. History stays in DB for audit/replay.
   */
  @Post(':sessionId/reset')
  @Roles(...SANDBOX_ROLES)
  async reset(
    @Param('sessionId') sessionId: string,
    @Query('channel') channelRaw?: string,
  ) {
    const channel = this.resolveChannel(channelRaw);
    const customerId = this.customerIdFor(channel, sessionId);
    const contact = await this.prisma.contact.findFirst({
      where: {
        metadata: { path: [this.metadataKeyForChannel(channel)], equals: customerId },
        isSandbox: true,
      },
    });
    if (!contact) return { success: true, data: { closed: 0, channel } };

    const { count } = await this.prisma.conversation.updateMany({
      where: {
        contactId: contact.id,
        channel: this.prismaChannel(channel),
        isSandbox: true,
        status: { in: [ConversationStatus.ACTIVE, ConversationStatus.WAITING] },
      },
      data: { status: ConversationStatus.CLOSED },
    });
    return { success: true, data: { closed: count, channel } };
  }
}
