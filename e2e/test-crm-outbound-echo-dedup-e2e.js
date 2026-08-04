// Marcos 2026-08-04 (WhatsApp 09:20 AR): "se están duplicando las
// conversaciones". Screenshot mostraba dos filas de Luján — una con
// nombre y foto (contacto real, phone=5492974201893), otra con el
// LID crudo como nombre (phone=268117662019706). Root cause: cuando
// el CRM envía un mensaje por Baileys, Baileys eventualmente re-emite
// ese mismo mensaje como fromMe=true en messages.upsert. El handler
// llama recordPhoneSideOutbound, que hace findOrCreateContact con
// from=LID digits (porque senderPn no viene en ese echo) — y crea
// un contacto duplicado.
//
// Fix: sendManualMessage y sendManualAttachment stampean el
// waMessageId que Baileys devuelve en la metadata de la fila DB.
// recordPhoneSideOutbound ya tiene dedup por waMessageId — cuando
// el echo llega, encuentra la fila stampeada, hace no-op y no crea
// contacto duplicado.
//
// Este test valida:
//   1. sendManualMessage stampea waMessageId cuando WhatsAppService
//      devuelve success + messageId
//   2. Un recordPhoneSideOutbound con ese mismo waMessageId es no-op
//      (no crea contacto nuevo, no crea conversación nueva, no
//      duplica el mensaje)

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';
  process.env.HANDOFF_RECONCILE_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { ConversationManagementService } = require('/home/servifibras/backend/dist/src/adapters/admin/conversation-management.service');
  const { ConversationHandlerService } = require('/home/servifibras/backend/dist/src/adapters/conversations/conversation-handler.service');
  const { WhatsAppService } = require('/home/servifibras/backend/dist/src/adapters/whatsapp/whatsapp.service');
  const { WhatsAppSendResult } = require('/home/servifibras/backend/dist/src/domain/entities/whatsapp-message.entity');
  const { PrismaClient } = require(path.join('/home/servifibras/backend/node_modules/@prisma/client'));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const svc = app.get(ConversationManagementService);
  const handler = app.get(ConversationHandlerService);
  const waSvc = app.get(WhatsAppService);
  const prisma = new PrismaClient();

  const suffix = String(process.pid);
  const realPhone = `54929742${suffix.padStart(5, '0')}`;
  const lidDigits = `26811766${suffix.padStart(6, '0')}`;
  const fakeWaMessageId = `3EB0FAKE${Date.now()}`;

  // Seed the "real Luján" contact + conversation
  await prisma.contact.deleteMany({ where: { OR: [{ phone: realPhone }, { phone: lidDigits }] } });
  const seedUser = await prisma.user.create({
    data: { email: `dedup-${suffix}@t.io`, username: `dd${suffix}`, name: 'Dedup', role: 'ADMIN', password: 'x', active: false },
  });
  const realContact = await prisma.contact.create({
    data: { phone: realPhone, name: 'Luján', channel: 'WHATSAPP', metadata: { waJid: `${lidDigits}@lid` } },
  });
  const conv = await prisma.conversation.create({
    data: { contactId: realContact.id, channel: 'WHATSAPP', status: 'ACTIVE', lastMessageAt: new Date() },
  });

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // Stub WhatsAppService.sendMessage to return a known messageId
  const originalSend = waSvc.sendMessage.bind(waSvc);
  waSvc.sendMessage = async () => WhatsAppSendResult.success(fakeWaMessageId);

  // (1) sendManualMessage stamps waMessageId on the created row
  const sent = await svc.sendManualMessage(conv.id, seedUser.id, 'Hola Luján, te paso la propuesta');
  const stampedRow = await prisma.message.findUnique({ where: { id: sent.id } });
  ok(
    'sendManualMessage stampea waMessageId en metadata',
    stampedRow?.metadata?.waMessageId === fakeWaMessageId,
    `metadata=${JSON.stringify(stampedRow?.metadata)}`,
  );
  ok('metadata.source = "crm-outbound"', stampedRow?.metadata?.source === 'crm-outbound');

  // (2) Baileys echoes back the same messageId as fromMe=true.
  // recordPhoneSideOutbound sees the existing stamped row and no-ops:
  //   NO new contact (LID-digits phone), NO new conv, NO duplicate msg.
  const beforeContacts = await prisma.contact.count();
  const beforeConvs = await prisma.conversation.count();
  const beforeMsgs = await prisma.message.count({ where: { conversationId: conv.id } });
  await handler.recordPhoneSideOutbound({
    to: lidDigits,
    text: 'Hola Luján, te paso la propuesta',
    jid: `${lidDigits}@lid`,
    waMessageId: fakeWaMessageId,   // same as CRM stamp
    timestamp: new Date(),
    fallbackLookup: null,
  });
  const afterContacts = await prisma.contact.count();
  const afterConvs = await prisma.conversation.count();
  const afterMsgs = await prisma.message.count({ where: { conversationId: conv.id } });
  ok('echo dedup: no new contact created', afterContacts === beforeContacts, `before=${beforeContacts} after=${afterContacts}`);
  ok('echo dedup: no new conversation created', afterConvs === beforeConvs, `before=${beforeConvs} after=${afterConvs}`);
  ok('echo dedup: no duplicate message on the conv', afterMsgs === beforeMsgs, `before=${beforeMsgs} after=${afterMsgs}`);

  // Cleanup
  waSvc.sendMessage = originalSend;
  await prisma.message.deleteMany({ where: { conversationId: conv.id } });
  await prisma.conversation.delete({ where: { id: conv.id } });
  await prisma.contact.deleteMany({ where: { OR: [{ phone: realPhone }, { phone: lidDigits }] } });
  await prisma.user.delete({ where: { id: seedUser.id } });
  await prisma.$disconnect();
  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
