/**
 * ADAPTERS LAYER — Cron driver for the daily digest. Same pattern as the
 * reactivation and TiendaNube crons.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { DailyDigestService } from './daily-digest.service';

const JOB_NAME = 'daily-digest';

function cronExpr(): string {
  const raw = process.env.DAILY_DIGEST_CRON_HOUR;
  const h = raw != null ? Number(raw) : 11;
  const safeHour = Number.isFinite(h) && h >= 0 && h <= 23 ? h : 11;
  return `0 ${safeHour} * * *`;
}

@Injectable()
export class DailyDigestCron implements OnModuleInit {
  private readonly logger = new Logger(DailyDigestCron.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly svc: DailyDigestService,
  ) {}

  onModuleInit() {
    const expr = cronExpr();
    const job = new CronJob(expr, () => this.tick());
    this.registry.addCronJob(JOB_NAME, job as any);
    job.start();
    this.logger.log(`Daily-digest cron registered: ${expr} (UTC)`);
  }

  private async tick() {
    try {
      await this.svc.runDigest();
    } catch (err: any) {
      this.logger.error(`Daily-digest tick errored: ${err.message}`);
    }
  }
}
