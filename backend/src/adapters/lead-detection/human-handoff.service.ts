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

  /**
   * Marcos 2026-07-20: barrido de reconciliación de needsHumanAttention.
   *
   * Contexto: hallado 2026-07-20 en el hunt preventivo. La cola de
   * Atención mostraba 575 conversaciones con needsHumanAttention=true
   * mientras que ~254 de ellas YA tenían una respuesta de staff
   * posterior a escalatedAt. Los paths modernos de clear (sendManualReply,
   * recordPhoneSideOutbound, saveMessage) están bien; pero rows previas
   * a esos fixes nunca se limpiaron, e inflaban visualmente la cola
   * (Brenda veía "575 pendientes" cuando eran ~120 reales).
   *
   * NO es heurística "probablemente resuelto": la señal canónica es
   * "existe mensaje de staff con timestamp > escalatedAt". Si esa señal
   * es verdadera, el chat ya fue atendido — el flag es el que quedó
   * stale. Alineado con [[feedback_exception_visibility_over_auto_mark]]
   * (confiamos en la señal canónica, no en un proxy) y con
   * [[reference_ml_stale_escalations]] (mismo patrón que en ML).
   *
   * Devuelve el conteo por canal y loguea cada conversationId barrido
   * para que quede audit trail (no es mutación silenciosa).
   */
  async reconcileStaleNeedsHumanAttention(options?: {
    dryRun?: boolean;
  }): Promise<{ scanned: number; cleared: number; byChannel: Record<string, number>; ids: string[] }> {
    const dryRun = options?.dryRun ?? false;
    // Prisma no permite comparar dos columnas de la misma fila via
    // `where: { escalatedAt: { lt: prisma.field(...) } }`, así que
    // arrancamos con findMany filtrado + subquery post-fetch de messages.
    const candidates = await this.prisma.conversation.findMany({
      where: {
        needsHumanAttention: true,
        contact: { is: { isSandbox: false } },
      },
      select: {
        id: true,
        channel: true,
        escalatedAt: true,
        createdAt: true,
      },
    });
    const stale: Array<{ id: string; channel: string }> = [];
    for (const c of candidates) {
      const anchor = c.escalatedAt ?? c.createdAt;
      const staffMsg = await this.prisma.message.findFirst({
        where: {
          conversationId: c.id,
          timestamp: { gt: anchor },
          isFromAI: false,
          sender: {
            in: [MessageSender.ADMIN, MessageSender.BRENDA, MessageSender.FRANCO, MessageSender.ALDO],
          },
        },
        select: { id: true, timestamp: true, sender: true },
      });
      if (staffMsg) {
        stale.push({ id: c.id, channel: c.channel });
      }
    }
    const byChannel: Record<string, number> = {};
    for (const s of stale) byChannel[s.channel] = (byChannel[s.channel] ?? 0) + 1;

    if (!dryRun && stale.length > 0) {
      const ids = stale.map((s) => s.id);
      const CHUNK = 200;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        await this.prisma.conversation.updateMany({
          where: { id: { in: slice } },
          data: { needsHumanAttention: false, status: ConversationStatus.ACTIVE },
        });
      }
      // Audit trail — un log por lote para no inundar journal, y una
      // línea con la lista completa de IDs (queryable con jq / grep).
      this.logger.log(
        `Reconcile: cleared ${stale.length} stale needsHumanAttention flags across ${Object.keys(byChannel).length} channels — ${JSON.stringify(byChannel)}`,
      );
      this.logger.log(`Reconcile cleared conversation IDs: ${ids.join(',')}`);
      this.metrics.emitTick('handoff_reconcile_cleared');
    } else if (dryRun) {
      this.logger.log(
        `Reconcile (dry-run): would clear ${stale.length} across ${JSON.stringify(byChannel)}`,
      );
    }

    return {
      scanned: candidates.length,
      cleared: dryRun ? 0 : stale.length,
      byChannel,
      ids: stale.map((s) => s.id),
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
