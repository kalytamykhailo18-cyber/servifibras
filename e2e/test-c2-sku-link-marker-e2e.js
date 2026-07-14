// C2 (documento de trabajo 2026-07-10): el agente emite un marcador
// con el código del producto (SKU) y el sistema lo reemplaza por el
// link real del catálogo antes de enviar. Inventar un link se vuelve
// imposible por construcción — todo link final viene del catálogo.
//
// Criterio de aceptación del documento:
//   "Aunque el modelo intente escribir una URL, la respuesta final
//    solo contiene links resueltos por el sistema desde el catálogo."

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { ClaudeService } = require('/home/servifibras/backend/dist/src/adapters/ai/claude.service');
  const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const claude = app.get(ClaudeService);
  const prisma = new PrismaClient();

  // KB loads asynchronously; wait until the SKU map is populated.
  for (let i = 0; i < 40; i++) {
    if (claude['skuToUrl']?.size > 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // Pick a real product from the catalog that has both TN and ML URLs.
  const sample = await prisma.$queryRawUnsafe(
    `SELECT sku, url, "mlPermalink"
     FROM products
     WHERE active = true AND sku IS NOT NULL AND url IS NOT NULL AND "mlPermalink" IS NOT NULL
     LIMIT 1`
  );
  if (sample.length === 0) {
    console.log('  ✗ no product with both TN + ML URLs in catalog — cannot test');
    process.exit(1);
  }
  const { sku, url: tnUrl, mlPermalink } = sample[0];
  console.log(`  → test SKU: ${sku}  TN=${tnUrl.slice(0, 50)}...  ML=${mlPermalink.slice(0, 50)}...`);

  const scrub = (text, channel) => claude['dropFabricatedUrls'](text, channel);

  // Case 1: {{link:SKU}} in ML-channel reply → resolves to mlPermalink.
  const mlReply = `Mirá esta publicación: {{link:${sku}}}`;
  const scrubbedML = scrub(mlReply, 'MERCADOLIBRE');
  ok(
    'ML channel: {{link:SKU}} → mlPermalink',
    scrubbedML.text.includes(mlPermalink) && !scrubbedML.text.includes('{{link:'),
    scrubbedML.text.slice(0, 120),
  );

  // Case 2: {{link:SKU}} in WhatsApp reply → resolves to TN URL (private channel).
  const waReply = `Te paso el link: {{link:${sku}}}`;
  const scrubbedWA = scrub(waReply, 'WHATSAPP');
  ok(
    'WhatsApp channel: {{link:SKU}} → TN URL (private channel)',
    scrubbedWA.text.includes(tnUrl) && !scrubbedWA.text.includes('{{link:'),
    scrubbedWA.text.slice(0, 120),
  );

  // Case 3: unknown SKU → marker stripped (safety), never leaked.
  const badReply = `Fijate: {{link:SKU-NO-EXISTE-42}}`;
  const scrubbedBad = scrub(badReply, 'MERCADOLIBRE');
  ok(
    'unknown SKU marker is stripped, not leaked',
    !scrubbedBad.text.includes('{{link:'),
    scrubbedBad.text,
  );

  // Case 4: fabricated raw URL still gets dropped even if marker path is present.
  const mixed = `Mirá: {{link:${sku}}} — o esta otra ${'https://articulo.mercadolibre.com.ar/MLA-999999999-fabricated-_JM'}`;
  const scrubbedMixed = scrub(mixed, 'MERCADOLIBRE');
  ok(
    'C2 marker resolves AND A2 whitelist still drops fabricated URL',
    scrubbedMixed.text.includes(mlPermalink) && !scrubbedMixed.text.includes('999999999'),
    scrubbedMixed.text.slice(0, 160),
  );

  // Case 5: lowercased SKU marker also resolves (tolerant match).
  const lowerReply = `Link: {{ link: ${sku.toLowerCase()} }}`;
  const scrubbedLower = scrub(lowerReply, 'MERCADOLIBRE');
  ok(
    'lowercased/spaced marker also resolves',
    scrubbedLower.text.includes(mlPermalink),
    scrubbedLower.text.slice(0, 120),
  );

  await prisma.$disconnect();
  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
