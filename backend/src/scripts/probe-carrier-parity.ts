/**
 * Marcos 2026-08-19 (Ustym report Frente D): comparación E2E entre
 * "Logística diaria" (daily-logistica-aggregator) y "Despachos por
 * mensajería" (analytics.getDispatchStats). El reporte flagged que
 * el mismo paquete quedaba "Sin asignar" en un panel y atribuido a
 * una mensajería concreta en el otro. Este probe corre AMBAS del
 * mismo rango de tiempo y compara los conteos por mensajería.
 *
 *   set -a && . ./.env && set +a
 *   WHATSAPP_QR_ENABLED=false \
 *     npx ts-node --transpile-only src/scripts/probe-carrier-parity.ts [YYYY-MM-DD]
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DailyLogisticaAggregatorService } from '../adapters/admin/daily-logistica-aggregator.service';
import { AnalyticsService } from '../adapters/admin/analytics.service';

function todayISO(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

async function main() {
  if ((process.env.WHATSAPP_QR_ENABLED ?? '').toLowerCase() !== 'false') {
    console.error('[probe] refusing to boot with WHATSAPP_QR_ENABLED != false');
    process.exit(2);
  }
  const isoDay = process.argv[2] ?? todayISO();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const aggregator = app.get(DailyLogisticaAggregatorService);
  const analytics = app.get(AnalyticsService);

  const dateObj = new Date(`${isoDay}T12:00:00Z`);
  const fromIso = `${isoDay}T00:00:00Z`;
  const toIso = `${isoDay}T23:59:59Z`;

  console.log(`[probe] date=${isoDay}\n`);

  const agg = await aggregator.aggregate(dateObj);
  const disp = await analytics.getDispatchStats({ fromIso, toIso });

  // Aggregator counts pending+listas per carrier chip
  const aggByCarrier = new Map<string, number>();
  for (const c of agg.carrierSummary) {
    aggByCarrier.set(c.carrier, (aggByCarrier.get(c.carrier) ?? 0) + c.total);
  }

  // Analytics counts DISPATCHED (manuallyDispatchedAt) per carrier
  const dispByCarrier = new Map<string, number>();
  for (const b of disp.byCarrier) {
    dispByCarrier.set(b.carrier, (dispByCarrier.get(b.carrier) ?? 0) + b.count);
  }

  const carriers = new Set<string>([...aggByCarrier.keys(), ...dispByCarrier.keys()]);
  console.log('=== per-carrier count ===');
  console.log('carrier'.padEnd(30), 'aggregator(pending+listas)'.padStart(28), 'analytics(dispatched)'.padStart(24));
  for (const c of Array.from(carriers).sort()) {
    console.log(
      c.padEnd(30),
      String(aggByCarrier.get(c) ?? 0).padStart(28),
      String(dispByCarrier.get(c) ?? 0).padStart(24),
    );
  }

  console.log(`\n=== aggregator carrierSummary (totalEstimatedCost per carrier) ===`);
  for (const c of agg.carrierSummary) {
    console.log(
      c.carrier.padEnd(30),
      `pending=${c.pending}`.padEnd(14),
      `listas=${c.listas}`.padEnd(12),
      `total=${c.total}`.padEnd(10),
      `perPack=${c.estimatedCostPerPackage ?? 'null'}`.padEnd(16),
      `totalCost=${c.estimatedCostTotal ?? 'null'}`,
    );
  }

  console.log(`\n=== analytics byCarrier (totalEstimatedCost) ===`);
  for (const b of disp.byCarrier) {
    console.log(
      b.carrier.padEnd(30),
      `count=${b.count}`.padEnd(12),
      `totalShippingCost=${b.totalShippingCost ?? 'null'}`.padEnd(26),
      `totalEstimatedCost=${b.totalEstimatedCost ?? 'null'}`.padEnd(24),
      `rowsWithoutTariff=${b.rowsWithoutTariff}`,
    );
  }

  console.log(`\n=== analytics headline ===`);
  console.log({
    total: disp.total,
    totalShippingCost: disp.totalShippingCost,
    totalEstimatedCost: disp.totalEstimatedCost,
    rowsWithoutTariff: disp.rowsWithoutTariff,
  });

  await app.close();
}

main().catch((err) => {
  console.error(`[probe] fatal: ${err?.message ?? err}`);
  console.error(err?.stack);
  process.exit(1);
});
