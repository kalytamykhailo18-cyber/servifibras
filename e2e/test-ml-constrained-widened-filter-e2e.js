// E2E: modo cerrado ML lee también las Q&A 'pending' con answerText
// (Marcos 2026-07-06 — "el histórico cargado debería alimentar cada
// publicación").
//
// Antes: filtro `curationStatus IN ('kept','edited')` excluía 8000+
// filas del sync que no habían pasado por curación manual.
// Ahora: incluye pending con answerText → cobertura de 132 → 428
// publicaciones que hoy pueden usar modo cerrado.
//
// Este test corre contra el servicio real (dist/) para asegurar que el
// filtro widening no rompe nada del pipeline downstream (buildListingFichaBlock,
// self-eval, autoSend threshold, etc.).

const path = require('path');

async function main() {
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { MlPublicationKnowledgeService } = require('/home/servifibras/backend/dist/src/adapters/admin/ml-publication-knowledge.service');
  const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const svc = app.get(MlPublicationKnowledgeService);
  const prisma = new PrismaClient();

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // Pick a publication that has ≥3 rows total (all pending with answerText,
  // no kept/edited) — this is the "before-widening blind spot" case.
  const target = await prisma.$queryRawUnsafe(`
    SELECT k."itemId", count(*)::int AS total,
      count(*) FILTER (WHERE k."curationStatus" IN ('kept','edited'))::int AS curated_count,
      count(*) FILTER (WHERE k."curationStatus" = 'pending' AND k."answerText" IS NOT NULL)::int AS pending_answered
    FROM ml_publication_knowledge k
    GROUP BY 1
    HAVING count(*) FILTER (WHERE k."curationStatus" IN ('kept','edited')) < 3
       AND count(*) FILTER (WHERE k."curationStatus" = 'pending' AND k."answerText" IS NOT NULL) >= 3
    LIMIT 1
  `);

  ok(
    'test target publication exists (curated <3 but pending-answered ≥3)',
    target.length > 0,
    target.length > 0 ? `itemId=${target[0].itemId} curated=${target[0].curated_count} pending-answered=${target[0].pending_answered}` : '(no candidates)',
  );

  if (target.length === 0) {
    await prisma.$disconnect();
    await app.close();
    console.log(`\n=== ${pass} passed, ${fail} failed (nothing to test) ===`);
    process.exit(fail > 0 ? 1 : 0);
  }

  const itemId = target[0].itemId;
  const rows = await prisma.mlPublicationKnowledge.findMany({
    where: { itemId },
    select: { questionText: true, answerText: true, curationStatus: true },
  });
  const sample = rows.find((r) => r.curationStatus === 'pending' && r.answerText);
  ok('sample pending row has both questionText and answerText', !!sample?.questionText && !!sample?.answerText);

  // Call tryConstrainedReply with the pending sample question. With the
  // widened filter the service should:
  //   (a) load pending+answered rows into the qaBlock (was previously empty)
  //   (b) either return a reply, OR return usedConstrained=false with a
  //       reason that ISN'T "curated=X < min=3"
  const question = sample?.questionText ?? 'test';
  const r = await svc.tryConstrainedReply({
    itemId,
    buyerQuestion: question,
    buyerNickname: 'test-nickname',
    listing: null, // Let the service fetch it (may fail if item is stale, that's ok)
    ignoreEnabledFlag: true,
  });

  console.log(`  → tryConstrainedReply returned: usedConstrained=${r.usedConstrained} reason=${r.reason ?? '(none)'}`);

  ok(
    'filter widening: reason is NOT "curated=<3"',
    !((r.reason ?? '').includes('curated=') && (r.reason ?? '').includes('< min=')),
    `reason=${r.reason ?? '(none)'}`,
  );

  await prisma.$disconnect();
  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
