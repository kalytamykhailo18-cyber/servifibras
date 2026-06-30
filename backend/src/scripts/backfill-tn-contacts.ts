/**
 * Marcos 2026-06-30: one-shot deep backfill — invoca el TN orders
 * sync con lookback extendido (365d) y maxPages alto (200) para
 * que CADA contacto histórico tenga su postalCode + locality
 * stampeado en metadata. Imprescindible para que el recommender
 * (postal-code-zone.recommendZoneDefaults) tenga atribución
 * precisa por GBA1/2/3 en vez de colapsar BUENOS AIRES en un
 * solo bucket.
 *
 * Idempotente — solo escribe contact.metadata cuando los campos
 * faltan (gracias al guard `!patch.postalCode` en la sync). Re-
 * ejecutarlo es seguro pero solo agrega lo nuevo.
 *
 * Uso: bash ops/backfill-tn-contacts.sh
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TiendaNubeOrdersSyncService } from '../adapters/admin/tiendanube-orders-sync.service';

async function main() {
  // Override sync config for this one-shot. The service reads
  // env at call time so we can patch process.env safely.
  const originalLookback = process.env.TIENDANUBE_ORDERS_LOOKBACK_DAYS;
  const originalMaxPages = process.env.TIENDANUBE_ORDERS_MAX_PAGES;
  process.env.TIENDANUBE_ORDERS_LOOKBACK_DAYS = '365';
  process.env.TIENDANUBE_ORDERS_MAX_PAGES = '200';
  console.log(`[backfill] lookback=365d maxPages=200`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  const svc = app.get(TiendaNubeOrdersSyncService);
  const t0 = Date.now();
  try {
    const result = await svc.runSync();
    console.log(`[backfill] done in ${Date.now() - t0}ms`, JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error(`[backfill] error: ${err?.message ?? err}`);
    process.exit(1);
  } finally {
    if (originalLookback !== undefined) process.env.TIENDANUBE_ORDERS_LOOKBACK_DAYS = originalLookback;
    if (originalMaxPages !== undefined) process.env.TIENDANUBE_ORDERS_MAX_PAGES = originalMaxPages;
  }
  await app.close();
  process.exit(0);
}
main();
