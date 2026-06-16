/**
 * Meta Ads — Lead Ads (leadgen) webhook adapter.
 *
 * Meta posts leadgen events to the same webhook URL we already use for
 * Messenger / IG DMs (`POST /social/webhook`). The signature header is
 * the same `x-hub-signature-256` validated by `SocialMediaService`, so
 * the controller's existing signature gate already covers this branch.
 *
 * Lifecycle per event:
 *   1. webhook body arrives with entry[].changes[] where field='leadgen'
 *   2. for each change, GET /{leadgenId} on Graph to pull field_data
 *   3. resolve / create a Contact by email or phone (channel=FACEBOOK)
 *   4. create a Lead (source=FACEBOOK), with leadgenId + adId + formId
 *      stamped into notes so the panel can trace back to the ad
 *
 * Gated by META_ADS_LEADGEN_ENABLED — flips on once Marcos's Meta app
 * verification clears and the lead-ads subscription is live on the
 * Page. Until then the branch is a no-op that still 200s the webhook.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, Channel, LeadStatus } from '@prisma/client';
import { MetaAuthResolver } from '../oauth/meta-auth.resolver';

export interface MetaLeadgenEvent {
  leadgenId: string;
  formId: string | null;
  adId: string | null;
  adgroupId: string | null;
  pageId: string | null;
  createdTime: string | null;
}

export interface MetaLeadFieldData {
  /** Raw key/value pairs from the form. Field names are whatever the
   *  advertiser wrote in the form designer — we keep originals on the
   *  Lead's metadata so nothing is lost. */
  fields: Record<string, string>;
  email: string | null;
  phone: string | null;
  fullName: string | null;
}

@Injectable()
export class MetaAdsService {
  private readonly logger = new Logger(MetaAdsService.name);
  private readonly prisma = new PrismaClient();
  private readonly apiUrl: string;

  constructor(private readonly auth: MetaAuthResolver) {
    this.apiUrl = process.env.FACEBOOK_API_URL || 'https://graph.facebook.com/v18.0';
  }

  /**
   * Walk the webhook body and return every leadgen change Meta included.
   * One webhook delivery can carry multiple events; we iterate them all.
   */
  extractLeadgenEvents(body: any): MetaLeadgenEvent[] {
    const out: MetaLeadgenEvent[] = [];
    if (!body || body.object !== 'page' || !Array.isArray(body.entry)) return out;
    for (const entry of body.entry) {
      const pageId = entry?.id ?? null;
      if (!Array.isArray(entry?.changes)) continue;
      for (const change of entry.changes) {
        if (change?.field !== 'leadgen') continue;
        const v = change.value ?? {};
        if (!v.leadgen_id) continue;
        out.push({
          leadgenId: String(v.leadgen_id),
          formId: v.form_id ? String(v.form_id) : null,
          adId: v.ad_id ? String(v.ad_id) : null,
          adgroupId: v.adgroup_id ? String(v.adgroup_id) : null,
          pageId: v.page_id ? String(v.page_id) : pageId,
          createdTime: v.created_time ? String(v.created_time) : null,
        });
      }
    }
    return out;
  }

