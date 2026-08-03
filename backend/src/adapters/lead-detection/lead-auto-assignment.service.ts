/**
 * ADAPTERS LAYER - Lead Auto-Assignment Service
 *
 * Wires the mayorista detector into the inbound-message pipeline:
 *   1. Detect wholesale intent
 *   2. Pick a target VENTAS user (first active by createdAt — deterministic)
 *   3. Skip if a recent open lead already exists for this contact (dedup)
 *   4. Create the Lead row (status NEW, source channel, assigned to ventas)
 *   5. Emit `lead:assigned` to that user via the notifications gateway
 *
 * Tunables in `.env`:
 *   MAYORISTA_DEDUP_HOURS — open-lead dedup window (default 24)
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaClient, LeadStatus, Channel, UserRole } from '@prisma/client';
import {
  ILeadAutoAssignmentService,
  InboundMessageContext,
  AutoAssignmentOutcome,
} from '../../use-cases/lead-detection/lead-auto-assignment.interface';
import {
  IMayoristaDetector,
  MAYORISTA_DETECTOR,
} from '../../use-cases/lead-detection/mayorista-detector.interface';
import { NotificationsGateway } from '../../infrastructure/notifications/notifications.gateway';
import { MetricsBroadcaster } from '../../infrastructure/notifications/metrics-broadcaster.service';

function dedupHours(): number {
  const raw = process.env.MAYORISTA_DEDUP_HOURS;
  const n = raw != null ? Number(raw) : 24;
  return Number.isFinite(n) && n >= 0 ? n : 24;
}

@Injectable()
export class LeadAutoAssignmentService implements ILeadAutoAssignmentService {
  private readonly logger = new Logger(LeadAutoAssignmentService.name);
  private readonly prisma = new PrismaClient();

  constructor(
    @Inject(MAYORISTA_DETECTOR)
    private readonly detector: IMayoristaDetector,
    private readonly notifications: NotificationsGateway,
    private readonly metrics: MetricsBroadcaster,
  ) {}

  async processInboundMessage(
    input: InboundMessageContext,
  ): Promise<AutoAssignmentOutcome> {
    const detection = await this.detector.detect(input.text);
    if (!detection.isMayorista) {
      return {
        created: false,
        leadId: null,
        assignedTo: null,
        reason: 'not_mayorista',
        signals: detection.signals,
      };
    }

    // Dedup: if there's already an open lead for this contact within the
    // configured window, skip — the existing lead's owner already has it.
    const since = new Date(Date.now() - dedupHours() * 60 * 60 * 1000);
    const existing = await this.prisma.lead.findFirst({
      where: {
        contactId: input.contactId,
        status: { in: [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUOTE_SENT, LeadStatus.NEGOTIATING] },
        createdAt: { gte: since },
      },
      select: { id: true, assignedTo: true },
    });
    if (existing) {
      this.logger.log(
        `Mayorista detected but skipping — open lead ${existing.id} already exists for contact ${input.contactId}`,
      );
      return {
        created: false,
        leadId: existing.id,
        assignedTo: existing.assignedTo,
        reason: 'dedup_existing_lead',
        signals: detection.signals,
      };
    }

    const ventas = await this.pickVentasUser();
    if (!ventas) {
      this.logger.warn('No active VENTAS user available — creating unassigned lead');
    }

    const lead = await this.prisma.lead.create({
      data: {
        contactId: input.contactId,
        status: LeadStatus.NEW,
        source: this.channelOrUndef(input.channel),
        assignedTo: ventas?.id ?? null,
        productInterest: input.text.slice(0, 200),
        notes: `Auto-detectado: ${detection.signals.join(', ')}`,
        // Persist the originating conversation so the panel can deep-
        // link "Ir a la conversación" without a derived lookup. Marcos's
        // #4 ask — Oportunidades → conversación, no escalón intermedio.
        sourceConversationId: input.conversationId,
      },
    });

    this.logger.log(
      `✅ Mayorista lead ${lead.id} created from conv ${input.conversationId}, assigned to ${ventas?.email ?? 'NONE'} (signals: ${detection.signals.join(', ')})`,
    );

    if (ventas) {
      this.notifications.emitToUser(ventas.id, 'lead:assigned', {
        leadId: lead.id,
        conversationId: input.conversationId,
        contactId: input.contactId,
        channel: input.channel,
        signals: detection.signals,
        confidence: detection.confidence,
        at: new Date().toISOString(),
      });
    }

    this.metrics.emitTick('lead_created');

    return {
      created: true,
      leadId: lead.id,
      assignedTo: ventas?.id ?? null,
      reason: 'created',
      signals: detection.signals,
    };
  }

  /**
   * Deterministic ventas-user selection — first active VENTAS user by
   * createdAt. Servifibras has Franco only today; this is also future-proof
   * for multiple sales reps (oldest seniority gets the lead — easy enough to
   * swap for round-robin later).
   */
  private async pickVentasUser(): Promise<{ id: string; email: string } | null> {
    // Marcos 2026-08-03: guard contra E2E test users — ver el mismo
    // patrón en HumanHandoffService.firstUserOfRole para el contexto.
    // Users reales de Servifibras están en @servifibras.com; test
    // users viven en @t.io. Los excluimos del round-robin para que
    // un cleanup fallido de tests no pueda volver a bricar prod.
    const u = await this.prisma.user.findFirst({
      where: {
        role: UserRole.VENTAS,
        active: true,
        NOT: { email: { endsWith: '@t.io' } },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true },
    });
    return u ?? null;
  }

  private channelOrUndef(c: string): Channel | undefined {
    if ((Object.values(Channel) as string[]).includes(c)) return c as Channel;
    return undefined;
  }
}
