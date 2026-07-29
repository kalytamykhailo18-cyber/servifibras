/**
 * ADAPTERS LAYER - Health Service
 *
 * Aggregates per-component health checks into a single shape that's friendly
 * to uptime monitors. All checks run in parallel; the overall status uses
 * a traffic-criticality split:
 *
 *   ok            — every required component reports ok or unconfigured
 *   degraded      — at least one component is degraded, OR a non-critical
 *                   component is down (e.g. WhatsApp session dropped). The
 *                   platform is still fully routable — login, CRM, ML flows
 *                   keep working.
 *   down          — at least one CRITICAL component is down; the load
 *                   balancer must stop routing traffic here.
 *
 * The critical component set (default: only `database`) is env-tunable via
 * HEALTH_CRITICAL_COMPONENTS (comma-separated). Auxiliary integrations
 * (WhatsApp/Baileys, dólar blue, backup breadcrumb) surface their own `down`
 * state per-component so the frontend banner still lights up, but they no
 * longer take the whole platform offline behind Caddy.
 *
 * Per-component states:
 *   ok            — passing
 *   degraded      — partial (e.g. dólar blue cache exists but is older than the
 *                   configured staleness threshold)
 *   down          — check failed outright
 *   unconfigured  — feature not yet wired (e.g. Claude API key still missing)
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ExchangeRateService } from '../pricing/exchange-rate.service';
import { WhatsappQrService } from '../whatsapp-qr/whatsapp-qr.service';
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

  constructor(
    private readonly exchangeRate: ExchangeRateService,
    @Optional() private readonly whatsappQr?: WhatsappQrService,
  ) {}

  async check(): Promise<HealthReport> {
    const [database, dolarBlue, claude, backup, whatsapp] = await Promise.all([
      this.checkDatabase(),
      this.checkDolarBlueCache(),
      Promise.resolve(this.checkClaudeConfig()),
      Promise.resolve(this.checkBackupRecency()),
      Promise.resolve(this.checkWhatsAppQr()),
    ]);

    const components: Record<string, ComponentReport> = {
      database,
      dolarBlue,
      claude,
      backup,
      whatsapp,
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

  // Marcos 2026-07-18: la CRM se quedó sin sincronizar con WhatsApp
  // por 48h porque nadie miró el estado de Baileys. Ahora /health
  // reporta el canal:
  //   - unconfigured — WHATSAPP_QR_ENABLED=false (Meta Cloud only)
  //   - degraded     — starting / waiting_qr / connecting (transición)
  //   - ok           — conectado y con JID
  //   - down         — disconnected / errored / disabled cuando enabled=true
  // El frontend consume este estado para mostrar un banner rojo
  // "WhatsApp desconectado — escaneá el QR" en todas las páginas.
  private checkWhatsAppQr(): ComponentReport {
    if (!this.whatsappQr) {
      return { status: 'unconfigured', details: { reason: 'WhatsappQrService not wired' } };
    }
    const s = this.whatsappQr.getStatus();
    if (!s.enabled) {
      return { status: 'unconfigured', details: { reason: 'WHATSAPP_QR_ENABLED=false' } };
    }
    const details = {
      connectionStatus: s.status,
      connectedJid: s.connectedJid,
      connectedAt: s.connectedAt,
      accountLabel: s.accountLabel,
      lastError: s.lastError,
      sessionDirExists: s.sessionDirExists,
    };
    if (s.status === 'connected') {
      return { status: 'ok', details };
    }
    if (s.status === 'starting' || s.status === 'connecting' || s.status === 'waiting_qr') {
      return { status: 'degraded', details };
    }
    return { status: 'down', details };
  }

  private aggregate(components: Record<string, ComponentReport>): HealthStatus {
    const critical = this.criticalSet();
    let anyDown = false;
    let anyDegraded = false;
    for (const [name, comp] of Object.entries(components)) {
      if (comp.status === 'down') {
        if (critical.has(name)) return 'down';
        anyDown = true; // non-critical down → treated as degraded overall
      } else if (comp.status === 'degraded') {
        anyDegraded = true;
      }
    }
    return anyDown || anyDegraded ? 'degraded' : 'ok';
  }

  private criticalSet(): Set<string> {
    const raw = process.env.HEALTH_CRITICAL_COMPONENTS;
    const list = (raw && raw.trim().length > 0 ? raw : 'database')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return new Set(list);
  }
}
