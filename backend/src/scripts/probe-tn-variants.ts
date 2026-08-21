/**
 * Probe TN's product API for ONE product id and run the current
 * `normalize()` over the response. Confirms the multi-variant shape
 * is what we expect (values → presentation, per-variant sku/price)
 * before we let the full sync loose on 754 products.
 *
 *   set -a && . ./.env && set +a
 *   WHATSAPP_QR_ENABLED=false \
 *     npx ts-node --transpile-only src/scripts/probe-tn-variants.ts <productId>
 *
 * Defaults to Fibra de vidrio MAT 300 (50081054) — the sample from the
 * report — if no id is passed.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TiendaNubeAuthResolver } from '../adapters/oauth/tiendanube-auth.resolver';

async function main() {
  if ((process.env.WHATSAPP_QR_ENABLED ?? '').toLowerCase() !== 'false') {
    console.error('[probe] refusing to boot with WHATSAPP_QR_ENABLED != false');
    process.exit(2);
  }
  const productId = process.argv[2] ?? '50081054';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  const auth = app.get(TiendaNubeAuthResolver);
  const cred = await auth.resolve();
  if (!cred) {
    console.error('[probe] no TN credentials');
    process.exit(3);
  }
  const baseUrl = process.env.TIENDANUBE_API_URL ?? 'https://api.tiendanube.com/v1';
  const url = `${baseUrl}/${cred.storeId}/products/${productId}`;
  console.log(`[probe] GET ${url}`);
  const resp = await fetch(url, {
    headers: {
      Authentication: `bearer ${cred.accessToken}`,
      'User-Agent': process.env.TIENDANUBE_USER_AGENT ?? 'Servifibras-Backend',
      Accept: 'application/json',
    },
  });
  if (!resp.ok) {
    console.error(`[probe] HTTP ${resp.status} ${resp.statusText}`);
    process.exit(4);
  }
  const body = await resp.json();
  console.log('\n=== TN raw variants ===');
  for (const v of body.variants ?? []) {
    console.log({
      id: v.id,
      sku: v.sku,
      price: v.price,
      promotional_price: v.promotional_price,
      stock: v.stock,
      values: v.values,
    });
  }

  // Import normalize by importing the sync service and reflecting the
  // private method — cheap for a probe.
  const { TiendaNubeSyncService } = await import('../adapters/admin/tiendanube-sync.service');
  const sync = app.get(TiendaNubeSyncService);
  const rows = (sync as any).normalize(body);
  console.log(`\n=== normalize() output — ${rows.length} row(s) ===`);
  for (const r of rows) {
    console.log({
      sku: r.sku,
      name: r.name,
      baseUnit: r.baseUnit,
      basePriceArs: r.basePriceArs,
      stockQuantity: r.stockQuantity,
      tiendanubeVariantId: (r.attributes as any)?.tiendanubeVariantId,
    });
  }

  await app.close();
}

main().catch((err) => {
  console.error(`[probe] fatal: ${err?.message ?? err}`);
  console.error(err?.stack);
  process.exit(1);
});
