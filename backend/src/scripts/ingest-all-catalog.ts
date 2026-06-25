/**
 * Standalone CLI: dispara la ingesta completa del catálogo activo en
 * ambas cuentas ML. Útil para seedear la base de conocimiento por
 * publicación sin pasar por HTTP/JWT.
 *
 *   npx ts-node src/scripts/ingest-all-catalog.ts
 *   npx ts-node src/scripts/ingest-all-catalog.ts mercadolibre
 *   npx ts-node src/scripts/ingest-all-catalog.ts mercadolibre_cuenta2
 *
 * Diseñado para correr en background (nohup + redirect). Loguea el
 * total al terminar y sale con código 0 (éxito parcial cuenta).
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { MlPublicationKnowledgeService } from '../adapters/admin/ml-publication-knowledge.service';

async function main() {
  const arg = (process.argv[2] ?? 'both').toLowerCase();
  const accountKey: 'mercadolibre' | 'mercadolibre_cuenta2' | 'both' =
    arg === 'mercadolibre' || arg === 'mercadolibre_cuenta2' ? (arg as any) : 'both';

  const t0 = Date.now();
  console.log(`[ingest-all-catalog] start accountKey=${accountKey} pid=${process.pid}`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const svc = app.get(MlPublicationKnowledgeService);
    const r = await svc.ingestAllCatalog({ accountKey });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[ingest-all-catalog] DONE in ${dt}s totals=${JSON.stringify(r.totals)} note=${r.note ?? ''}`);
  } catch (err: any) {
    console.error(`[ingest-all-catalog] FAILED: ${err?.message ?? err}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(`[ingest-all-catalog] fatal: ${err?.message ?? err}`);
  process.exit(1);
});
