/**
 * ADAPTERS LAYER — cron que reconcilia el flag needsHumanAttention.
 *
 * Marcos 2026-07-20: se descubrió que la cola de Atención estaba
 * inflada por rows históricas donde staff ya había respondido pero el
 * flag no se limpió (paths antiguos previos a los fixes de 07-15/07-16).
 * Este cron corre una vez por hora, escanea todas las conversaciones
 * con needsHumanAttention=true y las limpia SI y solo si existe un
 * mensaje de staff con timestamp > escalatedAt. Es una operación
 * idempotente y con audit trail — cada barrido loguea la lista de IDs
 * limpiados (nunca es una mutación silenciosa).
 *
 * Env:
 *   HANDOFF_RECONCILE_CRON_MINUTES — intervalo (default 60)
 *   HANDOFF_RECONCILE_ENABLED       — 'false' para silenciar sin
 *                                     desregistrar el job (default true)
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { HumanHandoffService } from './human-handoff.service';

const JOB_NAME = 'handoff-reconcile-tick';

function intervalMinutes(): number {
  const raw = process.env.HANDOFF_RECONCILE_CRON_MINUTES;
  const n = raw != null ? Number(raw) : 60;
  return Number.isFinite(n) && n > 0 ? n : 60;
}

function enabled(): boolean {
  return (process.env.HANDOFF_RECONCILE_ENABLED ?? 'true').toLowerCase() !== 'false';
}

@Injectable()
export class HandoffReconcileCron implements OnModuleInit {
  private readonly logger = new Logger(HandoffReconcileCron.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly svc: HumanHandoffService,
  ) {}

  onModuleInit() {
    if (!enabled()) {
      this.logger.log('Handoff reconcile cron disabled via HANDOFF_RECONCILE_ENABLED=false');
      return;
    }
    const minutes = intervalMinutes();
    const expr = `*/${minutes} * * * *`;
    const job = new CronJob(expr, () => this.tick());
    this.registry.addCronJob(JOB_NAME, job as any);
    job.start();
    this.logger.log(`Handoff reconcile cron registered: ${expr} (every ${minutes} min)`);
  }

  private async tick() {
    try {
      const result = await this.svc.reconcileStaleNeedsHumanAttention();
      // Log de summary aunque no haya rows para limpiar — así queda claro
      // que el reconciler está vivo. Sin log, un cron silencioso se
      // vuelve invisible (mismo motivo por el que health.service ahora
      // reporta whatsapp).
      this.logger.log(
        `Handoff reconcile tick: scanned=${result.scanned} cleared=${result.cleared} byChannel=${JSON.stringify(result.byChannel)}`,
      );
    } catch (err: any) {
      this.logger.error(`Handoff reconcile tick errored: ${err.message}`);
    }
  }
}
