/**
 * ADAPTERS LAYER — Cron driver for the weekly leads report.
 *
 * Default schedule: Mondays 11:00 UTC (08:00 Buenos Aires) so Marcos
 * sees it on his phone the moment he opens WhatsApp at the office.
 * `WEEKLY_LEADS_REPORT_CRON` overrides the expression entirely if
 * Marcos asks for a different cadence (e.g. fortnightly or Sunday
 * evening).
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { WeeklyLeadsReportService } from './weekly-leads-report.service';

const JOB_NAME = 'weekly-leads-report';
const DEFAULT_CRON = '0 11 * * 1';

function cronExpr(): string {
  const raw = process.env.WEEKLY_LEADS_REPORT_CRON;
  if (!raw || raw.trim().length === 0) return DEFAULT_CRON;
  // Quick sanity: 5 whitespace-separated fields.
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 5) return DEFAULT_CRON;
  return raw.trim();
}

@Injectable()
export class WeeklyLeadsReportCron implements OnModuleInit {
  private readonly logger = new Logger(WeeklyLeadsReportCron.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly svc: WeeklyLeadsReportService,
  ) {}

  onModuleInit() {
    const expr = cronExpr();
    const job = new CronJob(expr, () => this.tick());
    this.registry.addCronJob(JOB_NAME, job as any);
    job.start();
    this.logger.log(`Weekly-leads-report cron registered: ${expr} (UTC)`);
  }

  private async tick() {
    try {
      await this.svc.run();
    } catch (err: any) {
      this.logger.error(`Weekly-leads-report tick errored: ${err.message}`);
    }
  }
}
