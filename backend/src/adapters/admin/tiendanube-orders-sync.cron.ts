/**
 * ADAPTERS LAYER — Cron driver for the TiendaNube ORDERS sync
 * (Bloque B item 3).
 *
 * Runs more frequently than the products cron because orders are
 * the live operational signal for the daily-logistica panel —
 * Marcos wants to see new TN orders in MOTOS/MICROS within minutes,
 * not the next-day window.
 *
 * Env knob:
 *   TIENDANUBE_ORDERS_CRON_EVERY_MIN — interval in minutes
 *                                      (default 30, clamped to ≥5)
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { TiendaNubeOrdersSyncService } from './tiendanube-orders-sync.service';

const JOB_NAME = 'tiendanube-orders-sync';

function intervalMin(): number {
  const raw = process.env.TIENDANUBE_ORDERS_CRON_EVERY_MIN;
  const n = raw != null ? Number(raw) : 30;
  if (!Number.isFinite(n) || n < 5) return 30;
  return n;
}

@Injectable()
export class TiendaNubeOrdersSyncCron implements OnModuleInit {
  private readonly logger = new Logger(TiendaNubeOrdersSyncCron.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly svc: TiendaNubeOrdersSyncService,
  ) {}

  onModuleInit() {
    const every = intervalMin();
    const expr = `*/${every} * * * *`;
    const job = new CronJob(expr, () => this.tick());
    this.registry.addCronJob(JOB_NAME, job as any);
    job.start();
    this.logger.log(`TiendaNube orders sync cron registered: ${expr} (UTC)`);
  }

  private async tick() {
    try {
      const r = await this.svc.runSync();
      if (r.fetched > 0) {
        this.logger.log(
          `TN orders tick: pages=${r.pages} fetched=${r.fetched} created=${r.created} updated=${r.updated} skipped=${r.skipped} errors=${r.errors.length}`,
        );
      }
    } catch (err: any) {
      this.logger.error(`TN orders sync tick errored: ${err.message}`);
    }
  }
}
