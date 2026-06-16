/**
 * ADAPTERS LAYER — Mass remarketing campaign service.
 *
 * Marcos's brief: "elegís un segmento (filtros 2D + opcionales), escribís
 * el mensaje con {{nombre}}, vista previa, confirmás y se envía con
 * throttle".
 *
 * Pipeline:
 *   1) `previewSegment(filters)` — count + sample names, no DB writes.
 *   2) `create(input)` — saves the campaign as DRAFT and materialises the
 *      target list as PENDING `CampaignDelivery` rows so a re-render or
 *      partial send is auditable.
 *   3) `send(id)` — flips status to SENDING, walks the deliveries with a
 *      configurable throttle, records SENT / FAILED per row, updates
 *      aggregate counters, marks the campaign COMPLETED at the end.
 *      Sending is best-effort: if a channel has no creds we mark the row
 *      FAILED with the reason and keep going — same pattern as
 *      `LeadFollowupService`.
 *
 * Tunable in `.env`:
 *   CAMPAIGN_SEND_THROTTLE_MS    — minimum gap between two outbound sends
 *                                  (default 1000 ms — keeps WhatsApp quiet).
 *   CAMPAIGN_BATCH_SIZE          — max recipients targeted per campaign
 *                                  (default 500 — guard against
 *                                  accidental "send to everyone" mistakes).
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  Channel,
  CampaignDeliveryStatus,
  CampaignStatus,
  CustomerType,
  FunnelStage,
  PrismaClient,
  Prisma,
} from '@prisma/client';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WebchatService } from '../webchat/webchat.service';
import { SocialMediaService } from '../social/social-media.service';
import {
  WhatsAppOutgoingMessage,
} from '../../domain/entities/whatsapp-message.entity';
import {
  WebchatOutgoingMessage,
  WebchatMessageType,
} from '../../domain/entities/webchat-message.entity';
import {
  SocialMessageType,
  SocialOutgoingMessage,
  SocialPlatform,
} from '../../domain/entities/social-message.entity';

export interface CampaignFilters {
  customerTypes: CustomerType[];
  funnelStages: FunnelStage[];
  channel?: Channel | null;
}

export interface CampaignCreateInput {
  name: string;
  messageTemplate: string;
  filters: CampaignFilters;
  createdBy: string | null;
}

function num(envKey: string, fallback: number): number {
  const v = process.env[envKey];
  const n = v != null ? Number(v) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function renderTemplate(tpl: string, contact: { name: string | null }): string {
  const first = (contact.name ?? '').trim().split(/\s+/)[0] ?? '';
  return tpl.replace(/\{\{\s*nombre\s*\}\}/gi, first || 'hola').replace(/\{\{\s*name\s*\}\}/gi, first);
}

function buildContactWhere(filters: CampaignFilters): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = {};
  if (filters.customerTypes && filters.customerTypes.length > 0) {
    where.customerType = { in: filters.customerTypes };
  }
  if (filters.funnelStages && filters.funnelStages.length > 0) {
    where.funnelStage = { in: filters.funnelStages };
  }
  return where;
}

/** Decide which channel to use for a contact. The per-contact `channel`
 *  field is the preferred default; if absent, fall back to whichever
 *  channel they have a conversation on (most-recent first). */
async function resolveChannel(
  prisma: PrismaClient,
  contactId: string,
  override?: Channel | null,
): Promise<Channel | null> {
  if (override) return override;
  const c = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { channel: true },
  });
  if (c?.channel) return c.channel;
  const conv = await prisma.conversation.findFirst({
    where: { contactId },
    orderBy: { updatedAt: 'desc' },
    select: { channel: true },
  });
  return conv?.channel ?? null;
}

