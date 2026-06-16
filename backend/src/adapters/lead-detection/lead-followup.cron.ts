/**
 * ADAPTERS LAYER — Cron tick that drives `LeadFollowupService.runDueFollowups`.
 *
 * Interval is read from `.env`:
 *   LEAD_FOLLOWUP_CRON_MINUTES — minutes between ticks (default 5)
 *
 * Set LEAD_FOLLOWUP_ENABLED=false to silence the run without removing the
 * cron registration (the service short-circuits inside).
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { LeadFollowupService } from './lead-followup.service';

const JOB_NAME = 'lead-followup-tick';

function intervalMinutes(): number {
  const raw = process.env.LEAD_FOLLOWUP_CRON_MINUTES;
  const n = raw != null ? Number(raw) : 5;
  return Number.isFinite(n) && n > 0 ? n : 5;
}

@Injectable()
export class LeadFollowupCron implements OnModuleInit {
  private readonly logger = new Logger(LeadFollowupCron.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly svc: LeadFollowupService,
  ) {}

  onModuleInit() {
    const minutes = intervalMinutes();
    // Standard 5-field cron — "*/N * * * *" runs every N minutes.
    const expr = `*/${minutes} * * * *`;
    const job = new CronJob(expr, () => this.tick());
    this.registry.addCronJob(JOB_NAME, job as any);
    job.start();
    this.logger.log(`Lead-followup cron registered: ${expr} (every ${minutes} min)`);
  }

  private async tick() {
    try {
      await this.svc.runDueFollowups();
    } catch (err: any) {
      this.logger.error(`Lead-followup tick errored: ${err.message}`);
    }
  }
}
