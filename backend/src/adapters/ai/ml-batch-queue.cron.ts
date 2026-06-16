/**
 * ADAPTERS LAYER — Cron driver for the ML batch queue (Bloque E #4).
 *
 * Two ticks. The dispatcher fires every
 * ML_BATCH_DISPATCH_INTERVAL_MIN (default 5 min) to bundle PENDING
 * questions into an Anthropic Message Batch. The poller fires every
 * ML_BATCH_POLL_INTERVAL_MIN (default 2 min) to check on dispatched
 * batches and post the agent's reply to ML when ready. A third pass
 * in the dispatch tick catches stale PENDING (oldest beyond
 * ML_BATCH_MAX_AGE_MIN) and routes them through sync fallback so no
 * buyer waits forever if the batch cadence stalls.
 *
 * Both ticks no-op when ML_BATCH_MODE_ENABLED is not true, so we
 * always register the jobs and let the env flip them on at runtime.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { MlBatchQueueService } from './ml-batch-queue.service';

const DISPATCH_JOB = 'ml-batch-dispatch';
const POLL_JOB = 'ml-batch-poll';

function intervalEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

@Injectable()
export class MlBatchQueueCron implements OnModuleInit {
  private readonly logger = new Logger(MlBatchQueueCron.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly svc: MlBatchQueueService,
  ) {}

  onModuleInit() {
    const dispatchEvery = intervalEnv('ML_BATCH_DISPATCH_INTERVAL_MIN', 5);
    const pollEvery = intervalEnv('ML_BATCH_POLL_INTERVAL_MIN', 2);

    const dispatchJob = new CronJob(
      `*/${dispatchEvery} * * * *`,
      () => this.dispatchTick(),
    );
    this.registry.addCronJob(DISPATCH_JOB, dispatchJob as any);
    dispatchJob.start();

    const pollJob = new CronJob(`*/${pollEvery} * * * *`, () => this.pollTick());
    this.registry.addCronJob(POLL_JOB, pollJob as any);
    pollJob.start();

    this.logger.log(
      `ML batch crons registered: dispatch=*/${dispatchEvery}min poll=*/${pollEvery}min (enabled=${MlBatchQueueService.modeEnabled()})`,
    );
  }

  private async dispatchTick() {
    if (!MlBatchQueueService.modeEnabled()) return;
    try {
      const r = await this.svc.dispatchPending();
      if (r.dispatched > 0) {
        this.logger.log(`dispatch tick → batch ${r.batchId} (${r.dispatched} entries)`);
      }
      // Belt-and-braces — even with batch mode on, never let a
      // PENDING entry rot indefinitely if traffic is too low to
      // hit min batch size.
      const fb = await this.svc.fallbackStalePending();
      if (fb.rescued > 0) {
        this.logger.log(`dispatch tick → stale fallback rescued ${fb.rescued}`);
      }
    } catch (err: any) {
      this.logger.error(`dispatch tick errored: ${err.message}`);
    }
  }

  private async pollTick() {
    if (!MlBatchQueueService.modeEnabled()) return;
    try {
      const r = await this.svc.pollAndFinalize();
      if (r.finalized > 0) {
        this.logger.log(`poll tick → finalized ${r.finalized} of ${r.polled} batches`);
      }
    } catch (err: any) {
      this.logger.error(`poll tick errored: ${err.message}`);
    }
  }
}
