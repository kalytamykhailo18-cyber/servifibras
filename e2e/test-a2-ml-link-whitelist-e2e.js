// A2 (documento de trabajo 2026-07-10): las URLs de MercadoLibre que
// emite el agente tienen que estar en el whitelist real del catálogo,
// no aprobadas solamente por dominio.
//
// Criterio de aceptación del documento:
//   "Test que inyecte un link de una publicación inexistente y
//    verifique que se elimina o reemplaza; y que un link válido pase."

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

  // KB loads asynchronously; the outer scrub only runs when
  // validCatalogUrls is populated. Wait until BOTH the TN catalog
  // and the ML item-id allowlist have loaded — a race here silently
  // downgrades the scrub to a no-op and every URL passes through.
  for (let i = 0; i < 40; i++) {
    if (claude['validCatalogUrls']?.size > 0 && claude['validMlItemIds']?.size > 0) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // Pick a real ML permalink from the catalog (whichever the KB loaded
  // at boot). If there are none in the DB right now, we skip the "real
  // link passes" assertion and only check the fabricated-drop path.
  const oneRealMlPermalink = await prisma.$queryRawUnsafe(
    `SELECT "mlPermalink" FROM products
     WHERE "mlPermalink" IS NOT NULL AND "mlPermalink" != ''
     LIMIT 1`
  );
  const realPermalink = oneRealMlPermalink[0]?.mlPermalink ?? null;
  console.log(`  → real ML permalink for test: ${realPermalink ?? '(none in DB)'}`);

  const fabricated = 'https://articulo.mercadolibre.com.ar/MLA-999999999-publicacion-inventada-por-la-ia-_JM';

  // Call the private method via bracket access — same pattern the ML
  // isolation test uses (test-only entry point).
  const scrub = (text, channel) =>
    claude['dropFabricatedUrls'](text, channel);

  // Case 1: fabricated MLA URL in an ML-channel reply.
  //   Before A2: passed through (regex only checks mercadolibre.com.ar
  //   domain). After A2: dropped with warning.
  const withFabricated = `Mirá la publicación: ${fabricated} — te sirve?`;
  const scrubbed = scrub(withFabricated, 'MERCADOLIBRE');
  ok(
    'fabricated ML URL is dropped from ML-channel reply',
    !scrubbed.text.includes('999999999'),
    scrubbed.text.slice(0, 120),
  );
  ok(
    'dropped count reflects the strip',
    scrubbed.dropped >= 1,
    `dropped=${scrubbed.dropped}`,
  );

  // Case 2: the ML store profile URL is always allowed (it was called
  // out explicitly in the pre-A2 code as a cross-channel whitelist).
  const storeProfile = 'https://www.mercadolibre.com.ar/tienda/servifibras';
  const scrubbedStore = scrub(`Visitá nuestro perfil: ${storeProfile}`, 'MERCADOLIBRE');
  ok(
    'ML store profile URL still passes on ML channel',
    scrubbedStore.text.includes('tienda/servifibras'),
    scrubbedStore.text,
  );

  // Case 3: a real permalink from the catalog passes.
  if (realPermalink) {
    const scrubbedReal = scrub(`Este es: ${realPermalink}`, 'MERCADOLIBRE');
    ok(
      'real ML permalink from catalog passes through',
      scrubbedReal.text.includes(realPermalink),
      scrubbedReal.text.slice(0, 140),
    );
  } else {
    console.log('  (skipped real-permalink check — no ML permalinks in DB yet)');
  }

  // Case 4: private-channel (WhatsApp) behaviour unchanged — ML URL
  // still stripped, not "allowed via A2 permalink".
  const scrubbedWA = scrub(`Fijate: ${fabricated}`, 'WHATSAPP');
  ok(
    'WhatsApp channel still strips ML URL (private-channel rule wins)',
    !scrubbedWA.text.includes('999999999'),
    scrubbedWA.text.slice(0, 120),
  );

  await prisma.$disconnect();
  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
