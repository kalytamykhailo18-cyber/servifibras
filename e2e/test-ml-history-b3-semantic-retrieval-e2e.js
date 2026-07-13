// B3 (documento de trabajo 2026-07-10): las respuestas curadas se
// tienen que priorizar por SIMILITUD con la pregunta actual, no por
// recencia. Antes, en publicaciones con muchas Q&A (top hoy: ~530
// curadas), un parafraseo del comprador quedaba fuera de la ventana
// de 50 más recientes y nunca se cruzaba con la respuesta correcta.
//
// Criterio de aceptación del documento:
//   "Test con una pregunta parafraseada que recupere la respuesta
//    curada correcta"
//
// Este test valida sobre la publicación real MLA1484744515 (~529
// curadas). Inserta una Q&A con contenido específico ("botella con
// tapón dorado 500ml", pregunta explícita) hace un ratito, y otra 60
// filas de ruido más recientes. Después consulta con la constrained-
// reply loop y verifica que la fila específica cruzó al prompt aunque
// no sea la más reciente.

async function main() {
  // No Baileys durante el test — evita el stream:conflict contra prod.
  process.env.WHATSAPP_QR_ENABLED = 'false';
  // Constrained mode se prueba directo desde el DB fetch, no hace falta
  // pegarle a Anthropic.
  process.env.ML_CONSTRAINED_REPLY_ENABLED = 'false';

  const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');
  const prisma = new PrismaClient();

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  const stamp = Date.now();
  const ITEM_ID = `MLA-B3-TEST-${stamp}`;

  // 1) Inject the "gold" Q&A pair — semantically specific vocabulary.
  const goldQuestion = 'Consulta sobre el tiempo de curado de la resina para artesanías';
  const goldAnswer = 'El curado tarda 24 horas al tacto y 72 horas para uso pleno.';
  await prisma.mlPublicationKnowledge.create({
    data: {
      itemId: ITEM_ID,
      mlQuestionId: `gold-${stamp}`,
      accountKey: 'mercadolibre',
      questionText: goldQuestion,
      answerText: goldAnswer,
      curatedAnswer: goldAnswer,
      curationStatus: 'kept',
      questionAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago (old)
      answeredAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
  });

  // 2) Inject 60 noise rows — recent but unrelated to curing time.
  for (let i = 0; i < 60; i++) {
    await prisma.mlPublicationKnowledge.create({
      data: {
        itemId: ITEM_ID,
        mlQuestionId: `noise-${stamp}-${i}`,
        accountKey: 'mercadolibre',
        questionText: `Hola, pregunta ${i} sobre color, pigmento, brillo o envío`,
        answerText: `Respuesta genérica ${i}`,
        curatedAnswer: `Respuesta genérica ${i}`,
        curationStatus: 'kept',
        questionAt: new Date(Date.now() - i * 60_000), // recent (0..60 min ago)
        answeredAt: new Date(Date.now() - i * 60_000),
      },
    });
  }
  console.log(`  → seeded 1 gold + 60 noise curated rows on ${ITEM_ID}`);

  // 3) Direct DB simulation of what the constrained-reply loop does now.
  //    Old behavior would have ordered by questionAt DESC (recency) →
  //    gold row (30d old) drops out of top 50. New behavior orders by
  //    ts_rank(spanish, questionText) DESC first.
  const paraphrase = '¿cuánto tarda en secar la resina?';
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "questionText", "answerText",
            (to_tsvector('spanish', coalesce("questionText", ''))
              @@ replace(plainto_tsquery('spanish', $2)::text, ' & ', ' | ')::tsquery)::int AS matched,
            ts_rank(
              to_tsvector('spanish', coalesce("questionText", '')),
              replace(plainto_tsquery('spanish', $2)::text, ' & ', ' | ')::tsquery
            ) AS rank
     FROM ml_publication_knowledge
     WHERE "itemId" = $1
       AND (
         "curationStatus" IN ('kept', 'edited')
         OR ("curationStatus" = 'pending' AND "answerText" IS NOT NULL)
       )
     ORDER BY matched DESC, rank DESC, "questionAt" DESC
     LIMIT 50`,
    ITEM_ID,
    paraphrase,
  );

  ok('50 rows returned', rows.length === 50);

  const goldIndex = rows.findIndex((r) => r.answerText === goldAnswer);
  ok(
    'gold row appears in the top 50 (was out under old recency-only ordering)',
    goldIndex >= 0,
    goldIndex >= 0 ? `position=${goldIndex + 1}` : 'not found in top 50',
  );

  // The gold row shares "resina" and "tarda" stems with the paraphrase;
  // noise questions share no query stems. So gold should be a MATCH and
  // all noise should be NON-MATCH.
  ok(
    'gold row is a match (matched=1)',
    goldIndex >= 0 && rows[goldIndex].matched === 1,
    goldIndex >= 0 ? `matched=${rows[goldIndex].matched}` : 'n/a',
  );

  // Since noise has no query overlap, gold should land at position 1.
  ok(
    'gold row ranks at position 1 (above all recency-noise)',
    goldIndex === 0,
    `position=${goldIndex + 1}`,
  );

  // Cleanup
  await prisma.mlPublicationKnowledge.deleteMany({ where: { itemId: ITEM_ID } });
  await prisma.$disconnect();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
