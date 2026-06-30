/**
 * ADAPTERS LAYER — Cron driver para re-fetch periódico de reclamos
 * abiertos contra ML, así el panel de Reclamos se mantiene
 * actualizado con las últimas respuestas del mediador / comprador /
 * vendedor sin depender de que el operador clickee "Sincronizar".
 *
 * Marcos 2026-06-30: el strip de HTML (sanitizer + decodificador
 * de entidades) que metí ayer corre dentro de
 * fetchClaimDetails — pero solo se aplica cuando un reclamo se
 * re-fetchea. Sin este cron, mensajes nuevos del mediador (que
 * llegan con HTML embebido tipo <p dir="ltr">...) quedarían en
 * crudo hasta el próximo "Sincronizar" manual. Este cron corre
 * cada N minutos y mantiene el historial limpio.
 *
 * Diferenciado del [[ml-claims-sync.cron]] (que reconcilia el SET
 * de reclamos abiertos contra ML, cierra rezagados) — este se
 * preocupa por el CONTENIDO de los reclamos abiertos.
 *
 * Env knob:
 *   ML_CLAIMS_REFRESH_CRON_EVERY_MIN — interval (default 60, ≥10)
 *   ML_CLAIMS_REFRESH_ENABLED        — kill switch (default true)
 *   ML_CLAIMS_REFRESH_LIMIT          — max reclamos por tick (default 200)
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { MercadolibreQaService } from './mercadolibre-qa.service';

const JOB_NAME = 'ml-claims-refresh';

function intervalMin(): number {
  const raw = process.env.ML_CLAIMS_REFRESH_CRON_EVERY_MIN;
  const n = raw != null ? Number(raw) : 60;
  if (!Number.isFinite(n) || n < 10) return 60;
  return n;
}

function isEnabled(): boolean {
  const raw = process.env.ML_CLAIMS_REFRESH_ENABLED;
  if (raw == null || raw.trim().length === 0) return true;
  return raw.trim().toLowerCase() === 'true';
}

function limit(): number {
  const raw = process.env.ML_CLAIMS_REFRESH_LIMIT;
  const n = raw != null ? Number(raw) : 200;
  if (!Number.isFinite(n) || n < 1) return 200;
  return Math.min(500, n);
}

@Injectable()
export class MlClaimsRefreshCron implements OnModuleInit {
  private readonly logger = new Logger(MlClaimsRefreshCron.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly svc: MercadolibreQaService,
  ) {}

  onModuleInit() {
    if (!isEnabled()) {
      this.logger.log('ML claims refresh cron disabled via ML_CLAIMS_REFRESH_ENABLED');
      return;
    }
    const every = intervalMin();
    const expr = `*/${every} * * * *`;
    const job = new CronJob(expr, () => this.tick());
    this.registry.addCronJob(JOB_NAME, job as any);
    job.start();
    this.logger.log(`ML claims refresh cron registered: ${expr} (UTC), limit=${limit()}`);
  }

  private async tick() {
    const t0 = Date.now();
    try {
      const r = await this.svc.refreshOpenClaims({ limit: limit() });
      const ms = Date.now() - t0;
      // Log resumido — solo cuando hubo actualización efectiva o
      // errores; ticks silenciosos no llenan el journal.
      if (r.updated > 0 || r.errored > 0) {
        this.logger.log(
          `ML claims refresh: scanned=${r.scanned} updated=${r.updated} skipped=${r.skipped} errored=${r.errored} in ${ms}ms`,
        );
      }
    } catch (err: any) {
      this.logger.error(`ML claims refresh tick errored: ${err?.message ?? err}`);
    }
  }
}
