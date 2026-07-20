// Marcos 2026-07-20: la fila del inbox mostraba la respuesta previa
// del Admin como "último mensaje" mientras el cliente ya había
// vuelto a escribir (visible en el screenshot con el 👍). Trace: de
// 14 call sites de saveMessage() en conversation-handler.service.ts,
// sólo 3 actualizaban conversation.lastMessage. El fix consolidó el
// bump en saveMessage() mismo — igual que el bump de lastMessageAt
// del 07-14. Este test valida:
//
//  (a) saveMessage con content actualiza lastMessage al content
//  (b) saveMessage con attachment sin caption actualiza al placeholder
//      (📷 Foto / 🎤 Audio / etc.)
//  (c) el bump ocurre para CUSTOMER, AI y ADMIN por igual (rechazamos
//      cualquier regresión donde el preview quede stale por rol)
//  (d) el bump de lastMessage es coherente con lastMessageAt (mismo
//      timestamp que el mensaje insertado)

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';
  process.env.HANDOFF_RECONCILE_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');
  const { getMessageCipher } = require('/home/servifibras/backend/dist/src/adapters/security/message-cipher');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = new PrismaClient();

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  const stamp = Date.now();
  const contact = await prisma.contact.create({
    data: { name: `LM preview ${stamp}`, phone: `9998${stamp}`, isSandbox: true },
  });
  const conv = await prisma.conversation.create({
    data: {
      contactId: contact.id,
      channel: 'WHATSAPP',
      isSandbox: true,
      lastMessage: getMessageCipher().encrypt('preview inicial que no debería sobrevivir a un save'),
      lastMessageAt: new Date(Date.now() - 60_000),
    },
  });

  // Ejercer el camino real: handleWhatsAppMessage triggers saveMessage
  // internamente. Como saveMessage es privado, alcanzamos el mismo
  // efecto usando el service instance y llamándolo vía bracket-access
  // (mismo pattern que test-a2 y test-c2).
  const { ConversationHandlerService } = require('/home/servifibras/backend/dist/src/adapters/conversations/conversation-handler.service');
  const handler = app.get(ConversationHandlerService);
  const saveMessage = handler['saveMessage'].bind(handler);

  // (a) CUSTOMER text message → preview must reflect that text
  await saveMessage(conv.id, 'CUSTOMER', 'nuevo mensaje del cliente 👍', false);
  const afterCustomer = await prisma.conversation.findUnique({
    where: { id: conv.id },
    select: { lastMessage: true, lastMessageAt: true },
  });
  const previewA = getMessageCipher().decrypt(afterCustomer?.lastMessage ?? '');
  ok('CUSTOMER text bumps lastMessage to that text', previewA === 'nuevo mensaje del cliente 👍', `preview="${previewA}"`);
  ok('CUSTOMER text bumps lastMessageAt to ~now', afterCustomer?.lastMessageAt && Math.abs(Date.now() - afterCustomer.lastMessageAt.getTime()) < 5000);

  // (b) AI reply → preview reflects the AI text (not the customer above)
  await saveMessage(conv.id, 'AI', 'respuesta del agente', true);
  const afterAi = await prisma.conversation.findUnique({
    where: { id: conv.id },
    select: { lastMessage: true },
  });
  const previewB = getMessageCipher().decrypt(afterAi?.lastMessage ?? '');
  ok('AI reply bumps lastMessage to AI text (not stale customer)', previewB === 'respuesta del agente', `preview="${previewB}"`);

  // (c) ADMIN reply → preview reflects admin text
  await saveMessage(conv.id, 'ADMIN', 'respuesta manual del staff', false);
  const afterAdmin = await prisma.conversation.findUnique({
    where: { id: conv.id },
    select: { lastMessage: true },
  });
  const previewC = getMessageCipher().decrypt(afterAdmin?.lastMessage ?? '');
  ok('ADMIN text bumps lastMessage to admin text', previewC === 'respuesta manual del staff', `preview="${previewC}"`);

  // (d) attachment without caption → preview is the emoji placeholder
  await saveMessage(conv.id, 'CUSTOMER', '', false, null, {
    url: 'https://example.com/x.jpg', name: 'x.jpg', mime: 'image/jpeg', size: 1024, contentType: 'IMAGE',
  });
  const afterMedia = await prisma.conversation.findUnique({
    where: { id: conv.id },
    select: { lastMessage: true },
  });
  const previewD = getMessageCipher().decrypt(afterMedia?.lastMessage ?? '');
  ok('IMAGE without caption → "📷 Foto" placeholder', previewD === '📷 Foto', `preview="${previewD}"`);

  await saveMessage(conv.id, 'CUSTOMER', '', false, null, {
    url: 'https://example.com/x.mp3', name: 'x.mp3', mime: 'audio/mpeg', size: 1024, contentType: 'VOICE',
  });
  const afterVoice = await prisma.conversation.findUnique({
    where: { id: conv.id },
    select: { lastMessage: true },
  });
  ok('VOICE without caption → "🎤 Audio" placeholder', getMessageCipher().decrypt(afterVoice?.lastMessage ?? '') === '🎤 Audio');

  // (e) sequential bump — the LAST saveMessage always wins (not any prior)
  await saveMessage(conv.id, 'CUSTOMER', 'primer mensaje', false);
  await saveMessage(conv.id, 'CUSTOMER', 'último mensaje', false);
  const afterSeq = await prisma.conversation.findUnique({
    where: { id: conv.id },
    select: { lastMessage: true },
  });
  ok('sequential saves — the last one wins the preview', getMessageCipher().decrypt(afterSeq?.lastMessage ?? '') === 'último mensaje');

  // Cleanup
  await prisma.message.deleteMany({ where: { conversationId: conv.id } });
  await prisma.conversation.delete({ where: { id: conv.id } });
  await prisma.contact.delete({ where: { id: contact.id } });

  await prisma.$disconnect();
  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
