// B1 (documento de trabajo 2026-07-10): la memoria de correcciones
// tenía tres problemas confirmados:
//  1. Cupo por defecto CERO — la resta rulesCap = max(0, cap - style)
//     con defaults (8 - 16) daba 0, ninguna corrección entraba.
//  2. Retrieval por FECHA — ventana de 50 más recientes, corrección
//     vieja pero relevante quedaba afuera.
//  3. Consulta actual NO llegaba al selector — el buyerQuestion nunca
//     se pasaba, no había ranking por relevancia.
//
// Criterio de aceptación del documento:
//   1) Con configuración por defecto, entran correcciones (> 0).
//   2) Cargar 50 correcciones + preguntar algo que coincida con la
//      más antigua → esa se recupera.

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { ConversationStyleService } = require('/home/servifibras/backend/dist/src/adapters/ai/conversation-style.service');
  const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const style = app.get(ConversationStyleService);
  const prisma = new PrismaClient();

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  const stamp = Date.now();
  const TAG = `b1-test-${stamp}`;

  // 1) Insertar 50 correcciones sintéticas + 1 "gold" con un keyword
  //    específico que ningún ruido comparte.
  const goldQuestion = 'consulta sobre proporción exacta de resina y catalizador';
  const goldAnswer = 'La proporción exacta es 2:1 en peso.';
  await prisma.conversationExample.create({
    data: {
      scenario: 'correccion',
      title: `${TAG} GOLD proporcion catalizador`,
      priority: 250,
      active: true,
      turns: [
        { role: 'user', content: goldQuestion },
        { role: 'assistant', content: goldAnswer },
      ],
    },
  });
  for (let i = 0; i < 50; i++) {
    await prisma.conversationExample.create({
      data: {
        scenario: 'correccion',
        title: `${TAG} NOISE ${i} envio color pigmento`,
        priority: 200,
        active: true,
        turns: [
          { role: 'user', content: `pregunta ${i} sobre envío, color y pigmento` },
          { role: 'assistant', content: `respuesta genérica ${i}` },
        ],
      },
    });
  }
  console.log(`  → seeded 1 gold + 50 noise corrections tagged ${TAG}`);

  // 2) Verificar cupo por defecto > 0 (test criterion 1).
  //    Antes con defaults (maxExamples=8, styleReserve=16) → 0 corrections.
  //    Ahora con CONVERSATION_STYLE_MAX_CORRECTIONS default 8 → 8.
  delete process.env.CONVERSATION_STYLE_MAX_EXAMPLES;
  delete process.env.CONVERSATION_STYLE_MAX_STYLE_EXAMPLES;
  delete process.env.CONVERSATION_STYLE_MAX_CORRECTIONS;

  const noQueryExamples = await style.loadExamples(undefined, undefined);
  const rulesInNoQuery = noQueryExamples.filter((e) =>
    e.turns.some((t) => t.content.includes(TAG)) ||
    e.turns.some((t) => t.content.includes('proporción exacta')) ||
    e.turns.some((t) => t.content.includes(`pregunta ${0}`)) // just anything from our set
  );
  // The style pool + rules pool together should have some corrections.
  // We'll test the rules pool specifically by loading with a query.

  // 3) Preguntar algo semanticamente cercano al gold usando FTS.
  const paraphrase = 'cuánto de catalizador va por cada litro de resina';
  const relevantExamples = await style.loadExamples(undefined, undefined, paraphrase);

  ok(
    'with default env, retrieval returns some examples (was 0 before fix)',
    relevantExamples.length > 0,
    `got ${relevantExamples.length}`,
  );

  // The gold should appear in the result because its user turn contains
  // "resina" and "catalizador" — both stems in the paraphrase.
  const goldFound = relevantExamples.some((e) =>
    e.turns.some((t) => t.content === goldAnswer)
  );
  ok(
    'query-parafraseada recupera la corrección GOLD (contiene "resina" + "catalizador")',
    goldFound,
    goldFound ? 'found' : 'not found in top-N',
  );

  // Cleanup
  await prisma.conversationExample.deleteMany({
    where: { title: { contains: TAG } },
  });

  await prisma.$disconnect();
  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
