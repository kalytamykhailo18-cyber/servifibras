/**
 * Probe one-off para Despachos por mensajería. Llama getDispatchStats
 * sobre el rango pasado por args (default: último mes) y dumpea el
 * resumen por carrier. Útil para verificar el comportamiento de la
 * cascada de derivación de carrier sin esperar tráfico real al
 * endpoint admin/analytics/dispatch-stats.
 *
 *   bash ops/probe-dispatch-stats.sh [from=YYYY-MM-DD] [to=YYYY-MM-DD]
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AnalyticsService } from '../adapters/admin/analytics.service';

async function main() {
  const argFrom = (process.argv[2] ?? '').trim();
  const argTo = (process.argv[3] ?? '').trim();
  const from = argFrom || new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = argTo || new Date().toISOString().slice(0, 10);
  const fromIso = `${from}T00:00:00.000Z`;
  const toIso = `${to}T23:59:59.999Z`;

  console.log(`[probe-dispatch-stats] range ${fromIso} → ${toIso}`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  try {
    const svc = app.get(AnalyticsService);
    const t0 = Date.now();
    const r = await svc.getDispatchStats({ fromIso, toIso });
    const dt = Date.now() - t0;
    console.log(`[probe] done in ${dt}ms — total=${r.total}`);
    console.log('Carrier         | packs | cobrado    | estimado   | sin-tarifa');
    console.log('----------------+-------+------------+------------+-----------');
    for (const c of r.byCarrier) {
      const carrier = c.carrier.padEnd(15);
      const packs = String(c.count).padStart(5);
      const cobrado = `ARS ${Math.round(c.totalShippingCost)}`.padStart(10);
      const estimado = c.totalEstimatedCost != null ? `ARS ${Math.round(c.totalEstimatedCost)}`.padStart(10) : '         —';
      const sinTarifa = String(c.rowsWithoutTariff).padStart(8);
      console.log(`${carrier} | ${packs} | ${cobrado} | ${estimado} | ${sinTarifa}`);
      for (const z of c.byZone) {
        console.log(`  └─ ${z.zone.padEnd(10)} ${String(z.count).padStart(3)} packs`);
      }
    }
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
