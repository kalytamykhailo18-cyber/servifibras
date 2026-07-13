// B2 (documento de trabajo 2026-07-10): el historial de MercadoLibre
// que se pasa al agente tiene que estar filtrado por publicación —
// preguntas del mismo comprador sobre publicaciones distintas no
// pueden contaminarse entre sí.
//
// Criterio de aceptación del documento:
//   "Test con dos publicaciones distintas del mismo comprador: la
//    respuesta a la publicación B no menciona ni usa datos de la
//    publicación A."
//
// Este test valida directamente la fuente del problema — el fetch de
// historial en getConversationHistoryById debe devolver SOLO los
// mensajes que llevan `metadata.mlItemId` igual al itemId pedido.

async function main() {
  // Marcos 2026-07-13: fuerzo WHATSAPP_QR_ENABLED=false ANTES de cargar
  // AppModule para que el AppContext del test NO abra una sesión Baileys
  // paralela contra WhatsApp — hacerlo produce un stream:conflict que
  // tira la sesión de producción por varios segundos (o horas, si el
  // test cuelga). Es el mismo patrón que ya nos mordió el 2026-07-08.
  process.env.WHATSAPP_QR_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { ConversationHandlerService } = require('/home/servifibras/backend/dist/src/adapters/conversations/conversation-handler.service');
  const { PrismaClient, Channel, MessageSender, ConversationStatus, ContactType } = require('/home/servifibras/backend/node_modules/@prisma/client');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const handler = app.get(ConversationHandlerService);
  const prisma = new PrismaClient();

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // Set up a sandboxed test contact + ML conversation with mixed itemIds.
  const stamp = Date.now();
  const contact = await prisma.contact.create({
    data: {
      name: `B2 Test Buyer ${stamp}`,
      phone: `b2-${stamp}`,
      channel: Channel.MERCADOLIBRE,
      type: ContactType.MINORISTA,
      isSandbox: true,
    },
  });
  const conv = await prisma.conversation.create({
    data: {
      contactId: contact.id,
      channel: Channel.MERCADOLIBRE,
      status: ConversationStatus.ACTIVE,
      isSandbox: true,
    },
  });
  const ITEM_A = `MLA${stamp}A`;
  const ITEM_B = `MLA${stamp}B`;
  // Interleave: 3 msgs for A, 3 for B, chronologically alternating.
  const seed = [
    { itemId: ITEM_A, text: 'A1 pregunta',   sender: MessageSender.CUSTOMER, isFromAI: false, offset: 60 },
    { itemId: ITEM_A, text: 'A1 respuesta',  sender: MessageSender.AI,       isFromAI: true,  offset: 55 },
    { itemId: ITEM_B, text: 'B1 pregunta',   sender: MessageSender.CUSTOMER, isFromAI: false, offset: 45 },
    { itemId: ITEM_B, text: 'B1 respuesta',  sender: MessageSender.AI,       isFromAI: true,  offset: 40 },
    { itemId: ITEM_A, text: 'A2 pregunta',   sender: MessageSender.CUSTOMER, isFromAI: false, offset: 30 },
    { itemId: ITEM_A, text: 'A2 respuesta',  sender: MessageSender.AI,       isFromAI: true,  offset: 25 },
    { itemId: ITEM_B, text: 'B2 pregunta',   sender: MessageSender.CUSTOMER, isFromAI: false, offset: 15 },
    { itemId: ITEM_B, text: 'B2 respuesta',  sender: MessageSender.AI,       isFromAI: true,  offset: 10 },
  ];
  for (const s of seed) {
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        sender: s.sender,
        isFromAI: s.isFromAI,
        content: s.text,
        metadata: { mlItemId: s.itemId },
        timestamp: new Date(Date.now() - s.offset * 60_000),
      },
    });
  }
  console.log(`  → seeded conv=${conv.id.slice(0, 12)}... with 4 msgs on ${ITEM_A} + 4 msgs on ${ITEM_B}`);

  // The B2 change added an optional `opts.mlItemId` filter. When passed,
  // history should include ONLY messages tagged with that mlItemId.
  const call = handler['getConversationHistoryById'].bind(handler);

  const historyA = await call(contact.id, Channel.MERCADOLIBRE, 20, { mlItemId: ITEM_A });
  const historyB = await call(contact.id, Channel.MERCADOLIBRE, 20, { mlItemId: ITEM_B });

  ok(
    'historyA has 4 messages (A1..A2 both turns)',
    historyA.length === 4,
    `got ${historyA.length}`,
  );
  ok(
    'historyA contains ONLY ITEM_A content',
    historyA.every((m) => (m.metadata?.mlItemId ?? null) === ITEM_A),
    historyA.map((m) => m.metadata?.mlItemId).join(','),
  );
  ok(
    'historyA does NOT contain any B content',
    !historyA.some((m) => String(m.content ?? '').startsWith('B')),
  );

  ok(
    'historyB has 4 messages',
    historyB.length === 4,
    `got ${historyB.length}`,
  );
  ok(
    'historyB contains ONLY ITEM_B content',
    historyB.every((m) => (m.metadata?.mlItemId ?? null) === ITEM_B),
  );
  ok(
    'historyB does NOT contain any A content',
    !historyB.some((m) => String(m.content ?? '').startsWith('A')),
  );

  // Sanity: without the filter, we still get everything (backwards compat).
  const historyMixed = await call(contact.id, Channel.MERCADOLIBRE, 20);
  ok(
    'unfiltered call returns full mixed history (backwards compat)',
    historyMixed.length === 8,
    `got ${historyMixed.length}`,
  );

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
