// Marcos 2026-07-31 (screenshot 7:56 AM AR): en el inbox de WhatsApp
// todos los contactos mostraban "54" como avatar porque el nombre se
// creaba con el phone crudo y nunca se actualizaba. Baileys manda
// `pushName` (el "Mi nombre" del cliente en su WhatsApp) en cada
// mensaje + `sock.profilePictureUrl(jid)` devuelve la foto. Este test
// valida que:
//   1. Nuevo contacto entra con pushName como name + avatarUrl seteado.
//   2. Contacto existente con name===phone (placeholder legacy) se
//      actualiza al primer mensaje que traiga pushName.
//   3. Contacto con name renombrado a mano por el operador NO se pisa.
//   4. avatarUrl se refresca cuando cambia (cliente actualizó su foto).

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';
  process.env.HANDOFF_RECONCILE_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { ConversationHandlerService } = require('/home/servifibras/backend/dist/src/adapters/conversations/conversation-handler.service');
  const { WhatsAppIncomingMessage, WhatsAppMessageType } = require('/home/servifibras/backend/dist/src/domain/entities/whatsapp-message.entity');
  const { PrismaClient } = require(path.join('/home/servifibras/backend/node_modules/@prisma/client'));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const handler = app.get(ConversationHandlerService);
  const prisma = new PrismaClient();

  const suffix = String(process.pid).padStart(6, '0');
  const phoneA = `5491999${suffix}`; // brand new contact
  const phoneB = `5492999${suffix}`; // existing placeholder contact
  const phoneC = `5493999${suffix}`; // manually renamed contact
  const phoneD = `5494999${suffix}`; // avatar refresh case

  await prisma.contact.deleteMany({ where: { phone: { in: [phoneA, phoneB, phoneC, phoneD] } } });

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // (1) Fresh contact with pushName + avatarUrl
  const inA = new WhatsAppIncomingMessage(
    `test-a-${Date.now()}`, phoneA, new Date(), WhatsAppMessageType.TEXT,
    'Hola quiero consultar precios', null, null,
    `${phoneA}@s.whatsapp.net`, null,
    'Juan Pérez', 'https://pps.whatsapp.net/v/example-A.jpg',
  );
  await handler.handleWhatsAppMessage(inA);
  const cA = await prisma.contact.findUnique({ where: { phone: phoneA } });
  ok('fresh contact stores pushName as name', cA?.name === 'Juan Pérez', `name=${cA?.name}`);
  ok('fresh contact stores avatarUrl', cA?.avatarUrl === 'https://pps.whatsapp.net/v/example-A.jpg', `avatarUrl=${cA?.avatarUrl}`);

  // (2) Existing placeholder contact (name === phone) — updated on next msg
  await prisma.contact.create({ data: { phone: phoneB, name: phoneB, channel: 'WHATSAPP' } });
  const inB = new WhatsAppIncomingMessage(
    `test-b-${Date.now()}`, phoneB, new Date(), WhatsAppMessageType.TEXT,
    'Buen día, consulta', null, null,
    `${phoneB}@s.whatsapp.net`, null,
    'María López', 'https://pps.whatsapp.net/v/example-B.jpg',
  );
  await handler.handleWhatsAppMessage(inB);
  const cB = await prisma.contact.findUnique({ where: { phone: phoneB } });
  ok('placeholder-name contact upgraded to pushName', cB?.name === 'María López', `name=${cB?.name}`);
  ok('placeholder-name contact gets avatarUrl too', cB?.avatarUrl === 'https://pps.whatsapp.net/v/example-B.jpg', `avatarUrl=${cB?.avatarUrl}`);

  // (3) Manually-renamed contact — never overwritten
  await prisma.contact.create({ data: { phone: phoneC, name: 'Cliente VIP Ferretería Torres', channel: 'WHATSAPP' } });
  const inC = new WhatsAppIncomingMessage(
    `test-c-${Date.now()}`, phoneC, new Date(), WhatsAppMessageType.TEXT,
    'Consulta', null, null,
    `${phoneC}@s.whatsapp.net`, null,
    'Ale del celular', 'https://pps.whatsapp.net/v/example-C.jpg',
  );
  await handler.handleWhatsAppMessage(inC);
  const cC = await prisma.contact.findUnique({ where: { phone: phoneC } });
  ok('manual rename is NOT overwritten by pushName', cC?.name === 'Cliente VIP Ferretería Torres', `name=${cC?.name}`);
  ok('avatarUrl still updates even when name is protected', cC?.avatarUrl === 'https://pps.whatsapp.net/v/example-C.jpg');

  // (4) avatarUrl refresh — cliente cambió su foto
  await prisma.contact.create({
    data: { phone: phoneD, name: 'Roberto', channel: 'WHATSAPP', avatarUrl: 'https://pps.whatsapp.net/v/old-D.jpg' },
  });
  const inD = new WhatsAppIncomingMessage(
    `test-d-${Date.now()}`, phoneD, new Date(), WhatsAppMessageType.TEXT,
    'Hola', null, null,
    `${phoneD}@s.whatsapp.net`, null,
    'Roberto', 'https://pps.whatsapp.net/v/new-D.jpg',
  );
  await handler.handleWhatsAppMessage(inD);
  const cD = await prisma.contact.findUnique({ where: { phone: phoneD } });
  ok('avatarUrl refreshes when the incoming URL changes', cD?.avatarUrl === 'https://pps.whatsapp.net/v/new-D.jpg', `avatarUrl=${cD?.avatarUrl}`);

  // Cleanup — cascade manually (schema no tiene onDelete: Cascade
  // porque queremos retener el historial en prod cuando borran un
  // contacto, y esto acá es infraestructura de test).
  const phones = [phoneA, phoneB, phoneC, phoneD];
  const contacts = await prisma.contact.findMany({ where: { phone: { in: phones } }, select: { id: true } });
  const contactIds = contacts.map((c) => c.id);
  const convs = await prisma.conversation.findMany({ where: { contactId: { in: contactIds } }, select: { id: true } });
  const convIds = convs.map((c) => c.id);
  await prisma.message.deleteMany({ where: { conversationId: { in: convIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: convIds } } });
  await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
  await prisma.$disconnect();
  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
