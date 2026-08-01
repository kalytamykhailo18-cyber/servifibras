// Marcos 2026-07-31 (WhatsApp AM): "el agente en ML no aprende en la
// primer pregunta, demora 3-4 preguntas similares antes de asimilar la
// información". Root cause: tryConstrainedReply exige >= 3 filas
// curadas (ML_CONSTRAINED_MIN_CURATED) por publicación antes de usar
// modo cerrado — hasta ahí las respuestas salen por el pipeline
// genérico, sin la info específica del item.
//
// Fix: cuando el top row del recall léxico ya matchea la pregunta
// actual, bajamos el umbral a ML_CONSTRAINED_MIN_CURATED_WHEN_MATCH
// (default 1). Preservamos el 3 para preguntas nuevas sin match
// (evita que una Q&A no relacionada dispare respuestas incorrectas).
//
// Test estrategia: seteamos CLAUDE_API_KEY vacío para que
// tryConstrainedReply short-circuit en el chequeo de API key —
// después del threshold pero antes de gastar tokens. Distinguimos
// PASSED vs BLOCKED comparando `reason`:
//   - "no API key"        → pasó el umbral (fix works)
//   - "curated=X < min=Y" → bloqueado por umbral (fix would NOT fire)

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';
  process.env.HANDOFF_RECONCILE_ENABLED = 'false';
  process.env.ML_CONSTRAINED_REPLY_ENABLED = 'true';
  // Guardamos y borramos la API key para forzar el short-circuit
  // post-threshold. La restauramos al final.
  const savedClaudeKey = process.env.CLAUDE_API_KEY;
  const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.CLAUDE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { MlPublicationKnowledgeService } = require('/home/servifibras/backend/dist/src/adapters/admin/ml-publication-knowledge.service');
  const { PrismaClient } = require(path.join('/home/servifibras/backend/node_modules/@prisma/client'));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const svc = app.get(MlPublicationKnowledgeService);
  const prisma = new PrismaClient();

  const suffix = String(process.pid);
  const itemEmpty     = `MLA-TEST-empty-${suffix}`;
  const itemOneMatch  = `MLA-TEST-1match-${suffix}`;
  const itemOneNoMatch = `MLA-TEST-1nomatch-${suffix}`;
  const itemThreeNoMatch = `MLA-TEST-3nomatch-${suffix}`;
  const itemOneMatchStrict = `MLA-TEST-1match-strict-${suffix}`;

  // Cleanup previos
  await prisma.mlPublicationKnowledge.deleteMany({
    where: { itemId: { in: [itemEmpty, itemOneMatch, itemOneNoMatch, itemThreeNoMatch, itemOneMatchStrict] } },
  });

  const seed = async (itemId, rows) => {
    for (const r of rows) {
      await prisma.mlPublicationKnowledge.create({
        data: {
          itemId,
          accountKey: 'mercadolibre',
          mlQuestionId: `${itemId}-${r.qid}`,
          questionText: r.q,
          answerText: r.a,
          questionAt: new Date(),
          answeredAt: new Date(),
          curationStatus: 'kept',
        },
      });
    }
  };

  await seed(itemOneMatch, [
    { qid: 1, q: '¿Sirve para pintar madera al aire libre?', a: 'Sí, aplica en exteriores con acabado uretánico.' },
  ]);
  await seed(itemOneNoMatch, [
    { qid: 1, q: '¿Se puede combinar con pigmento pastel?', a: 'Sí, cargá hasta 10% del volumen.' },
  ]);
  await seed(itemThreeNoMatch, [
    { qid: 1, q: '¿Se puede combinar con pigmento pastel?', a: 'Sí, cargá hasta 10% del volumen.' },
    { qid: 2, q: '¿Tiene descuento por bulto?', a: 'A partir de 6 unidades.' },
    { qid: 3, q: '¿Envían al interior?', a: 'Sí, por transporte a cargo del comprador.' },
  ]);
  await seed(itemOneMatchStrict, [
    { qid: 1, q: '¿Sirve para pintar madera al aire libre?', a: 'Sí, aplica en exteriores con acabado uretánico.' },
  ]);

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // (1) 0 curated → blocked by classic threshold (min=3)
  const r0 = await svc.tryConstrainedReply({
    itemId: itemEmpty, buyerQuestion: '¿sirve para madera afuera?',
  });
  ok(
    'sin curadas → blocked with min=3',
    r0.usedConstrained === false && /curated=0 < min=3/.test(r0.reason ?? ''),
    `reason=${r0.reason}`,
  );

  // (2) 1 curated MATCHING → fix: passed threshold. Reason CAN be
  // 'no API key' or any later short-circuit ('no listing context',
  // etc.); what matters is it's NOT a "curated=X < min=Y" block.
  const passedThreshold = (r) => !/curated=\d+ < min=\d+/.test(r?.reason ?? '');
  const r1m = await svc.tryConstrainedReply({
    itemId: itemOneMatch, buyerQuestion: '¿esto sirve para madera al aire libre?',
  });
  ok(
    '1 curada + match léxico → passed threshold (uses topHasMatch shortcut)',
    passedThreshold(r1m),
    `reason=${r1m.reason}`,
  );

  // (3) 1 curated NOT matching → still blocked by classic threshold
  const r1n = await svc.tryConstrainedReply({
    itemId: itemOneNoMatch, buyerQuestion: '¿cuánto tarda el envío hasta Córdoba?',
  });
  ok(
    '1 curada sin match → still blocked by min=3 (anti-hallucination safety)',
    r1n.usedConstrained === false && /curated=1 < min=3/.test(r1n.reason ?? ''),
    `reason=${r1n.reason}`,
  );

  // (4) 3 curated NOT matching → passed threshold via classic path
  const r3n = await svc.tryConstrainedReply({
    itemId: itemThreeNoMatch, buyerQuestion: '¿esta resina se usa para arte fluido?',
  });
  ok(
    '3 curadas (sin match) → passed threshold vía path clásico',
    passedThreshold(r3n),
    `reason=${r3n.reason}`,
  );

  // (5) env override: subir MIN_CURATED_WHEN_MATCH a 2 desactiva el shortcut
  process.env.ML_CONSTRAINED_MIN_CURATED_WHEN_MATCH = '2';
  const rStrict = await svc.tryConstrainedReply({
    itemId: itemOneMatchStrict, buyerQuestion: '¿esto sirve para madera al aire libre?',
  });
  ok(
    'env ML_CONSTRAINED_MIN_CURATED_WHEN_MATCH=2 → 1 curada + match bloqueada',
    rStrict.usedConstrained === false && /curated=1 < min=2/.test(rStrict.reason ?? ''),
    `reason=${rStrict.reason}`,
  );
  delete process.env.ML_CONSTRAINED_MIN_CURATED_WHEN_MATCH;

  // Cleanup
  await prisma.mlPublicationKnowledge.deleteMany({
    where: { itemId: { in: [itemEmpty, itemOneMatch, itemOneNoMatch, itemThreeNoMatch, itemOneMatchStrict] } },
  });
  await prisma.$disconnect();

  // Restore keys
  if (savedClaudeKey !== undefined) process.env.CLAUDE_API_KEY = savedClaudeKey;
  if (savedAnthropicKey !== undefined) process.env.ANTHROPIC_API_KEY = savedAnthropicKey;

  await app.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
