/**
 * ADAPTERS LAYER — Cron driver for the reactivation pipeline.
 *
 * Runs once a day at CONTACT_REACTIVATION_CRON_HOUR (default 04:00 UTC,
 * which is 01:00 in Buenos Aires — quiet hours). Service short-circuits
 * inside when CONTACT_REACTIVATION_ENABLED=false, so we always register
 * the job; only the work is gated.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ContactReactivationService } from './contact-reactivation.service';

const JOB_NAME = 'contact-reactivation-daily';

function cronExpr(): string {
  const raw = process.env.CONTACT_REACTIVATION_CRON_HOUR;
  const h = raw != null ? Number(raw) : 4;
  const safeHour = Number.isFinite(h) && h >= 0 && h <= 23 ? h : 4;
  return `0 ${safeHour} * * *`;
}

@Injectable()
export class ContactReactivationCron implements OnModuleInit {
  private readonly logger = new Logger(ContactReactivationCron.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly svc: ContactReactivationService,
  ) {}

  onModuleInit() {
    const expr = cronExpr();
    const job = new CronJob(expr, () => this.tick());
    this.registry.addCronJob(JOB_NAME, job as any);
    job.start();
    this.logger.log(`Reactivation cron registered: ${expr} (UTC)`);
  }

  private async tick() {
    try {
      await this.svc.runDueReactivations();
    } catch (err: any) {
      this.logger.error(`Reactivation tick errored: ${err.message}`);
    }
  }
}
