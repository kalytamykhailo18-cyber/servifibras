// Marcos 2026-07-20: cuando el cliente cierra con "gracias" / "ok" /
// "👍" DESPUÉS de que el staff/AI ya le dio una respuesta sustantiva,
// la conversación tiene que cerrarse sola y salir de la cola de
// pendientes humanos. Marcos textual: "Si el cliente no preguntó
// nada más y su consulta fue resuelta y antes ya se lo había
// saludado se tiene que dar por finalizada la conversación".
//
// Este test valida el detector puro + el efecto en el handler.

const path = require('path');

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';
  process.env.HANDOFF_RECONCILE_ENABLED = 'false';

  const { isAcknowledgment, looksLikeUnresolvedFromStaff } = require(
    '/home/servifibras/backend/dist/src/adapters/conversations/acknowledgment-detector'
  );

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' - ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // (1) Detector positivo — patrones esperados
  const acks = [
    'gracias', 'Gracias', 'Muchas gracias', 'dale', 'listo', 'Listo!',
    'perfecto', 'Perfecto.', 'Barbaro', 'Bárbaro', 'ok', 'OK', 'okay',
    'okok', 'entendido', 'copiado', 'recibido', 'clarísimo', 'claro',
    'de acuerdo', 'exacto', 'ok gracias', 'dale gracias', 'listo gracias',
    'perfecto gracias', 'gracias che', 'Muchas gracias entonces',
    // Emoji-only
    '\u{1F44D}', '\u{1F44D}\u{1F44D}', '\u{1F64F}', '\u{2764}\u{FE0F}',
  ];
  for (const t of acks) {
    ok(`positive ack: "${t}"`, isAcknowledgment(t) === true);
  }

  // (2) Detector NEGATIVO — mensajes que NO son ack
  const nonAcks = [
    'Hola, tengo una consulta',
    'Cuánto sale la resina de 2kg?',
    'Ok pero cuándo llega?',                 // contiene "?"
    'listo entonces me mandan la cotización?', // pregunta
    'gracias por confirmar el precio del tanque de fibra grande', // > 40 chars
    'gracias, me confirmás?',                 // contiene "?"
    '',                                        // vacío
    null,                                      // nulo
    'aa',                                      // no matchea patterns
    'pregunto lo mismo',                       // frase distinta
  ];
  for (const t of nonAcks) {
    ok(`negative (NOT ack): "${t}"`, isAcknowledgment(t) === false);
  }

  // (3) looksLikeUnresolvedFromStaff — hint para saber si el turno
  // previo dejó una pregunta abierta.
  ok('staff question is unresolved', looksLikeUnresolvedFromStaff('Cuál es tu CP?') === true);
  ok('staff colon-ending is unresolved', looksLikeUnresolvedFromStaff('Necesito tu email:') === true);
  ok('staff declarative is resolved', looksLikeUnresolvedFromStaff('El envío sale $3.500 por Andreani.') === false);
  ok('staff greeting is resolved', looksLikeUnresolvedFromStaff('Buenísimo, cualquier cosa avisame.') === false);

  // (4) Env switch — desactivar el detector completo con ACK_ENABLED=false
  process.env.ACK_ENABLED = 'false';
  ok('ACK_ENABLED=false disables detector', isAcknowledgment('gracias') === false);
  delete process.env.ACK_ENABLED;
  ok('sin flag, ack vuelve a matchear', isAcknowledgment('gracias') === true);

  // (5) Env switch — ACK_MAX_CHARS
  process.env.ACK_MAX_CHARS = '5';
  ok('ACK_MAX_CHARS truncates longer text', isAcknowledgment('perfecto') === false);
  delete process.env.ACK_MAX_CHARS;
  ok('sin flag, "perfecto" vuelve a matchear', isAcknowledgment('perfecto') === true);

  // (6) Integración con el handler — un ack real dispara auto-close
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');
  const { getMessageCipher } = require('/home/servifibras/backend/dist/src/adapters/security/message-cipher');
  const { ConversationHandlerService } = require('/home/servifibras/backend/dist/src/adapters/conversations/conversation-handler.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const handler = app.get(ConversationHandlerService);
  const prisma = new PrismaClient();

  const stamp = Date.now();
  // La lookup del handler es por metadata.webchatCustomerId. Sin este
  // matching key, el handler crea un contacto NUEVO y nuestro conv
  // seed queda huérfano — el ack no encuentra historia previa y el
  // atajo no dispara. Ver findOrCreateWebchatContact.
  const webchatCustomerId1 = `webchat-ack-${stamp}`;
  const contact = await prisma.contact.create({
    data: {
      name: `Ack e2e ${stamp}`,
      phone: `9997${stamp}`,
      isSandbox: true,
      channel: 'TIENDANUBE_WEBCHAT',
      metadata: { webchatCustomerId: webchatCustomerId1, platform: 'tiendanube' },
    },
  });
  const conv = await prisma.conversation.create({
    data: {
      contactId: contact.id,
      channel: 'TIENDANUBE_WEBCHAT',
      isSandbox: true,
      status: 'WAITING',
      needsHumanAttention: true,
    },
  });
  // Prior turn: AI dio una respuesta declarativa (query resuelta)
  await prisma.message.create({
    data: {
      conversationId: conv.id,
      sender: 'AI',
      content: getMessageCipher().encrypt('El envío sale $3.500 por Andreani en 4 a 5 días hábiles.'),
      isFromAI: true,
      timestamp: new Date(Date.now() - 60_000),
    },
  });

  // Ejercer el handler con un mensaje-ack
  const webchatMsg = {
    text: 'ok gracias',
    customerId: webchatCustomerId1,
    customerName: `Ack e2e ${stamp}`,
    customerEmail: null,
    needsReply: () => true,
  };
  await handler.handleWebchatMessage(webchatMsg);

  const after = await prisma.conversation.findFirst({
    where: { contactId: contact.id },
    select: { id: true, status: true, needsHumanAttention: true, messages: { orderBy: { timestamp: 'desc' }, take: 1 } },
  });
  ok('auto-close: status = CLOSED', after?.status === 'CLOSED', `status=${after?.status}`);
  ok('auto-close: needsHumanAttention = false', after?.needsHumanAttention === false);
  const lastMsg = after?.messages?.[0];
  const decrypted = lastMsg ? getMessageCipher().decrypt(lastMsg.content) : '';
  ok('auto-close: last message is the AI farewell', decrypted.includes('cualquier cosa avisame'), `last="${decrypted}"`);

  // (7) NO se cierra si el turno previo del staff era una pregunta
  const webchatCustomerId2 = `webchat-noclose-${stamp}`;
  const contact2 = await prisma.contact.create({
    data: {
      name: `Ack e2e no-close ${stamp}`,
      phone: `9996${stamp}`,
      isSandbox: true,
      channel: 'TIENDANUBE_WEBCHAT',
      metadata: { webchatCustomerId: webchatCustomerId2, platform: 'tiendanube' },
    },
  });
  const conv2 = await prisma.conversation.create({
    data: {
      contactId: contact2.id,
      channel: 'TIENDANUBE_WEBCHAT',
      isSandbox: true,
      status: 'WAITING',
      needsHumanAttention: true,
    },
  });
  await prisma.message.create({
    data: {
      conversationId: conv2.id,
      sender: 'AI',
      content: getMessageCipher().encrypt('Cuál es tu código postal para cotizarte?'),
      isFromAI: true,
      timestamp: new Date(Date.now() - 60_000),
    },
  });
  const webchatMsg2 = {
    text: 'ok',
    customerId: webchatCustomerId2,
    customerName: `Ack e2e no-close ${stamp}`,
    customerEmail: null,
    needsReply: () => true,
  };
  // Nota: el handler puede seguir por el path del agente y cerrar por
  // otra ruta, pero el ATAJO de ack no debe dispararse porque el turno
  // previo era una pregunta. Comprobamos que NO se marcó CLOSED por
  // esta razón (permitimos WAITING o ACTIVE).
  await handler.handleWebchatMessage(webchatMsg2);
  const after2 = await prisma.conversation.findFirst({ where: { contactId: contact2.id }, select: { status: true } });
  ok('no auto-close when prior turn was a staff question', after2?.status !== 'CLOSED', `status=${after2?.status}`);

  // Cleanup
  await prisma.message.deleteMany({ where: { conversationId: { in: [conv.id, conv2.id] } } });
  await prisma.conversation.deleteMany({ where: { id: { in: [conv.id, conv2.id] } } });
  await prisma.contact.deleteMany({ where: { id: { in: [contact.id, contact2.id] } } });

  await prisma.$disconnect();
  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
