/**
 * ADAPTERS LAYER - Human Handoff Service
 *
 * When the AI says "te derivo" or the customer asks for a person, this
 * service flags the conversation as needing human attention and routes it
 * to the right role:
 *
 *   - Existing assignee → keep them; just flag and notify them
 *   - Open mayorista lead on this contact → Franco (VENTAS)
 *   - Recent order on this contact → Aldo (LOGISTICA)
 *   - Else → Brenda (ATENCION) — first-line default
 *
 * Emits `conversation:needs_human` to the routed user (or to all matching
 * role users if the conversation lands unassigned).
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, UserRole, LeadStatus, ConversationStatus, MessageSender } from '@prisma/client';
import {
  IHumanHandoffService,
  HandoffContext,
  HandoffOutcome,
} from '../../use-cases/lead-detection/human-handoff.interface';
import { NotificationsGateway } from '../../infrastructure/notifications/notifications.gateway';
import { MetricsBroadcaster } from '../../infrastructure/notifications/metrics-broadcaster.service';

@Injectable()
export class HumanHandoffService implements IHumanHandoffService {
  private readonly logger = new Logger(HumanHandoffService.name);
  private readonly prisma = new PrismaClient();

  constructor(
    private readonly notifications: NotificationsGateway,
    private readonly metrics: MetricsBroadcaster,
  ) {}

  async escalate(ctx: HandoffContext): Promise<HandoffOutcome> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: ctx.conversationId },
      select: { id: true, assignedTo: true, needsHumanAttention: true, contactId: true },
    });
    if (!conv) {
      return {
        escalated: false,
        conversationId: ctx.conversationId,
        assignedTo: null,
        routedTo: 'NONE',
        reason: 'conversation_not_found',
      };
    }

    // Already flagged + assigned → no-op so we don't reroute or re-notify on
    // every consecutive message.
    if (conv.needsHumanAttention && conv.assignedTo) {
      return {
        escalated: false,
        conversationId: conv.id,
        assignedTo: conv.assignedTo,
        routedTo: 'NONE',
        reason: 'already_flagged_and_assigned',
      };
    }

    // Recent-staff-reply debounce. If a human operator just replied (within
    // the configured window) we don't want to flip the flag back to
    // "needs human" — they're already on it. This guards against a race
    // where a queued AI pipeline finishes after the staff reply lands and
    // re-escalates based on a customer message that's already been
    // answered. Pre-2026-05-19 this race occasionally re-flagged
    // conversations Brenda had just claimed; window is env-driven so it
    // can be tuned without a deploy.
    const debounceMs = Math.max(0, Number(process.env.HANDOFF_STAFF_REPLY_DEBOUNCE_MS) || 8000);
    if (debounceMs > 0) {
      const lastStaff = await this.prisma.message.findFirst({
        where: {
          conversationId: conv.id,
          sender: { in: [MessageSender.ADMIN, MessageSender.BRENDA, MessageSender.FRANCO, MessageSender.ALDO] },
        },
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true },
      });
      if (lastStaff && Date.now() - lastStaff.timestamp.getTime() < debounceMs) {
        this.logger.log(
          `↪️ Skipping handoff escalate on ${conv.id} — staff replied ${Math.round((Date.now() - lastStaff.timestamp.getTime()) / 100) / 10}s ago (within ${debounceMs}ms debounce)`,
        );
        return {
          escalated: false,
          conversationId: conv.id,
          assignedTo: conv.assignedTo,
          routedTo: 'NONE',
          reason: 'staff_already_responding',
        };
      }
    }

    // Decide target role + user
    const route = await this.pickRoute(conv.contactId, conv.assignedTo);

    const updated = await this.prisma.conversation.update({
      where: { id: conv.id },
      data: {
        needsHumanAttention: true,
        escalatedAt: new Date(),
        // Use WAITING so the existing inbox status filters and metrics still
        // make sense.
        status: ConversationStatus.WAITING,
        isUnread: true,
        assignedTo: route.userId ?? conv.assignedTo,
      },
      select: { assignedTo: true },
    });

    const payload = {
      conversationId: conv.id,
      contactId: conv.contactId,
      source: ctx.source,
      reason: ctx.reason,
      signals: ctx.signals,
      routedTo: route.role,
      at: new Date().toISOString(),
    };

    if (route.userId) {
      this.notifications.emitToUser(route.userId, 'conversation:needs_human', payload);
    } else {
      // Unassigned (no eligible user found) — broadcast so any listener in
      // that role can pick it up. Falls back to room-less broadcast.
      this.notifications.broadcast('conversation:needs_human', payload);
    }
    this.metrics.emitTick('conversation_escalated');

    this.logger.log(
      `🚨 Conversation ${conv.id} escalated (${ctx.source}/${ctx.reason}) → ${route.role}/${route.userId ?? 'NONE'}`,
    );

    return {
      escalated: true,
      conversationId: conv.id,
      assignedTo: updated.assignedTo,
      routedTo: route.role,
      reason: ctx.reason,
    };
  }

  async clearFlag(conversationId: string): Promise<void> {
    try {
      const c = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { needsHumanAttention: true },
      });
      if (!c?.needsHumanAttention) return;
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { needsHumanAttention: false },
      });
      this.metrics.emitTick('conversation_handoff_cleared');
      this.logger.log(`✅ Cleared human-needed flag on conversation ${conversationId}`);
    } catch (err: any) {
      this.logger.error(`Error clearing handoff flag: ${err.message}`);
    }
  }

  /**
   * Returns the role we want to route to and the specific user (or null if
   * no eligible user exists).
   *
   *   1. Already assigned → keep that user
   *   2. Open wholesale lead → first VENTAS user
   *   3. Recent open order → first LOGISTICA user
   *   4. Default → first ATENCION user
   */
  private async pickRoute(
    contactId: string,
    currentAssignee: string | null,
  ): Promise<{ role: HandoffOutcome['routedTo']; userId: string | null }> {
    if (currentAssignee) {
      // Find current assignee's role for the audit trail
      const u = await this.prisma.user.findUnique({
        where: { id: currentAssignee },
        select: { role: true },
      });
      const role = (u?.role ?? 'ATENCION') as HandoffOutcome['routedTo'];
      return { role, userId: currentAssignee };
    }

    const openLead = await this.prisma.lead.findFirst({
      where: {
        contactId,
        status: { in: [LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.QUOTE_SENT, LeadStatus.NEGOTIATING] },
      },
      select: { id: true },
    });
    if (openLead) {
      const u = await this.firstUserOfRole(UserRole.VENTAS);
      if (u) return { role: 'VENTAS', userId: u.id };
    }

    const openOrder = await this.prisma.order.findFirst({
      where: {
        contactId,
        status: { in: ['CONFIRMED', 'PROCESSING', 'DISPATCHED'] as any },
      },
      select: { id: true },
    });
    if (openOrder) {
      const u = await this.firstUserOfRole(UserRole.LOGISTICA);
      if (u) return { role: 'LOGISTICA', userId: u.id };
    }

    const u = await this.firstUserOfRole(UserRole.ATENCION);
    return { role: 'ATENCION', userId: u?.id ?? null };
  }

  private firstUserOfRole(role: UserRole) {
    return this.prisma.user.findFirst({
      where: { role, active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true },
    });
  }
}
