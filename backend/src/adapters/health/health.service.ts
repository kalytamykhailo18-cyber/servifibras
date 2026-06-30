/**
 * ADAPTERS LAYER - Health Service
 *
 * Aggregates per-component health checks into a single shape that's friendly
 * to uptime monitors. All checks run in parallel; the overall status is the
 * worst of any single component:
 *
 *   ok            — every required component reports ok or unconfigured
 *   degraded      — at least one component is degraded; service still usable
 *   down          — at least one required component is down; do not route traffic
 *
 * Per-component states:
 *   ok            — passing
 *   degraded      — partial (e.g. dólar blue cache exists but is older than the
 *                   configured staleness threshold)
 *   down          — check failed outright
 *   unconfigured  — feature not yet wired (e.g. Claude API key still missing)
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ExchangeRateService } from '../pricing/exchange-rate.service';
import * as fs from 'fs';
import * as path from 'path';

export type HealthStatus = 'ok' | 'degraded' | 'down' | 'unconfigured';

export interface ComponentReport {
  status: HealthStatus;
  details?: Record<string, unknown>;
}

export interface HealthReport {
  status: HealthStatus;
  timestamp: string;
  service: string;
  components: Record<string, ComponentReport>;
}

function num(envKey: string, fallback: number): number {
  const v = process.env[envKey];
  const n = v != null ? Number(v) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly prisma = new PrismaClient();

  constructor(private readonly exchangeRate: ExchangeRateService) {}

  async check(): Promise<HealthReport> {
    const [database, dolarBlue, claude, backup] = await Promise.all([
      this.checkDatabase(),
      this.checkDolarBlueCache(),
      Promise.resolve(this.checkClaudeConfig()),
      Promise.resolve(this.checkBackupRecency()),
    ]);

    const components: Record<string, ComponentReport> = {
      database,
      dolarBlue,
      claude,
      backup,
    };

    return {
      status: this.aggregate(components),
      timestamp: new Date().toISOString(),
      service: 'servifibras-backend',
      components,
    };
  }

  private async checkDatabase(): Promise<ComponentReport> {
    try {
      // Cheap round-trip — no app data, just confirms DB is reachable and
      // accepting queries.
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch (err: any) {
      this.logger.error(`DB health check failed: ${err.message}`);
      return { status: 'down', details: { error: err.message } };
    }
  }

  private async checkDolarBlueCache(): Promise<ComponentReport> {
    const info = this.exchangeRate.getCacheInfo();
    if (info.rate == null) {
      // Service hasn't fetched a rate yet; first quote will populate. That's
      // not "down" — it's just cold.
      return { status: 'degraded', details: { reason: 'no rate cached yet' } };
    }
    const ageHours = (info.ageMs ?? 0) / 3_600_000;
    const staleHours = num('DOLAR_BLUE_STALE_AFTER_HOURS', 24);
    if (ageHours > staleHours) {
      return {
        status: 'degraded',
        details: {
          rate: info.rate,
          source: info.source,
          ageHours: Math.round(ageHours * 10) / 10,
          staleAfterHours: staleHours,
          cachedAt: info.cachedAt,
        },
      };
    }
    return {
      status: 'ok',
      details: {
        rate: info.rate,
        source: info.source,
        ageHours: Math.round(ageHours * 10) / 10,
        cachedAt: info.cachedAt,
      },
    };
  }

  private checkClaudeConfig(): ComponentReport {
    const hasKey = !!process.env.CLAUDE_API_KEY || !!process.env.ANTHROPIC_API_KEY;
    if (!hasKey) {
      // Not a failure — just not configured yet. Health monitor should NOT
      // alert on this until Marcos provides the key.
      return { status: 'unconfigured', details: { reason: 'CLAUDE_API_KEY/ANTHROPIC_API_KEY not set' } };
    }
    return { status: 'ok' };
  }

  /**
   * Check that the nightly Postgres dump ran recently. Reads the
   * `.last_run` breadcrumb that `ops/backup-postgres.sh` touches at the end
   * of every successful run.
   *
   * - ok          — last run within BACKUP_OK_WITHIN_HOURS (default 30h)
   * - degraded    — last run within BACKUP_STALE_AFTER_HOURS (default 48h)
   * - down        — last run older than the stale threshold OR file missing
   * - unconfigured — BACKUP_DIR is empty/never been written (fresh deploy)
   */
  private checkBackupRecency(): ComponentReport {
    const dir = process.env.BACKUP_DIR && process.env.BACKUP_DIR.length > 0
      ? process.env.BACKUP_DIR
      : '/srv/servifibras-backups';
    const breadcrumb = path.join(dir, '.last_run');
    const okHours = num('BACKUP_OK_WITHIN_HOURS', 30);
    const staleHours = num('BACKUP_STALE_AFTER_HOURS', 48);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(breadcrumb);
    } catch {
      // No breadcrumb yet — either the timer hasn't fired or backup was
      // never set up. Distinguish from "down" so we don't alarm on day-1
      // deployments.
      return {
        status: 'unconfigured',
        details: { reason: 'no backup run yet', expectedAt: breadcrumb },
      };
    }
    const ageHours = (Date.now() - stat.mtime.getTime()) / 3_600_000;
    const rounded = Math.round(ageHours * 10) / 10;
    if (ageHours > staleHours) {
      return {
        status: 'down',
        details: { lastRunAt: stat.mtime.toISOString(), ageHours: rounded, staleAfterHours: staleHours },
      };
    }
    if (ageHours > okHours) {
      return {
        status: 'degraded',
        details: { lastRunAt: stat.mtime.toISOString(), ageHours: rounded, okWithinHours: okHours },
      };
    }
    return {
      status: 'ok',
      details: { lastRunAt: stat.mtime.toISOString(), ageHours: rounded, dir },
    };
  }

  private aggregate(components: Record<string, ComponentReport>): HealthStatus {
    const states = Object.values(components).map((c) => c.status);
    if (states.includes('down')) return 'down';
    if (states.includes('degraded')) return 'degraded';
    return 'ok';
  }
}