@Injectable()
export class CampaignService {
  private readonly logger = new Logger(CampaignService.name);
  private readonly prisma = new PrismaClient();

  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly webchat: WebchatService,
    private readonly social: SocialMediaService,
  ) {}

  /**
   * Returns the segment count + a sample of contact names without
   * persisting anything. Used by the wizard's "Vista previa" step.
   */
  async previewSegment(filters: CampaignFilters): Promise<{
    count: number;
    sample: Array<{ id: string; name: string | null; channel: Channel | null }>;
  }> {
    const where = buildContactWhere(filters);
    const [count, sample] = await Promise.all([
      this.prisma.contact.count({ where }),
      this.prisma.contact.findMany({
        where,
        select: { id: true, name: true, channel: true },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
    ]);
    return { count, sample };
  }

  async list(): Promise<Array<{
    id: string; name: string; status: CampaignStatus;
    targetCount: number; sentCount: number; failedCount: number;
    createdAt: Date; completedAt: Date | null;
  }>> {
    return this.prisma.marketingCampaign.findMany({
      select: {
        id: true, name: true, status: true,
        targetCount: true, sentCount: true, failedCount: true,
        createdAt: true, completedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getById(id: string) {
    return this.prisma.marketingCampaign.findUnique({
      where: { id },
      include: {
        deliveries: {
          orderBy: { createdAt: 'asc' },
          take: 200,
          include: { /* contact relation isn't on Prisma model, so include manually below */ },
        },
      },
    });
  }

  /**
   * Create a campaign in DRAFT status and materialise the target list as
   * PENDING `CampaignDelivery` rows — one per matched contact. Skips
   * contacts we can't reach (no phone for WhatsApp, no senderId metadata
   * for social) by marking those rows SKIPPED instead of PENDING so the
   * UI can explain why the targetCount looks smaller after creation.
   */
  async create(input: CampaignCreateInput) {
    if (!input.name?.trim()) throw new Error('name is required');
    if (!input.messageTemplate?.trim()) throw new Error('message template is required');

    const batchMax = num('CAMPAIGN_BATCH_SIZE', 500);
    const where = buildContactWhere(input.filters);
    const contacts = await this.prisma.contact.findMany({
      where,
      take: batchMax,
      orderBy: { updatedAt: 'desc' },
    });

    const campaign = await this.prisma.marketingCampaign.create({
      data: {
        name: input.name.trim(),
        status: CampaignStatus.DRAFT,
        messageTemplate: input.messageTemplate,
        customerTypes: input.filters.customerTypes as any,
        funnelStages: input.filters.funnelStages as any,
        channel: input.filters.channel ?? null,
        createdBy: input.createdBy,
        targetCount: contacts.length,
      },
    });

    // Materialise per-recipient deliveries.
    let pending = 0, skipped = 0;
    for (const contact of contacts) {
      const channel = await resolveChannel(this.prisma, contact.id, input.filters.channel ?? null);
      const reachable = channel != null && this.isReachable(channel, contact);
      const status = reachable ? CampaignDeliveryStatus.PENDING : CampaignDeliveryStatus.SKIPPED;
      const renderedText = renderTemplate(input.messageTemplate, contact);
      await this.prisma.campaignDelivery.create({
        data: {
          campaignId: campaign.id,
          contactId: contact.id,
          channel: channel ?? Channel.WHATSAPP, // safe default; SKIPPED rows aren't sent
          status,
          renderedText,
          error: reachable ? null : 'no reachable channel for contact',
        },
      });
      if (reachable) pending++; else skipped++;
    }

    if (skipped > 0) {
      this.logger.log(`Campaign ${campaign.id}: ${pending} pending, ${skipped} skipped (no channel)`);
    }
    return { campaignId: campaign.id, pending, skipped };
  }

  private isReachable(channel: Channel, contact: { phone: string | null; metadata: any }): boolean {
    switch (channel) {
      case Channel.WHATSAPP:
        return !!contact.phone;
      case Channel.FACEBOOK:
      case Channel.INSTAGRAM:
        return !!(contact.metadata as any)?.facebookSenderId
          || !!(contact.metadata as any)?.instagramSenderId
          || !!(contact.metadata as any)?.socialSenderId;
      case Channel.TIENDANUBE_WEBCHAT:
        // Webchat needs a live conversation to attach the message to.
        return true; // we'll resolve at send-time
      case Channel.MERCADOLIBRE:
        return false; // ML doesn't allow proactive DMs
      default:
        return false;
    }
  }

  /**
   * Send the campaign. Walks PENDING deliveries with a configurable throttle.
   * Errors per row are captured but never abort the whole campaign.
   */
  async send(id: string): Promise<{
    sent: number; failed: number; total: number;
  }> {
    const throttleMs = num('CAMPAIGN_SEND_THROTTLE_MS', 1000);

    await this.prisma.marketingCampaign.update({
      where: { id },
      data: { status: CampaignStatus.SENDING, startedAt: new Date() },
    });

    const deliveries = await this.prisma.campaignDelivery.findMany({
      where: { campaignId: id, status: CampaignDeliveryStatus.PENDING },
      include: {},
      orderBy: { createdAt: 'asc' },
    });

    let sent = 0, failed = 0;
    for (const delivery of deliveries) {
      const contact = await this.prisma.contact.findUnique({ where: { id: delivery.contactId } });
      if (!contact) {
        await this.markDelivery(delivery.id, CampaignDeliveryStatus.FAILED, 'contact missing');
        failed++;
        continue;
      }
      const result = await this.dispatch(delivery.channel, contact, delivery.renderedText);
      if (result.ok) {
        await this.markDelivery(delivery.id, CampaignDeliveryStatus.SENT, null);
        sent++;
      } else {
        await this.markDelivery(delivery.id, CampaignDeliveryStatus.FAILED, result.reason ?? 'unknown');
        failed++;
      }
      // Throttle so we don't tail-spike a channel rate limit.
      await new Promise((r) => setTimeout(r, throttleMs));
    }

    const finalStatus = failed === 0
      ? CampaignStatus.COMPLETED
      : sent === 0
        ? CampaignStatus.FAILED
        : CampaignStatus.COMPLETED; // partial success still "completed"
    await this.prisma.marketingCampaign.update({
      where: { id },
      data: {
        status: finalStatus,
        sentCount: sent,
        failedCount: failed,
        completedAt: new Date(),
      },
    });

    this.logger.log(`Campaign ${id} done: sent=${sent} failed=${failed} total=${deliveries.length}`);
    return { sent, failed, total: deliveries.length };
  }

  private async markDelivery(id: string, status: CampaignDeliveryStatus, error: string | null) {
    await this.prisma.campaignDelivery.update({
      where: { id },
      data: {
        status,
        error: error,
        sentAt: status === CampaignDeliveryStatus.SENT ? new Date() : undefined,
      },
    });
  }

  private async dispatch(
    channel: Channel,
    contact: { id: string; phone: string | null; metadata: any },
    text: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    try {
      switch (channel) {
        case Channel.WHATSAPP: {
          if (!contact.phone) return { ok: false, reason: 'no phone' };
          const r = await this.whatsapp.sendMessage(new WhatsAppOutgoingMessage(contact.phone, text));
          return r.success ? { ok: true } : { ok: false, reason: r.error ?? 'whatsapp send failed' };
        }
        case Channel.TIENDANUBE_WEBCHAT: {
          const conv = await this.prisma.conversation.findFirst({
            where: { contactId: contact.id, channel: Channel.TIENDANUBE_WEBCHAT },
            orderBy: { updatedAt: 'desc' },
          });
          if (!conv) return { ok: false, reason: 'no webchat conversation' };
          const r = await this.webchat.sendMessage(
            new WebchatOutgoingMessage(conv.id, text, WebchatMessageType.TEXT),
          );
          return r.success ? { ok: true } : { ok: false, reason: r.error ?? 'webchat send failed' };
        }
        case Channel.FACEBOOK:
        case Channel.INSTAGRAM: {
          const md = (contact.metadata as Record<string, any>) ?? {};
          const senderId = md.facebookSenderId ?? md.instagramSenderId ?? md.socialSenderId;
          if (!senderId) return { ok: false, reason: 'no social senderId' };
          const platform =
            channel === Channel.FACEBOOK ? SocialPlatform.FACEBOOK : SocialPlatform.INSTAGRAM;
          const r = await this.social.sendMessage(
            new SocialOutgoingMessage(platform, SocialMessageType.DIRECT_MESSAGE, senderId, text),
          );
          return r.success ? { ok: true } : { ok: false, reason: r.error ?? 'social send failed' };
        }
        case Channel.MERCADOLIBRE:
          return { ok: false, reason: 'ML does not support proactive DMs' };
        default:
          return { ok: false, reason: `unsupported channel ${channel}` };
      }
    } catch (err: any) {
      return { ok: false, reason: err.message };
    }
  }
}
