/**
 * Trigger a full TiendaNube product sync from the command line.
 * Marcos 2026-08-19 (Ustym report Frente B1): use this to rebuild the
 * catalog with per-variant rows after deploying the new normalize().
 *
 *   set -a && . ./.env && set +a
 *   WHATSAPP_QR_ENABLED=false \
 *     npx ts-node --transpile-only src/scripts/trigger-tn-sync.ts
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TiendaNubeSyncService } from '../adapters/admin/tiendanube-sync.service';

async function main() {
  if ((process.env.WHATSAPP_QR_ENABLED ?? '').toLowerCase() !== 'false') {
    console.error('[trigger-tn-sync] refusing to boot with WHATSAPP_QR_ENABLED != false');
    process.exit(2);
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error', 'log'],
  });
  const svc = app.get(TiendaNubeSyncService);
  const t0 = Date.now();
  const result = await svc.runSync();
  const dt = Date.now() - t0;
  console.log(JSON.stringify({ elapsedMs: dt, ...result }, null, 2));
  await app.close();
}

main().catch((err) => {
  console.error(`[trigger-tn-sync] fatal: ${err?.message ?? err}`);
  console.error(err?.stack);
  process.exit(1);
});