  /**
   * Fetch a leadgen submission's actual answers from Graph.
   * Returns null if the page token is missing or the call fails — the
   * caller logs and moves on so one bad event doesn't block the batch.
   */
  async fetchLead(leadgenId: string): Promise<MetaLeadFieldData | null> {
    const auth = await this.auth.resolve();
    if (!auth?.pageAccessToken) {
      this.logger.warn(`fetchLead(${leadgenId}): no Page access token — cannot fetch`);
      return null;
    }
    const url = `${this.apiUrl}/${leadgenId}?fields=field_data,created_time,ad_id,form_id`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${auth.pageAccessToken}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn(`fetchLead(${leadgenId}) → ${res.status} ${text.slice(0, 200)}`);
        return null;
      }
      const data: any = await res.json();
      return this.parseFieldData(data?.field_data);
    } catch (err: any) {
      this.logger.error(`fetchLead(${leadgenId}) threw: ${err?.message}`);
      return null;
    }
  }

  parseFieldData(raw: any): MetaLeadFieldData {
    const fields: Record<string, string> = {};
    if (Array.isArray(raw)) {
      for (const f of raw) {
        const name = String(f?.name ?? '').toLowerCase();
        const value = Array.isArray(f?.values) && f.values.length ? String(f.values[0]) : '';
        if (name && value) fields[name] = value;
      }
    }
    // Meta's canonical field names map to these keys (the advertiser
    // can override the label but the underlying `name` stays standard
    // for prefilled fields). Custom fields fall through to `fields`.
    const email = fields['email'] || fields['email_address'] || null;
    const phone = fields['phone_number'] || fields['phone'] || null;
    const fullName =
      fields['full_name'] ||
      [fields['first_name'], fields['last_name']].filter(Boolean).join(' ').trim() ||
      null;
    return { fields, email, phone, fullName };
  }

  /**
   * Find an existing Contact by email/phone or create one, then open a
   * new Lead linked to that contact. Idempotent on leadgenId via a
   * dedup check against any Lead whose notes already mention this id.
   */
  async ingestLead(event: MetaLeadgenEvent, data: MetaLeadFieldData): Promise<{
    created: boolean;
    leadId: string | null;
    contactId: string | null;
    reason: string;
  }> {
    // Dedup — Meta retries delivery, and the same leadgen_id can also
    // be re-emitted from the test tool. Match by id stamped in notes.
    const dup = await this.prisma.lead.findFirst({
      where: { notes: { contains: `leadgen:${event.leadgenId}` } },
      select: { id: true, contactId: true },
    });
    if (dup) {
      return { created: false, leadId: dup.id, contactId: dup.contactId, reason: 'dedup_existing_leadgen' };
    }

    if (!data.email && !data.phone) {
      this.logger.warn(`leadgen ${event.leadgenId}: no email/phone — skipping`);
      return { created: false, leadId: null, contactId: null, reason: 'no_contact_info' };
    }

    // Contact resolution prefers phone (unique key) over email, since
    // email isn't enforced unique in the schema.
    let contact = null as any;
    if (data.phone) {
      contact = await this.prisma.contact.findUnique({ where: { phone: data.phone } });
    }
    if (!contact && data.email) {
      contact = await this.prisma.contact.findFirst({ where: { email: data.email } });
    }
    if (!contact) {
      contact = await this.prisma.contact.create({
        data: {
          name: data.fullName,
          phone: data.phone,
          email: data.email,
          channel: Channel.FACEBOOK,
          metadata: { metaAds: { leadgenId: event.leadgenId, formId: event.formId, adId: event.adId } },
        },
      });
    }

    const noteParts: string[] = [`Meta Ads leadgen:${event.leadgenId}`];
    if (event.adId) noteParts.push(`ad:${event.adId}`);
    if (event.formId) noteParts.push(`form:${event.formId}`);
    const customFields = Object.entries(data.fields)
      .filter(([k]) => !['email', 'email_address', 'phone', 'phone_number', 'full_name', 'first_name', 'last_name'].includes(k))
      .map(([k, v]) => `${k}: ${v}`);
    if (customFields.length) noteParts.push(customFields.join(' | '));

    const lead = await this.prisma.lead.create({
      data: {
        contactId: contact.id,
        status: LeadStatus.NEW,
        source: Channel.FACEBOOK,
        notes: noteParts.join(' — '),
      },
    });

    this.logger.log(`✅ Meta Ads lead ${lead.id} created from leadgen ${event.leadgenId} (contact ${contact.id})`);
    return { created: true, leadId: lead.id, contactId: contact.id, reason: 'created' };
  }

  /**
   * One-shot: extract events, fetch each, ingest each. Used by the
   * webhook controller. Each event is independent — a failure on one
   * does not stop the others.
   */
  async processWebhookBody(body: any): Promise<{ processed: number; created: number; errors: number }> {
    const enabled = String(process.env.META_ADS_LEADGEN_ENABLED || '').toLowerCase() === 'true';
    if (!enabled) return { processed: 0, created: 0, errors: 0 };

    const events = this.extractLeadgenEvents(body);
    if (!events.length) return { processed: 0, created: 0, errors: 0 };

    let created = 0;
    let errors = 0;
    for (const ev of events) {
      try {
        const data = await this.fetchLead(ev.leadgenId);
        if (!data) { errors++; continue; }
        const result = await this.ingestLead(ev, data);
        if (result.created) created++;
      } catch (err: any) {
        this.logger.error(`leadgen ${ev.leadgenId} failed: ${err?.message}`);
        errors++;
      }
    }
    return { processed: events.length, created, errors };
  }
}
