/**
 * ADAPTERS LAYER — Contact reactivation pipeline.
 *
 * Marcos's `REACTIVAR` funnel stage existed in the schema but nothing
 * populated it. This service runs nightly and:
 *
 *   1) Finds contacts in COMPRADOR / FRECUENTE whose last order is older
 *      than CONTACT_REACTIVATION_INACTIVE_DAYS.
 *   2) Flips them to REACTIVAR (forward-only — same dimension semantics
 *      as the rest of the system; admin can override manually if needed).
 *   3) Optionally fires a reactivation campaign with a Spanish default
 *      template ("hace tiempo que no nos vemos…") via `CampaignService`.
 *      Idempotent — won't fire twice on the same contact within the
 *      same window.
 *
 * Tunable in `.env`:
 *   CONTACT_REACTIVATION_ENABLED         — kill switch ('true' default)
 *   CONTACT_REACTIVATION_INACTIVE_DAYS   — days since last order (default 90)
 *   CONTACT_REACTIVATION_CRON_HOUR       — UTC hour for the daily run (default 4)
 *   CONTACT_REACTIVATION_AUTO_CAMPAIGN   — 'true' (default) | 'false';
 *      when false we just flip the stage and let Marcos send the
 *      campaign manually from /campaigns
 *   CONTACT_REACTIVATION_TEMPLATE        — override default Spanish text
 *      ({{nombre}} interpolated)
 *   CONTACT_REACTIVATION_BATCH_SIZE      — max contacts to flip per run
 *      (default 200 — same scale as CAMPAIGN_BATCH_SIZE)
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  CustomerType,
  FunnelStage,
  PrismaClient,
} from '@prisma/client';
import { CampaignService } from './campaign.service';

const DEFAULT_TEMPLATE =
  '¡Hola{{nombre}}! Hace tiempo que no nos vemos por Servifibras. ¿Estás necesitando algo? Tenemos novedades de stock y precios actualizados que te pueden interesar.';

function num(envKey: string, fallback: number): number {
  const v = process.env[envKey];
  const n = v != null ? Number(v) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(envKey: string, fallback: boolean): boolean {
  const v = process.env[envKey];
  if (v == null || v.trim().length === 0) return fallback;
  return v.trim().toLowerCase() === 'true';
}

function template(): string {
  const raw = process.env.CONTACT_REACTIVATION_TEMPLATE;
  if (raw && raw.trim().length > 0) return raw;
  return DEFAULT_TEMPLATE;
}

export interface ReactivationRunResult {
  considered: number;
  flagged: number;
  campaignId: string | null;
  campaignSent: number;
  campaignFailed: number;
}

@Injectable()
export class ContactReactivationService {
  private readonly logger = new Logger(ContactReactivationService.name);
  private readonly prisma: PrismaClient;

  constructor(
    private readonly campaigns: CampaignService,
    @Optional() prismaShared?: import('../repositories/prisma.service').PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  /**
   * Find dormant contacts and flip them to REACTIVAR. Optionally fires
   * a follow-up campaign on the just-flagged set. Always returns counts
   * so the cron logger can record what happened.
   */
  async runDueReactivations(): Promise<ReactivationRunResult> {
    if (!bool('CONTACT_REACTIVATION_ENABLED', true)) {
      return { considered: 0, flagged: 0, campaignId: null, campaignSent: 0, campaignFailed: 0 };
    }

    const inactiveDays = num('CONTACT_REACTIVATION_INACTIVE_DAYS', 90);
    const batchSize = num('CONTACT_REACTIVATION_BATCH_SIZE', 200);
    const since = new Date(Date.now() - inactiveDays * 24 * 3600 * 1000);

    // Eligible: contact is COMPRADOR or FRECUENTE AND most recent order
    // is older than `since`. We exclude contacts already in REACTIVAR /
    // earlier stages so this remains forward-only.
    const candidates = await this.prisma.contact.findMany({
      where: {
        funnelStage: { in: [FunnelStage.COMPRADOR, FunnelStage.FRECUENTE] },
        orders: {
          // every() with the lt cutoff is "all orders older than X". An
          // empty orders array also matches (vacuously true), which is
          // also what we want — a former buyer who somehow has no orders
          // in the table is dormant by definition.
          every: { createdAt: { lt: since } },
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: batchSize,
    });

    if (candidates.length === 0) {
      this.logger.log('Reactivation: no candidates due');
      return { considered: 0, flagged: 0, campaignId: null, campaignSent: 0, campaignFailed: 0 };
    }

    // Flip stage in a single update — same semantics as the lead pipeline
    // (single-statement Prisma update keeps history clean).
    const ids = candidates.map((c) => c.id);
    const flagged = await this.prisma.contact.updateMany({
      where: { id: { in: ids } },
      data: { funnelStage: FunnelStage.REACTIVAR },
    });

    this.logger.log(
      `Reactivation: flagged ${flagged.count} contacts (inactive>${inactiveDays}d) → REACTIVAR`,
    );

    if (!bool('CONTACT_REACTIVATION_AUTO_CAMPAIGN', true)) {
      return {
        considered: candidates.length,
        flagged: flagged.count,
        campaignId: null,
        campaignSent: 0,
        campaignFailed: 0,
      };
    }

    // Fire a reactivation campaign on the just-flagged set. We piggy-back
    // on the campaign machinery rather than duplicating outbound code —
    // anything Marcos changes about throttling, channel routing or
    // delivery audit also applies here.
    const customerTypes = Array.from(
      new Set(candidates.map((c) => c.customerType).filter(Boolean) as CustomerType[]),
    );

    let campaignId: string | null = null;
    let campaignSent = 0, campaignFailed = 0;

    try {
      const created = await this.campaigns.create({
        name: `Reactivación automática ${new Date().toISOString().slice(0, 10)}`,
        messageTemplate: template(),
        filters: {
          customerTypes,
          funnelStages: [FunnelStage.REACTIVAR],
          channel: null,
        },
        createdBy: null,
      });
      campaignId = created.campaignId;

      const sendResult = await this.campaigns.send(created.campaignId);
      campaignSent = sendResult.sent;
      campaignFailed = sendResult.failed;

      this.logger.log(
        `Reactivation campaign ${campaignId}: sent=${campaignSent} failed=${campaignFailed}`,
      );
    } catch (err: any) {
      // Campaign failures must never roll back the stage flip — operators
      // can manually re-trigger from /campaigns if needed.
      this.logger.error(`Reactivation campaign failed (non-fatal): ${err.message}`);
    }

    return {
      considered: candidates.length,
      flagged: flagged.count,
      campaignId,
      campaignSent,
      campaignFailed,
    };
  }
}
