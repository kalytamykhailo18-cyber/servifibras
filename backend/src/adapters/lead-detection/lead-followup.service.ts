/**
 * ADAPTERS LAYER — Automated quote follow-up service.
 *
 * Marcos's brief: "Quiero que el agente le mande un mensaje al cliente que
 * cotizamos y todavía no respondió, sin que Brenda tenga que hacerlo
 * manualmente."
 *
 * Algorithm (runs on a schedule):
 *   1) Find leads in status=QUOTE_SENT whose last activity exceeded the
 *      quote-stale threshold (QUOTE_FOLLOWUP_HOURS) AND that haven't already
 *      been nudged the maximum number of times (LEAD_FOLLOWUP_MAX_ATTEMPTS).
 *   2) For each, compose a Spanish nudge — defaults to a friendly check-in
 *      ("Hola {name}, ¿pudiste revisar la cotización?"). The full text can be
 *      overridden via LEAD_FOLLOWUP_MESSAGE_TEMPLATE if Marcos wants to tweak
 *      tone without a code change.
 *   3) Save the nudge as an AI-authored Message in the existing conversation
 *      (so operators see it in the UI) and try to send via the original
 *      channel adapter. If the channel has no creds yet (common in dev), the
 *      send fails non-fatally — the follow-up is still recorded and the
 *      attempt counter increments so we don't loop.
 *   4) Update the lead with `followupCount` and `lastFollowupAt`.
 *
 * Tunable in `.env`:
 *   LEAD_FOLLOWUP_ENABLED                 — kill switch ('true'/'false', default true)
 *   QUOTE_FOLLOWUP_MINUTES                — first-nudge delay (preferred). Default falls back to
 *                                           QUOTE_FOLLOWUP_HOURS×60, then 1440 min.
 *   QUOTE_FOLLOWUP_HOURS                  — legacy hour-based threshold (still respected).
 *   LEAD_FOLLOWUP_MAX_ATTEMPTS            — total nudges per lead (default 2)
 *   LEAD_FOLLOWUP_MIN_HOURS_BETWEEN       — gap between nudges (default 24)
 *   LEAD_FOLLOWUP_MESSAGE_TEMPLATE        — override text. {{name}} interpolated.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  Channel,
  LeadStatus,
  MessageSender,
  PrismaClient,
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
import { MetricsBroadcaster } from '../../infrastructure/notifications/metrics-broadcaster.service';
import { quoteFollowupMs } from './quote-followup-window.util';
import { getMessageCipher } from '../security/message-cipher';

import { PrismaService } from '../repositories/prisma.service';
const DEFAULT_TEMPLATE =
  'Hola{{name}}, ¿pudiste revisar la cotización? Quedo atenta a cualquier consulta o ajuste.';

function num(envKey: string, fallback: number): number {
  const v = process.env[envKey];
  const n = v != null ? Number(v) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isEnabled(): boolean {
  const raw = process.env.LEAD_FOLLOWUP_ENABLED;
  if (raw == null || raw.trim().length === 0) return true;
  return raw.trim().toLowerCase() === 'true';
}

function template(): string {
  const raw = process.env.LEAD_FOLLOWUP_MESSAGE_TEMPLATE;
  if (raw && raw.trim().length > 0) return raw;
  return DEFAULT_TEMPLATE;
}

function compose(tpl: string, contactName: string | null): string {
  // {{name}} is rendered as ", {firstName}" when we have a name, otherwise
  // empty string. Keeps the greeting natural in both cases.
  const first = (contactName ?? '').trim().split(/\s+/)[0] ?? '';
  const namePart = first ? ` ${first}` : '';
  return tpl.replace(/\{\{\s*name\s*\}\}/g, namePart);
}

export interface FollowupRunResult {
  considered: number;
  sent: number;
  errors: number;
  skipped: number;
}

@Injectable()
export class LeadFollowupService {
  private readonly logger = new Logger(LeadFollowupService.name);
  private readonly prisma: PrismaClient;

  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly webchat: WebchatService,
    private readonly social: SocialMediaService,
    private readonly metrics: MetricsBroadcaster,
    @Optional() prismaShared?: PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  /**
   * Find every lead that's due for a follow-up and process each one. Errors
   * inside a single follow-up never abort the run — we want one bad lead not
   * to starve the rest of the queue.
   */
  async runDueFollowups(): Promise<FollowupRunResult> {
    if (!isEnabled()) {
      return { considered: 0, sent: 0, errors: 0, skipped: 0 };
    }

    const betweenHours = num('LEAD_FOLLOWUP_MIN_HOURS_BETWEEN', 24);
    const maxAttempts = num('LEAD_FOLLOWUP_MAX_ATTEMPTS', 2);

    const now = Date.now();
    // Sub-hour granularity — Marcos's tightened SLA. Util consults
    // QUOTE_FOLLOWUP_MINUTES first, falls back to QUOTE_FOLLOWUP_HOURS.
    const initialCutoff = new Date(now - quoteFollowupMs());
    const betweenCutoff = new Date(now - betweenHours * 3600 * 1000);

    const candidates = await this.prisma.lead.findMany({
      where: {
        status: LeadStatus.QUOTE_SENT,
        followupCount: { lt: maxAttempts },
        OR: [
          // First nudge: no follow-up yet, and the QUOTE_SENT transition is
          // older than the threshold.
          { lastFollowupAt: null, updatedAt: { lt: initialCutoff } },
          // Subsequent nudge: at least `betweenCutoff` since the last one.
          { lastFollowupAt: { lt: betweenCutoff } },
        ],
      },
      include: { contact: true },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    });

    const result: FollowupRunResult = {
      considered: candidates.length,
      sent: 0,
      errors: 0,
      skipped: 0,
    };

    for (const lead of candidates) {
      try {
        const ok = await this.followupOne(lead);
        if (ok) result.sent++;
        else result.skipped++;
      } catch (err: any) {
        result.errors++;
        this.logger.error(
          `Follow-up failed for lead ${lead.id} (non-fatal): ${err.message}`,
        );
      }
    }

    if (result.considered > 0) {
      this.logger.log(
        `Lead follow-up run: considered=${result.considered} sent=${result.sent} skipped=${result.skipped} errors=${result.errors}`,
      );
      this.metrics.emitTick('lead_followup');
    }

    return result;
  }

  private async followupOne(lead: {
    id: string;
    contactId: string;
    source: Channel;
    followupCount: number;
    contact: {
      id: string;
      name: string | null;
      phone: string | null;
      email: string | null;
      metadata: any;
    };
  }): Promise<boolean> {
    const text = compose(template(), lead.contact.name);

    // Find (or skip) the conversation that matches this lead's source.
    // Without a conversation we can't anchor the message in the UI, so we
    // bail without mutating the lead (it'll be retried next tick).
    const conversation = await this.prisma.conversation.findFirst({
      where: { contactId: lead.contactId, channel: lead.source },
      orderBy: { createdAt: 'desc' },
    });
    if (!conversation) {
      this.logger.warn(
        `Follow-up skipped — no ${lead.source} conversation for contact ${lead.contactId}`,
      );
      return false;
    }

    // Persist the nudge as AI-authored so operators see it in the timeline
    // even if the outbound send fails (no API creds yet, etc).
    const cipherText = getMessageCipher().encrypt(text);
    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: MessageSender.AI,
        content: cipherText,
        isFromAI: true,
        metadata: { kind: 'lead_followup', leadId: lead.id, attempt: lead.followupCount + 1 },
      },
    });
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessage: cipherText, lastMessageAt: new Date() },
    });

    // Best-effort outbound through the appropriate channel adapter.
    const sendResult = await this.dispatch(lead.source, lead.contact, conversation.id, text);
    if (!sendResult.ok) {
      this.logger.warn(
        `Lead ${lead.id} follow-up recorded but outbound failed: ${sendResult.reason}`,
      );
    }

    // Always increment counter & timestamp — even on outbound failure — so
    // a misconfigured channel doesn't trigger a tight retry loop. Operators
    // will see the un-sent message in the timeline.
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: {
        followupCount: { increment: 1 },
        lastFollowupAt: new Date(),
      },
    });

    return true;
  }

  private async dispatch(
    channel: Channel,
    contact: { phone: string | null; email: string | null; metadata: any },
    conversationId: string,
    text: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    try {
      switch (channel) {
        case Channel.WHATSAPP: {
          if (!contact.phone) return { ok: false, reason: 'contact has no phone' };
          const r = await this.whatsapp.sendMessage(
            new WhatsAppOutgoingMessage(contact.phone, text),
          );
          return r.success ? { ok: true } : { ok: false, reason: r.error ?? 'whatsapp send failed' };
        }

        case Channel.TIENDANUBE_WEBCHAT: {
          // The webchat adapter addresses by our internal conversation id —
          // the service maps it to TiendaNube's id internally.
          const r = await this.webchat.sendMessage(
            new WebchatOutgoingMessage(conversationId, text, WebchatMessageType.TEXT),
          );
          return r.success ? { ok: true } : { ok: false, reason: r.error ?? 'webchat send failed' };
        }

        case Channel.FACEBOOK:
        case Channel.INSTAGRAM: {
          const md = (contact.metadata as Record<string, any>) ?? {};
          const senderId = md.facebookSenderId ?? md.instagramSenderId ?? md.socialSenderId;
          if (!senderId) {
            return { ok: false, reason: 'contact missing social senderId metadata' };
          }
          const platform =
            channel === Channel.FACEBOOK ? SocialPlatform.FACEBOOK : SocialPlatform.INSTAGRAM;
          const r = await this.social.sendMessage(
            new SocialOutgoingMessage(platform, SocialMessageType.DIRECT_MESSAGE, senderId, text),
          );
          return r.success ? { ok: true } : { ok: false, reason: r.error ?? 'social send failed' };
        }

        case Channel.MERCADOLIBRE:
          // ML answers are scoped to a question — we can't proactively DM a
          // buyer there. Recorded in DB only.
          return { ok: false, reason: 'mercadolibre channel does not support proactive DMs' };

        default:
          return { ok: false, reason: `unsupported channel ${channel}` };
      }
    } catch (err: any) {
      return { ok: false, reason: err.message };
    }
  }
}
