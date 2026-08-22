/**
 * INFRASTRUCTURE LAYER — Cutover-validation replay endpoint.
 *
 * Lets us measure the AI pipeline end-to-end without going through the
 * Meta webhook (which is asynchronous + ack-then-process). Synthesizes
 * a `WhatsAppIncomingMessage` and runs `ConversationHandlerService.
 * handleWhatsAppMessage()` synchronously, returning the AI reply, the
 * end-to-end latency, the contact/conversation ids, and the Claude
 * usage delta captured during the call.
 *
 * Strictly ADMIN-only — this can produce real Claude calls and writes
 * to the live DB (so it counts against the monthly budget). The
 * `replayBatch` marker lands on the contact metadata so the cutover
 * script can clean up its rows when the run is over.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Logger,
  Optional,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { ConversationHandlerService } from '../../../adapters/conversations/conversation-handler.service';
import { PrismaService } from '../../../adapters/repositories/prisma.service';
import {
  WhatsAppIncomingMessage,
  WhatsAppMessageType,
} from '../../../domain/entities/whatsapp-message.entity';

interface ReplayBody {
  phone: string;
  text: string;
  /** Free-form marker so the runner can isolate its rows for cleanup. */
  replayBatch?: string;
}

interface ReplayResponse {
  success: boolean;
  aiReply: string | null;
  latencyMs: number;
  contactId: string | null;
  conversationId: string | null;
  /** Claude usage events created during this single call. */
  usage: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    erroredCalls: number;
    byCallSite: Array<{ callSite: string; calls: number; costUsd: number }>;
  };
  error: string | null;
}

@Controller('admin/replay')
@UseGuards(AuthGuard, RolesGuard)
export class ReplayController {
  private readonly logger = new Logger(ReplayController.name);
  private readonly prisma: PrismaClient;

  constructor(
    private readonly handler: ConversationHandlerService,
    @Optional() prismaShared?: PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  /**
   * POST /admin/replay/process-message
   * Body: { phone, text, replayBatch? }
   *
   * Returns the AI reply text + structured timing/usage so the cutover
   * runner can aggregate p50/p95/p99 latency, error rate, token spend.
   */
  @Post('process-message')
  @Roles(UserRole.ADMIN)
  async processMessage(@Body() body: ReplayBody, @Request() _req: any): Promise<ReplayResponse> {
    if (!body?.phone || typeof body.phone !== 'string' || body.phone.trim().length === 0) {
      throw new BadRequestException('phone is required');
    }
    if (!body?.text || typeof body.text !== 'string' || body.text.trim().length === 0) {
      throw new BadRequestException('text is required');
    }
    const phone = body.phone.trim();
    const text = body.text.trim();

    // Capture the usage-event window so we can attribute per-call cost.
    const startWall = new Date();
    const startMs = Date.now();

    const incoming = new WhatsAppIncomingMessage(
      `replay-${startMs}`,
      phone,
      startWall,
      WhatsAppMessageType.TEXT,
      text,
      null,
      null,
    );

    let response: string | null = null;
    let error: string | null = null;
    let success = true;
    try {
      const r = await this.handler.handleWhatsAppMessage(incoming);
      response = r.response ?? null;
      error = r.error ?? null;
      success = r.success;
    } catch (err: any) {
      success = false;
      error = err?.message ?? String(err);
    }

    const latencyMs = Date.now() - startMs;

    // Stamp the replayBatch marker on the contact so cleanup can locate
    // exactly the rows this run created. We do this AFTER the handler
    // because findOrCreateContact may have just inserted the row.
    let contactId: string | null = null;
    let conversationId: string | null = null;
    try {
      const contact = await this.prisma.contact.findUnique({ where: { phone } });
      if (contact) {
        contactId = contact.id;
        if (body.replayBatch) {
          const md = (contact.metadata as Record<string, unknown> | null) ?? {};
          if (md.replayBatch !== body.replayBatch) {
            await this.prisma.contact.update({
              where: { id: contact.id },
              data: { metadata: { ...md, replayBatch: body.replayBatch } as any },
            });
          }
        }
        const conv = await this.prisma.conversation.findFirst({
          where: { contactId: contact.id },
          orderBy: { updatedAt: 'desc' },
        });
        conversationId = conv?.id ?? null;
      }
    } catch (err: any) {
      this.logger.warn(`Failed to stamp replay marker: ${err.message}`);
    }

    // Aggregate usage for this call. The window is generous (we add a
    // small buffer either side) since classifier + handoff + main reply
    // can all generate events back-to-back; missing one would skew cost.
    const usageEvents = await this.prisma.claudeUsageEvent.findMany({
      where: {
        createdAt: { gte: new Date(startMs - 50), lte: new Date(Date.now() + 50) },
      },
      select: { callSite: true, inputTokens: true, outputTokens: true, costUsd: true, errored: true },
    });

    const byCallSite = new Map<string, { calls: number; costUsd: number }>();
    let calls = 0, inputTokens = 0, outputTokens = 0, costUsd = 0, erroredCalls = 0;
    for (const e of usageEvents) {
      calls++;
      inputTokens += e.inputTokens;
      outputTokens += e.outputTokens;
      costUsd += e.costUsd;
      if (e.errored) erroredCalls++;
      const cur = byCallSite.get(e.callSite) ?? { calls: 0, costUsd: 0 };
      cur.calls++;
      cur.costUsd += e.costUsd;
      byCallSite.set(e.callSite, cur);
    }

    return {
      success,
      aiReply: response,
      latencyMs,
      contactId,
      conversationId,
      usage: {
        calls,
        inputTokens,
        outputTokens,
        costUsd: Math.round(costUsd * 1_000_000) / 1_000_000,
        erroredCalls,
        byCallSite: Array.from(byCallSite.entries()).map(([callSite, v]) => ({
          callSite,
          calls: v.calls,
          costUsd: Math.round(v.costUsd * 1_000_000) / 1_000_000,
        })),
      },
      error,
    };
  }
}
