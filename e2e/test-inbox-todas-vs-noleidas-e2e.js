// Marcos 2026-07-24: "no hay diferencias entre todas y no leídas,
// todo figura igual". Root cause: la orderBy priorizaba
// needsHumanAttention DESC, así el fetch inicial (500 rows) traía
// TODAS las pendientes primero — como pending queue es 328, Todas
// se llenaba con 40 rows todas pendientes y quedaba idéntica a
// No leídas. Fix: orderBy puro por lastMessageAt DESC. Todas
// muestra mix real (pendientes + resueltas por recencia).
// No leídas sigue filtrando en el where.
//
// El test seed: 1 pendiente con lastMessageAt=viejo + 2 no-pendientes
// con lastMessageAt=nuevas → Todas devuelve las 2 nuevas primero;
// No leídas devuelve sólo la pendiente vieja.

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';
  process.env.HANDOFF_RECONCILE_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { ConversationManagementService } = require('/home/servifibras/backend/dist/src/adapters/admin/conversation-management.service');
  const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');
  const { getMessageCipher } = require('/home/servifibras/backend/dist/src/adapters/security/message-cipher');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const svc = app.get(ConversationManagementService);
  const prisma = new PrismaClient();

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' - ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  const stamp = Date.now();
  const marcos = await prisma.user.findFirst({ where: { email: 'marcos@servifibras.com' } });
  const scope = { userId: marcos?.id ?? 'x', role: 'ADMIN' };

  const contact = await prisma.contact.create({
    data: { name: `T-vs-NL ${stamp}`, phone: `9989${stamp}`, isSandbox: false },
  });

  // Seed: 1 pendiente vieja + 2 non-pendientes nuevas
  const oldPending = await prisma.conversation.create({
    data: {
      contactId: contact.id,
      channel: 'WHATSAPP',
      isSandbox: false,
      needsHumanAttention: true,
      status: 'WAITING',
      lastMessageAt: new Date(Date.now() - 6 * 60 * 60 * 1000), // 6h ago
    },
  });
  await prisma.message.create({
    data: { conversationId: oldPending.id, sender: 'CUSTOMER', content: getMessageCipher().encrypt('pendiente vieja'), isFromAI: false, timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000) },
  });
  const newResolvedA = await prisma.conversation.create({
    data: {
      contactId: contact.id,
      channel: 'WHATSAPP',
      isSandbox: false,
      needsHumanAttention: false,
      status: 'ACTIVE',
      lastMessageAt: new Date(),
    },
  });
  await prisma.message.create({
    data: { conversationId: newResolvedA.id, sender: 'BRENDA', content: getMessageCipher().encrypt('nueva A staff'), isFromAI: false, timestamp: new Date() },
  });
  const newResolvedB = await prisma.conversation.create({
    data: {
      contactId: contact.id,
      channel: 'WHATSAPP',
      isSandbox: false,
      needsHumanAttention: false,
      status: 'ACTIVE',
      lastMessageAt: new Date(Date.now() - 30_000), // 30s ago
    },
  });
  await prisma.message.create({
    data: { conversationId: newResolvedB.id, sender: 'BRENDA', content: getMessageCipher().encrypt('nueva B staff'), isFromAI: false, timestamp: new Date(Date.now() - 30_000) },
  });

  // (1) Todas — sin filtro
  const todas = await svc.listConversations({ scope, limit: 40, offset: 0 });
  const idxNewA = todas.conversations.findIndex((c) => c.id === newResolvedA.id);
  const idxNewB = todas.conversations.findIndex((c) => c.id === newResolvedB.id);
  const idxOld  = todas.conversations.findIndex((c) => c.id === oldPending.id);
  ok('Todas incluye la resuelta más nueva', idxNewA >= 0, `idxNewA=${idxNewA}`);
  ok('Todas incluye también la resuelta de 30s', idxNewB >= 0, `idxNewB=${idxNewB}`);
  // newA (ahora) > newB (30s atrás) > oldPending (6h atrás) por recency
  ok('orden: newA antes que newB (más reciente arriba)', idxNewA >= 0 && idxNewB >= 0 && idxNewA < idxNewB);
  // oldPending puede no estar en top 40 (perfecto — no domina la vista).
  // Si aparece, tiene que ir DESPUÉS de las news.
  ok('orden: newB antes que oldPending (o oldPending fuera de top 40)', idxOld === -1 || (idxNewB >= 0 && idxNewB < idxOld));
  ok('la pendiente vieja NO tapa a las resueltas nuevas', idxOld === -1 || idxNewA < idxOld);

  // (2) No leídas — sólo pendientes
  const noLeidas = await svc.listConversations({ scope, limit: 40, offset: 0, needsHumanAttention: true });
  const idxOldInNL = noLeidas.conversations.findIndex((c) => c.id === oldPending.id);
  const idxNewAInNL = noLeidas.conversations.findIndex((c) => c.id === newResolvedA.id);
  ok('No leídas incluye la pendiente', idxOldInNL >= 0, `idx=${idxOldInNL}`);
  ok('No leídas NO incluye las resueltas', idxNewAInNL === -1);

  // (3) Contenidos distintos
  const setTodas = new Set(todas.conversations.map((c) => c.id));
  const setNoLeidas = new Set(noLeidas.conversations.map((c) => c.id));
  const diff = [...setTodas].filter((id) => !setNoLeidas.has(id));
  ok('Todas y No leídas tienen contenidos distintos (mix diferente)', diff.length > 0, `diff.size=${diff.length}`);

  // Cleanup
  await prisma.message.deleteMany({ where: { conversationId: { in: [oldPending.id, newResolvedA.id, newResolvedB.id] } } });
  await prisma.conversation.deleteMany({ where: { id: { in: [oldPending.id, newResolvedA.id, newResolvedB.id] } } });
  await prisma.contact.delete({ where: { id: contact.id } });

  await prisma.$disconnect();
  await app.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
