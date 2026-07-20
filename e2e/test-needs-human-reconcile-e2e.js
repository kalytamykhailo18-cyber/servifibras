// Marcos 2026-07-20 (hunt preventivo): la cola de Atención tenía 575
// conversaciones flagged needsHumanAttention=true; ~254 eran false-
// positives (staff ya había respondido, flag nunca se limpió por rows
// previas a los fixes de 07-15). Este test valida el reconciler:
//
//   (a) una conversación con último mensaje de staff DESPUÉS de
//       escalatedAt se limpia — es el caso stale que Brenda ve
//       inflado en el card
//   (b) una conversación con escalatedAt fresco y sin respuesta staff
//       NO se toca — es una escalación legítima que sigue pendiente
//   (c) una conversación sandbox NO se toca — el reconciler nunca
//       agrupa fixtures E2E con datos reales
//   (d) dry-run reporta lo mismo sin mutar
//
// Nuestro código nuevo:
//   - HumanHandoffService.reconcileStaleNeedsHumanAttention()
//   - HandoffReconcileCron (registered cron, no exercised here)

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { HumanHandoffService } = require('/home/servifibras/backend/dist/src/adapters/lead-detection/human-handoff.service');
  const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const handoff = app.get(HumanHandoffService);
  const prisma = new PrismaClient();

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  const stamp = Date.now();
  const label = `reconcile-e2e-${stamp}`;

  // Seed: real contact + sandbox contact
  const realContact = await prisma.contact.create({
    data: { name: `Real ${label}`, phone: `9990${stamp}`, isSandbox: false },
  });
  const sandboxContact = await prisma.contact.create({
    data: { name: `Sandbox ${label}`, phone: `9991${stamp}`, isSandbox: true },
  });

  const oneHourAgo = new Date(Date.now() - 60 * 60_000);
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
  const nowIsh = new Date();

  // (a) real + staff replied after escalatedAt → should clear
  const staleConv = await prisma.conversation.create({
    data: {
      contactId: realContact.id,
      channel: 'WHATSAPP',
      needsHumanAttention: true,
      status: 'WAITING',
      escalatedAt: oneHourAgo,
    },
  });
  await prisma.message.create({
    data: {
      conversationId: staleConv.id,
      sender: 'BRENDA',
      content: 'staff replied here — flag should clear',
      isFromAI: false,
      timestamp: fiveMinAgo,
    },
  });

  // (b) real + NO staff reply after escalatedAt → must NOT clear
  const legitConv = await prisma.conversation.create({
    data: {
      contactId: realContact.id,
      channel: 'WHATSAPP',
      needsHumanAttention: true,
      status: 'WAITING',
      escalatedAt: nowIsh,
    },
  });
  await prisma.message.create({
    data: {
      conversationId: legitConv.id,
      sender: 'CUSTOMER',
      content: 'customer asked something, no staff answer yet',
      isFromAI: false,
      timestamp: nowIsh,
    },
  });

  // (c) sandbox + staff replied → sandbox filter must skip it
  const sandboxConv = await prisma.conversation.create({
    data: {
      contactId: sandboxContact.id,
      channel: 'WHATSAPP',
      needsHumanAttention: true,
      status: 'WAITING',
      escalatedAt: oneHourAgo,
    },
  });
  await prisma.message.create({
    data: {
      conversationId: sandboxConv.id,
      sender: 'BRENDA',
      content: 'sandbox staff reply — must not be touched',
      isFromAI: false,
      timestamp: fiveMinAgo,
    },
  });

  // (d) real + AI message after escalatedAt (not staff) → must NOT clear
  //     AI-only doesn't count as "attended".
  const aiOnlyConv = await prisma.conversation.create({
    data: {
      contactId: realContact.id,
      channel: 'WHATSAPP',
      needsHumanAttention: true,
      status: 'WAITING',
      escalatedAt: oneHourAgo,
    },
  });
  await prisma.message.create({
    data: {
      conversationId: aiOnlyConv.id,
      sender: 'AI',
      content: 'AI-only reply, human still owes an answer',
      isFromAI: true,
      timestamp: fiveMinAgo,
    },
  });

  // Dry-run first
  const dry = await handoff.reconcileStaleNeedsHumanAttention({ dryRun: true });
  ok('dry-run cleared count = 0 (no mutation)', dry.cleared === 0, `cleared=${dry.cleared}`);
  ok('dry-run scanned at least the 3 real candidates', dry.scanned >= 3, `scanned=${dry.scanned}`);
  const dryCleared = new Set(dry.ids);
  ok('dry-run flags stale conv for clearance', dryCleared.has(staleConv.id));
  ok('dry-run does NOT flag legit-pending conv', !dryCleared.has(legitConv.id));
  ok('dry-run does NOT flag sandbox conv', !dryCleared.has(sandboxConv.id));
  ok('dry-run does NOT flag AI-only conv (AI ≠ staff)', !dryCleared.has(aiOnlyConv.id));

  const dryStale = await prisma.conversation.findUnique({ where: { id: staleConv.id }, select: { needsHumanAttention: true } });
  ok('dry-run did not mutate the DB', dryStale?.needsHumanAttention === true);

  // Real run
  const result = await handoff.reconcileStaleNeedsHumanAttention();
  const clearedNow = new Set(result.ids);
  ok('live run mutates the stale row', clearedNow.has(staleConv.id));
  ok('live run leaves legit-pending alone', !clearedNow.has(legitConv.id));
  ok('live run leaves sandbox alone', !clearedNow.has(sandboxConv.id));
  ok('live run leaves AI-only alone', !clearedNow.has(aiOnlyConv.id));

  const [staleAfter, legitAfter, sandboxAfter, aiOnlyAfter] = await Promise.all([
    prisma.conversation.findUnique({ where: { id: staleConv.id }, select: { needsHumanAttention: true, status: true } }),
    prisma.conversation.findUnique({ where: { id: legitConv.id }, select: { needsHumanAttention: true, status: true } }),
    prisma.conversation.findUnique({ where: { id: sandboxConv.id }, select: { needsHumanAttention: true, status: true } }),
    prisma.conversation.findUnique({ where: { id: aiOnlyConv.id }, select: { needsHumanAttention: true, status: true } }),
  ]);

  ok('stale row cleared: needsHumanAttention=false', staleAfter?.needsHumanAttention === false);
  ok('stale row cleared: status=ACTIVE', staleAfter?.status === 'ACTIVE');
  ok('legit-pending untouched: still needsHumanAttention=true', legitAfter?.needsHumanAttention === true);
  ok('sandbox untouched: still needsHumanAttention=true', sandboxAfter?.needsHumanAttention === true);
  ok('AI-only untouched: still needsHumanAttention=true', aiOnlyAfter?.needsHumanAttention === true);

  // Idempotency
  const second = await handoff.reconcileStaleNeedsHumanAttention();
  ok(
    'second run clears no new rows (idempotent)',
    !second.ids.includes(staleConv.id),
    `re-cleared=${second.cleared}`,
  );

  // Cleanup
  await prisma.message.deleteMany({ where: { conversationId: { in: [staleConv.id, legitConv.id, sandboxConv.id, aiOnlyConv.id] } } });
  await prisma.conversation.deleteMany({ where: { id: { in: [staleConv.id, legitConv.id, sandboxConv.id, aiOnlyConv.id] } } });
  await prisma.contact.deleteMany({ where: { id: { in: [realContact.id, sandboxContact.id] } } });

  await prisma.$disconnect();
  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
