/**
 * ADAPTERS LAYER — Cron driver para reconciliar reclamos abiertos
 * contra la lista canónica de MercadoLibre.
 *
 * Marcos 2026-06-22: nuestro panel de Reclamos acumulaba stale opens
 * porque los webhooks no siempre nos avisan cuando ML cierra un
 * reclamo del lado de ellos (58 abiertos en DB vs 11 en ML).
 * MercadolibreQaService.syncOpenClaimsWithMl() corre la
 * reconciliación; este cron la dispara cada N minutos.
 *
 * Env knob:
 *   ML_CLAIMS_SYNC_CRON_EVERY_MIN — interval in minutes
 *                                   (default 30, clamped to ≥5)
 *   ML_CLAIMS_SYNC_ENABLED        — kill switch, default true
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { MercadolibreQaService } from './mercadolibre-qa.service';

const JOB_NAME = 'ml-claims-sync';

function intervalMin(): number {
  const raw = process.env.ML_CLAIMS_SYNC_CRON_EVERY_MIN;
  const n = raw != null ? Number(raw) : 30;
  if (!Number.isFinite(n) || n < 5) return 30;
  return n;
}

function isEnabled(): boolean {
  const raw = process.env.ML_CLAIMS_SYNC_ENABLED;
  if (raw == null || raw.trim().length === 0) return true;
  return raw.trim().toLowerCase() === 'true';
}

@Injectable()
export class MlClaimsSyncCron implements OnModuleInit {
  private readonly logger = new Logger(MlClaimsSyncCron.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly svc: MercadolibreQaService,
  ) {}

  onModuleInit() {
    if (!isEnabled()) {
      this.logger.log('ML claims sync cron disabled via ML_CLAIMS_SYNC_ENABLED');
      return;
    }
    const every = intervalMin();
    const expr = `*/${every} * * * *`;
    const job = new CronJob(expr, () => this.tick());
    this.registry.addCronJob(JOB_NAME, job as any);
    job.start();
    this.logger.log(`ML claims sync cron registered: ${expr} (UTC)`);
  }

  private async tick() {
    try {
      const r = await this.svc.syncOpenClaimsWithMl();
      // Sólo log "ruidoso" cuando algo cambió o hay webhook miss —
      // tick rutinario silencioso para no llenar el journal.
      if (r.resolved > 0 || r.missingInDb.length > 0) {
        this.logger.log(
          `ML claims sync tick: mlOpen=${r.mlOpen} dbOpen=${r.dbOpen} ` +
          `resolved=${r.resolved} missingInDb=${r.missingInDb.length}`,
        );
      }
    } catch (err: any) {
      this.logger.error(`ML claims sync tick errored: ${err.message}`);
    }
  }
}
