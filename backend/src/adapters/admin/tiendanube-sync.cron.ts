/**
 * ADAPTERS LAYER — Cron driver for TiendaNube product sync.
 *
 * Same pattern as the lead-followup and reactivation crons. Service
 * short-circuits inside when credentials are missing, so we always
 * register the job and only the work is gated.
 *
 * Tunable in `.env`:
 *   TIENDANUBE_SYNC_CRON_HOUR — UTC hour (0-23) for the daily run.
 *                               Default 3 (00:00 Buenos Aires, off-peak).
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { TiendaNubeSyncService } from './tiendanube-sync.service';

const JOB_NAME = 'tiendanube-sync-daily';

function cronExpr(): string {
  // Marcos 2026-08-15: la sync corría 1×día y arrastraba productos
  // con precio viejo cuando algunas filas quedaban salteadas por
  // 429s puntuales — pasó con la resina de 3 L que quedó cotizada
  // a $124.999 mientras que el precio real es $121.000. Además cuando
  // Marcos activa una promo desde TN, el catálogo del agente tarda
  // hasta 24 h en reflejarla. Ahora corre cada N horas
  // (TIENDANUBE_SYNC_EVERY_HOURS, default 2), así una promo nueva
  // llega al agente en menos de 2 h y una fila que falló por rate-
  // limit tiene 12 chances por día de refrescarse.
  const rawEvery = process.env.TIENDANUBE_SYNC_EVERY_HOURS;
  const everyH = rawEvery != null ? Number(rawEvery) : 2;
  if (Number.isFinite(everyH) && everyH >= 1 && everyH <= 24) {
    return `0 */${Math.floor(everyH)} * * *`;
  }
  // Legacy fallback: TIENDANUBE_SYNC_CRON_HOUR runs once a day.
  const raw = process.env.TIENDANUBE_SYNC_CRON_HOUR;
  const h = raw != null ? Number(raw) : 3;
  const safeHour = Number.isFinite(h) && h >= 0 && h <= 23 ? h : 3;
  return `0 ${safeHour} * * *`;
}

@Injectable()
export class TiendaNubeSyncCron implements OnModuleInit {
  private readonly logger = new Logger(TiendaNubeSyncCron.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly svc: TiendaNubeSyncService,
  ) {}

  onModuleInit() {
    const expr = cronExpr();
    const job = new CronJob(expr, () => this.tick());
    this.registry.addCronJob(JOB_NAME, job as any);
    job.start();
    this.logger.log(`TiendaNube sync cron registered: ${expr} (UTC)`);
  }

  private async tick() {
    try {
      await this.svc.runSync();
    } catch (err: any) {
      this.logger.error(`TiendaNube sync tick errored: ${err.message}`);
    }
  }
}
