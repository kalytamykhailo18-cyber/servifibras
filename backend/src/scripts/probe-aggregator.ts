/**
 * Probe one-off — invoca DailyLogisticaAggregatorService.aggregate
 * para la fecha de hoy y deja que los timings se logueen normalmente.
 * Útil para medir el aggregator sin esperar a tráfico real.
 *
 *   bash ops/probe-aggregator.sh
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DailyLogisticaAggregatorService } from '../adapters/admin/daily-logistica-aggregator.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const svc = app.get(DailyLogisticaAggregatorService);
    const t0 = Date.now();
    const r = await svc.aggregate(new Date());
    const dt = Date.now() - t0;
    const rows = Object.values(r.sections).reduce((a, s) => a + s.length, 0);
    console.log(`[probe] aggregate done in ${dt}ms (rows=${rows}, errors=${r.errors.length})`);
  } catch (err: any) {
    console.error(`[probe] failed: ${err?.message ?? err}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(`[probe] fatal: ${err?.message ?? err}`);
  process.exit(1);
});
