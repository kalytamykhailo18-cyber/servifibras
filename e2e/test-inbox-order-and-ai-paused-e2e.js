// Marcos 2026-07-22 (dos incidentes serios reportados 09:46 y 10:21):
//
// (A) La sort "oldest-first dentro de pendientes" que yo shipeé el
//     07-21 tapaba el inbox con 214 rows huérfanas de 7-30 días. Marcos
//     veía "hace 13 días" en toda la página 1. Fix: dentro del bucket
//     de pendientes, ordenamos por lastMessageAt DESC (recientes
//     primero) igual que en el bucket resuelto. Los zombies caen a la
//     cola donde no molestan.
//
// (B) El auto-close por ack disparaba el "Bárbaro, cualquier cosa
//     avisame" del agente incluso cuando el operador había pausado la
//     IA en esa conversación. Marcos: "la IA se está activando sola
//     de forma aleatoria en conversaciones de whatsapp". Fix: la guarda
//     aiPaused corre antes del Claude confirm. El reconciler hourly
//     también respeta la guarda.
//
// El test cubre ambos casos con seeds controladas + assertions duras.

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';
  process.env.HANDOFF_RECONCILE_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { ConversationManagementService } = require('/home/servifibras/backend/dist/src/adapters/admin/conversation-management.service');
  const { ConversationHandlerService } = require('/home/servifibras/backend/dist/src/adapters/conversations/conversation-handler.service');
  const { HumanHandoffService } = require('/home/servifibras/backend/dist/src/adapters/lead-detection/human-handoff.service');
  const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');
  const { getMessageCipher } = require('/home/servifibras/backend/dist/src/adapters/security/message-cipher');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const listSvc = app.get(ConversationManagementService);
  const handler = app.get(ConversationHandlerService);
  const handoff = app.get(HumanHandoffService);
  const prisma = new PrismaClient();

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' - ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  const stamp = Date.now();
  const marcos = await prisma.user.findFirst({ where: { email: 'marcos@servifibras.com' } });
  const scope = { userId: marcos?.id ?? 'x', role: 'ADMIN' };

  // ─── Bug A — ordering ───────────────────────────────────────────
  // Seed: contact + 2 pending convs. One with lastMessageAt = 30 days
  // ago (zombie), other with lastMessageAt = NOW. Both flagged pending.
  // La nueva sort tiene que poner la de NOW arriba de la de 30-días.
  const contactA = await prisma.contact.create({
    data: { name: `Order test ${stamp}`, phone: `9993${stamp}`, isSandbox: false },
  });
  const zombie = await prisma.conversation.create({
    data: {
      contactId: contactA.id,
      channel: 'WHATSAPP',
      isSandbox: false,
      needsHumanAttention: true,
      status: 'WAITING',
      lastMessageAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.message.create({
    data: {
      conversationId: zombie.id,
      sender: 'CUSTOMER',
      content: getMessageCipher().encrypt('mensaje zombie de hace 30 dias'),
      isFromAI: false,
      timestamp: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
  });
  const fresh = await prisma.conversation.create({
    data: {
      contactId: contactA.id,
      channel: 'WHATSAPP',
      isSandbox: false,
      needsHumanAttention: true,
      status: 'WAITING',
      lastMessageAt: new Date(),
    },
  });
  await prisma.message.create({
    data: {
      conversationId: fresh.id,
      sender: 'CUSTOMER',
      content: getMessageCipher().encrypt('mensaje de ahora mismo'),
      isFromAI: false,
      timestamp: new Date(),
    },
  });

  const listed = await listSvc.listConversations({ scope, limit: 500, offset: 0 });
  const ids = listed.conversations.map((c) => c.id);
  const idxFresh = ids.indexOf(fresh.id);
  const idxZombie = ids.indexOf(zombie.id);
  ok('fresh pending conv appears in the list', idxFresh >= 0, `idx=${idxFresh}`);
  ok('zombie pending conv appears in the list', idxZombie >= 0, `idx=${idxZombie}`);
  ok('fresh appears BEFORE zombie (newest-first within pending)', idxFresh >= 0 && idxZombie >= 0 && idxFresh < idxZombie);

  // Un no-pendiente recientísimo debe seguir estando debajo de los
  // pendientes (bucket priority se mantiene, sólo cambia el orden
  // interno). Seed uno.
  const nonPend = await prisma.conversation.create({
    data: {
      contactId: contactA.id,
      channel: 'WHATSAPP',
      isSandbox: false,
      needsHumanAttention: false,
      status: 'ACTIVE',
      lastMessageAt: new Date(Date.now() + 5000), // 5s in the future — más nuevo que 'fresh'
    },
  });
  await prisma.message.create({
    data: {
      conversationId: nonPend.id,
      sender: 'BRENDA',
      content: getMessageCipher().encrypt('respuesta staff — no pendiente'),
      isFromAI: false,
      timestamp: new Date(Date.now() + 5000),
    },
  });
  const listed2 = await listSvc.listConversations({ scope, limit: 500, offset: 0 });
  const ids2 = listed2.conversations.map((c) => c.id);
  const idxNonPend = ids2.indexOf(nonPend.id);
  const idxFresh2 = ids2.indexOf(fresh.id);
  ok(
    'pending bucket still comes first (non-pendiente aunque más nuevo va después)',
    idxNonPend >= 0 && idxFresh2 >= 0 && idxFresh2 < idxNonPend,
    `fresh=${idxFresh2} nonPend=${idxNonPend}`,
  );

  // ─── Bug B — auto-close respects aiPaused ──────────────────────
  const contactB = await prisma.contact.create({
    data: { name: `AI paused test ${stamp}`, phone: `9992${stamp}`, isSandbox: false, metadata: { webchatCustomerId: `wc-paused-${stamp}`, platform: 'tiendanube' } },
  });
  const pausedConv = await prisma.conversation.create({
    data: {
      contactId: contactB.id,
      channel: 'TIENDANUBE_WEBCHAT',
      isSandbox: false,
      status: 'WAITING',
      needsHumanAttention: true,
      aiPaused: true, // <-- operador puso el kill-switch
    },
  });
  // Turno previo: staff dió una respuesta declarativa (no pregunta).
  await prisma.message.create({
    data: {
      conversationId: pausedConv.id,
      sender: 'AI',
      content: getMessageCipher().encrypt('El envío sale $3500 por Andreani en 4 a 5 días hábiles.'),
      isFromAI: true,
      timestamp: new Date(Date.now() - 60_000),
    },
  });
  // Cliente cierra con "gracias" — sin la guarda aiPaused esto
  // dispararía auto-close + "Bárbaro..." de la IA.
  await handler.handleWebchatMessage({
    text: 'gracias',
    customerId: `wc-paused-${stamp}`,
    customerName: `AI paused test ${stamp}`,
    customerEmail: null,
    needsReply: () => true,
  });
  const after = await prisma.conversation.findFirst({
    where: { contactId: contactB.id },
    select: { id: true, status: true, aiPaused: true, messages: { orderBy: { timestamp: 'desc' }, take: 1 } },
  });
  ok('aiPaused conversation NOT auto-closed', after?.status !== 'CLOSED', `status=${after?.status}`);
  const lastMsg = after?.messages?.[0];
  const lastText = lastMsg ? getMessageCipher().decrypt(lastMsg.content ?? '') : '';
  ok('AI did NOT send the farewell on aiPaused conv', !lastText.includes('cualquier cosa avisame'), `last="${lastText.slice(0, 60)}"`);

  // Reconciler-on-ack también respeta aiPaused
  const scan = await handoff.reconcileStuckOnAck({ dryRun: true });
  ok('reconciler dry-run does NOT include the aiPaused conv', !scan.ids.includes(pausedConv.id));

  // Sanity: sobre una conv sin aiPaused y con ack, sí cierra (control)
  const contactC = await prisma.contact.create({
    data: { name: `Control paused ${stamp}`, phone: `9991${stamp}`, isSandbox: false, metadata: { webchatCustomerId: `wc-ctrl-${stamp}`, platform: 'tiendanube' } },
  });
  const ctrlConv = await prisma.conversation.create({
    data: {
      contactId: contactC.id,
      channel: 'TIENDANUBE_WEBCHAT',
      isSandbox: false,
      status: 'WAITING',
      needsHumanAttention: true,
      aiPaused: false,
    },
  });
  await prisma.message.create({
    data: {
      conversationId: ctrlConv.id,
      sender: 'AI',
      content: getMessageCipher().encrypt('El envío sale $3500 por Andreani en 4 a 5 días hábiles.'),
      isFromAI: true,
      timestamp: new Date(Date.now() - 60_000),
    },
  });
  await handler.handleWebchatMessage({
    text: 'gracias',
    customerId: `wc-ctrl-${stamp}`,
    customerName: `Control paused ${stamp}`,
    customerEmail: null,
    needsReply: () => true,
  });
  const ctrlAfter = await prisma.conversation.findFirst({
    where: { contactId: contactC.id },
    select: { status: true, messages: { orderBy: { timestamp: 'desc' }, take: 1 } },
  });
  const ctrlLast = ctrlAfter?.messages?.[0] ? getMessageCipher().decrypt(ctrlAfter.messages[0].content ?? '') : '';
  ok('control (aiPaused=false, real ack) DID auto-close', ctrlAfter?.status === 'CLOSED', `status=${ctrlAfter?.status}`);
  ok('control (aiPaused=false) received AI farewell', ctrlLast.includes('cualquier cosa avisame'), `last="${ctrlLast.slice(0, 60)}"`);

  // Cleanup
  const allSeedIds = [zombie.id, fresh.id, nonPend.id, pausedConv.id, ctrlConv.id];
  await prisma.message.deleteMany({ where: { conversationId: { in: allSeedIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: allSeedIds } } });
  await prisma.contact.deleteMany({ where: { id: { in: [contactA.id, contactB.id, contactC.id] } } });

  await prisma.$disconnect();
  await app.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
