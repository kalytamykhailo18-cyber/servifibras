// Marcos 2026-08-04 (WhatsApp 10:54 AR): "cuando son preguntas de
// cuenta 2, saluda dos veces". Screenshot con doble firma
// "Saludos! Tamara de TiendaServifibras." + "Un saludo, Lucas de
// Servifibras." en el mismo draft. Root cause: el recall léxico en
// tryConstrainedReply filtraba SOLO por itemId, no por accountKey.
// Para publicaciones que existen en ambas cuentas, mezclaba Q&A con
// firmas históricas distintas ("Tamara" en cuenta 2, "Lucas" en
// cuenta 1) y el modelo reproducía ambas.
//
// Fix: agregar filtro opcional accountKey al recall + pipear el
// mlAccountKey del inbound desde el conversation handler.
//
// Test valida el filtro directo sobre la SQL (bypasea el Claude
// call, que ya vimos que corre siempre — ConfigModule reloadea la
// key después del bootstrap). Ejecutamos la misma query que
// tryConstrainedReply, con y sin el filtro accountKey, y verificamos
// que el conteo de rows sea el esperado.

async function main() {
  const path = require('path');
  const { PrismaClient } = require(path.join('/home/servifibras/backend/node_modules/@prisma/client'));
  const prisma = new PrismaClient();

  const suffix = String(process.pid);
  const itemId = `MLA-DUALACCT-${suffix}`;
  await prisma.mlPublicationKnowledge.deleteMany({ where: { itemId } });

  const seed = async (accountKey, qid, q, a) => {
    await prisma.mlPublicationKnowledge.create({
      data: {
        itemId, accountKey,
        mlQuestionId: `${itemId}-${accountKey}-${qid}`,
        questionText: q, answerText: a,
        questionAt: new Date(), answeredAt: new Date(),
        curationStatus: 'kept',
      },
    });
  };

  // Cuenta 1 — firma "Lucas"
  await seed('mercadolibre',         1, '¿Sirve para artesanías?', 'Sí, sirve. Un saludo, Lucas de Servifibras.');
  await seed('mercadolibre',         2, '¿Relación de mezcla?',    '2 a 1. Un saludo, Lucas de Servifibras.');
  await seed('mercadolibre',         3, '¿Apta para exteriores?',  'Sí. Un saludo, Lucas de Servifibras.');

  // Cuenta 2 — firma "Tamara"
  await seed('mercadolibre_cuenta2', 1, '¿Sirve para artesanías?', 'Sí. Saludos! Tamara de TiendaServifibras.');
  await seed('mercadolibre_cuenta2', 2, '¿Relación de mezcla?',    '2 a 1. Saludos! Tamara de TiendaServifibras.');
  await seed('mercadolibre_cuenta2', 3, '¿Apta para exteriores?',  'Sí. Saludos! Tamara de TiendaServifibras.');

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // Misma SQL que tryConstrainedReply ejecuta, con el filtro accountKey
  const recall = async (accountKey) => prisma.$queryRawUnsafe(
    `SELECT "questionText", "answerText", "accountKey"
     FROM ml_publication_knowledge
     WHERE "itemId" = $1
       AND ($3::text IS NULL OR "accountKey" = $3)
       AND (
         "curationStatus" IN ('kept', 'edited')
         OR ("curationStatus" = 'pending' AND "answerText" IS NOT NULL)
       )
     ORDER BY
       (to_tsvector('spanish', coalesce("questionText", ''))
         @@ replace(plainto_tsquery('spanish', $2)::text, ' & ', ' | ')::tsquery)::int DESC,
       "questionAt" DESC`,
    itemId, '¿Sirve para artesanías?', accountKey,
  );

  const rBoth = await recall(null);
  ok('sin accountKey: recall trae Q&A de AMBAS cuentas (6 rows)',
     rBoth.length === 6, `got=${rBoth.length}`);
  const anyLucas = rBoth.some(r => (r.answerText ?? '').includes('Lucas'));
  const anyTamara = rBoth.some(r => (r.answerText ?? '').includes('Tamara'));
  ok('sin accountKey: aparecen firmas de ambas personas (reproduce el bug)',
     anyLucas && anyTamara);

  const rC2 = await recall('mercadolibre_cuenta2');
  ok('accountKey=cuenta2: recall aísla a las 3 Q&A de esa cuenta',
     rC2.length === 3, `got=${rC2.length}`);
  ok('accountKey=cuenta2: sólo firma "Tamara", NO "Lucas"',
     rC2.every(r => (r.answerText ?? '').includes('Tamara')) &&
     !rC2.some(r => (r.answerText ?? '').includes('Lucas')));

  const rC1 = await recall('mercadolibre');
  ok('accountKey=cuenta1: recall aísla a las 3 Q&A de esa cuenta',
     rC1.length === 3, `got=${rC1.length}`);
  ok('accountKey=cuenta1: sólo firma "Lucas", NO "Tamara"',
     rC1.every(r => (r.answerText ?? '').includes('Lucas')) &&
     !rC1.some(r => (r.answerText ?? '').includes('Tamara')));

  await prisma.mlPublicationKnowledge.deleteMany({ where: { itemId } });
  await prisma.$disconnect();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
