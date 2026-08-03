// Marcos 2026-08-03 (WhatsApp 14:23 AR): "una vez que respondo en
// whatsapp web los que no me aparecen en el crm, luego de responder
// si me aparecen". 4 conversaciones en los últimos 3 días arrancaron
// con un ADMIN phone-side como PRIMER mensaje — el inbound original
// del cliente se perdía porque Baileys los entrega como
// type='append' (history sync post-reconnect) y el handler los
// descartaba con `if (m.type !== 'notify') return`. Con la semana
// de outages (rc13 → rc14) varios inbounds cayeron en esa ventana.
//
// Fix: aceptar 'append' además de 'notify', pero SÓLO para mensajes
// de las últimas WHATSAPP_QR_APPEND_MAX_AGE_MS (default 24h) —
// evita re-procesar la historia entera del primer sync. Dedup por
// waMessageId (stamp en metadata al save) previene duplicados si el
// mismo mensaje llega en notify Y luego en append.
//
// Este test valida:
//   1. handleWhatsAppMessage stampea waMessageId en metadata al save
//   2. Segunda llamada con el MISMO waMessageId es no-op (dedup)
//   3. Segunda llamada con waMessageId DISTINTO inserta el mensaje

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

  const suffix = String(process.pid);
  const phone = `54999998${suffix.padStart(4, '0')}`;
  await prisma.contact.deleteMany({ where: { phone } });

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  const waIdA = `history-sync-test-A-${Date.now()}`;
  const inA = new WhatsAppIncomingMessage(
    waIdA, phone, new Date(), WhatsAppMessageType.TEXT,
    'Hola, ¿tienen resina epoxi cristal?', null, null,
    `${phone}@s.whatsapp.net`, null,
    'Cliente Test HS', null,
  );
  await handler.handleWhatsAppMessage(inA);

  const contact = await prisma.contact.findUnique({ where: { phone } });
  const conv = await prisma.conversation.findFirst({ where: { contactId: contact.id, channel: 'WHATSAPP' } });
  const msg1 = await prisma.message.findFirst({
    where: { conversationId: conv.id, sender: 'CUSTOMER' },
    orderBy: { timestamp: 'desc' },
  });
  ok('save stampea waMessageId en metadata (habilita dedup)', msg1?.metadata?.waMessageId === waIdA, `metadata=${JSON.stringify(msg1?.metadata)}`);

  // Second call, SAME waMessageId — should be dedup no-op.
  await handler.handleWhatsAppMessage(inA);
  const countAfterDup = await prisma.message.count({ where: { conversationId: conv.id, sender: 'CUSTOMER' } });
  ok('mismo waMessageId reenviado → dedup no-op (sin duplicado)', countAfterDup === 1, `count=${countAfterDup}`);

  // Third call with DIFFERENT waMessageId — should insert.
  const waIdB = `history-sync-test-B-${Date.now()}`;
  const inB = new WhatsAppIncomingMessage(
    waIdB, phone, new Date(), WhatsAppMessageType.TEXT,
    'Y también moldes?', null, null,
    `${phone}@s.whatsapp.net`, null,
    'Cliente Test HS', null,
  );
  await handler.handleWhatsAppMessage(inB);
  const countAfterNew = await prisma.message.count({ where: { conversationId: conv.id, sender: 'CUSTOMER' } });
  ok('waMessageId distinto → mensaje nuevo insertado', countAfterNew === 2, `count=${countAfterNew}`);

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
