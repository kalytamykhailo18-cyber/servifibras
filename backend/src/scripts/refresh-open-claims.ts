/**
 * Refresh todos los reclamos abiertos: re-fetch claim details desde
 * ML y re-guarda el mensaje con el formato actualizado (importante
 * después del strip HTML de mediador del 2026-06-29 — los reclamos
 * viejos tenían el HTML crudo guardado y necesitan re-pull para que
 * el panel los muestre limpios).
 *
 *   bash ops/refresh-open-claims.sh [limit=200]
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { MercadolibreQaService } from '../adapters/admin/mercadolibre-qa.service';

async function main() {
  const argLimit = (process.argv[2] ?? '').trim();
  const limit = argLimit ? Number(argLimit) : 200;
  console.log(`[refresh-open-claims] limit=${limit}`);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  try {
    const svc = app.get(MercadolibreQaService);
    const t0 = Date.now();
    const r = await svc.refreshOpenClaims({ limit });
    const dt = Date.now() - t0;
    console.log(`[refresh] done in ${dt}ms — ${JSON.stringify(r)}`);
  } catch (err: any) {
    console.error(`[refresh] failed: ${err?.message ?? err}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((err) => { console.error(`[refresh] fatal: ${err?.message ?? err}`); process.exit(1); });
