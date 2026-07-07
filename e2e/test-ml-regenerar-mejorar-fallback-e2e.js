// E2E: Regenerar / Mejorar con IA no fallan más con "Pregunta original
// no encontrada" cuando el CUSTOMER inbound no tiene mlQuestionId en
// metadata (Marcos 2026-07-06 — bug en la captura del panel ML).
//
// El fix agregó (a) stampeo de mlQuestionId en el customer inbound
// para nuevas ML questions y (b) fallback por proximidad temporal
// para filas históricas — buscar el CUSTOMER anterior más reciente
// al draft en la misma conversación cuando el path por metadata no
// matchea.

async function main() {
  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { MercadolibreQaService } = require('/home/servifibras/backend/dist/src/adapters/admin/mercadolibre-qa.service');
  const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const svc = app.get(MercadolibreQaService);
  const prisma = new PrismaClient();

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // Find an ML AI draft whose PAIRED customer message has metadata WITHOUT mlQuestionId.
  // Los "históricos" son exactamente ese caso — pre-fix el customer save
  // sólo stampeaba mlItemId.
  const candidate = await prisma.$queryRawUnsafe(`
    SELECT d.id AS draft_id, d."conversationId" AS conv_id, d.timestamp AS draft_ts
    FROM messages d
    JOIN conversations c ON c.id = d."conversationId"
    WHERE d."isFromAI" = true
      AND c.channel = 'MERCADOLIBRE'::"Channel"
      AND EXISTS (
        SELECT 1 FROM messages cu
        WHERE cu."conversationId" = d."conversationId"
          AND cu."isFromAI" = false
          AND cu.timestamp < d.timestamp
          AND (cu.metadata IS NULL OR NOT (cu.metadata ? 'mlQuestionId'))
      )
    ORDER BY d.timestamp DESC
    LIMIT 1
  `);

  ok('found an ML AI draft with a customer msg lacking mlQuestionId', candidate.length > 0);
  if (candidate.length === 0) {
    await prisma.$disconnect();
    await app.close();
    console.log(`\n=== ${pass} passed, ${fail} failed (nothing to test) ===`);
    process.exit(fail > 0 ? 1 : 0);
  }

  const draftId = candidate[0].draft_id;
  console.log(`  → target draft: ${draftId.slice(0, 12)}...`);

  // Improve
  const rImprove = await svc.improveOperatorDraft({ messageId: draftId, operatorText: 'test text' });
  console.log(`  → improveOperatorDraft returned: ok=${rImprove.ok} reason=${rImprove.reason ?? '(none)'}`);
  ok(
    'improveOperatorDraft: reason is NOT "Pregunta original no encontrada"',
    rImprove.reason !== 'Pregunta original no encontrada',
    `reason=${rImprove.reason ?? '(ok)'}`,
  );

  // Regenerate
  const rRegen = await svc.regenerateDraft(draftId);
  console.log(`  → regenerateDraft returned: ok=${rRegen.ok} reason=${rRegen.reason ?? '(none)'}`);
  ok(
    'regenerateDraft: reason is NOT "Pregunta original no encontrada"',
    rRegen.reason !== 'Pregunta original no encontrada',
    `reason=${rRegen.reason ?? '(ok)'}`,
  );

  await prisma.$disconnect();
  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
