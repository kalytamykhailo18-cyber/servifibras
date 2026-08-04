// Marcos 2026-08-04 (WhatsApp 10:55 AR): "el buscador funciona por
// contenido de la conversación pero no por N de teléfono". Cuando
// el operador pega el número desde WhatsApp Web sale
// "+54 9 11 6636-4558" (con espacios, guiones, +). El predicate
// original `phone contains q` no matcheaba "5491166364558".
//
// Fix: si la query tiene >=4 dígitos y no es puramente numérica,
// agregamos un OR adicional con la versión digits-only.
//
// Test: seed 1 contacto WA + convo con phone plano y busca por
// varias formas humanas del mismo número.

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';
  process.env.HANDOFF_RECONCILE_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { ConversationManagementService } = require('/home/servifibras/backend/dist/src/adapters/admin/conversation-management.service');
  const { UserRole } = require('/home/servifibras/backend/dist/src/domain/entities/auth.entity');
  const { PrismaClient } = require(path.join('/home/servifibras/backend/node_modules/@prisma/client'));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const svc = app.get(ConversationManagementService);
  const prisma = new PrismaClient();

  const suffix = String(process.pid);
  const rawPhone = `54911${suffix.padStart(8, '9')}`;
  await prisma.contact.deleteMany({ where: { phone: rawPhone } });
  const ct = await prisma.contact.create({
    data: { phone: rawPhone, name: 'SearchTest', channel: 'WHATSAPP' },
  });
  const conv = await prisma.conversation.create({
    data: { contactId: ct.id, channel: 'WHATSAPP', status: 'ACTIVE', lastMessageAt: new Date() },
  });

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  const runSearch = async (q) => {
    const r = await svc.listConversations({
      search: q, limit: 100, offset: 0,
      scope: { userId: 'admin', role: UserRole.ADMIN },
    });
    return r.conversations.some((c) => c.id === conv.id);
  };

  // Baseline — plain digits still work (regression guard)
  ok('digits planos igual matchean', await runSearch(rawPhone));

  // Digits contiguos parciales (comportamiento previo, no regressed)
  ok('substring de digits matchea', await runSearch(rawPhone.slice(4)));

  // Con "+" prefix — antes no matcheaba, ahora sí vía digitsOnly
  ok('formato con +54 matchea (digits-only rescate)', await runSearch(`+${rawPhone}`));

  // Con espacios (WhatsApp Web copy)
  const withSpaces = rawPhone.slice(0,2)+' '+rawPhone.slice(2,3)+' '+rawPhone.slice(3,5)+' '+rawPhone.slice(5,9)+' '+rawPhone.slice(9);
  ok('con espacios como WhatsApp Web matchea', await runSearch(withSpaces), `q="${withSpaces}"`);

  // Con guiones (WhatsApp Web copy full)
  const withDashes = `+${rawPhone.slice(0,2)} ${rawPhone.slice(2,3)} ${rawPhone.slice(3,5)} ${rawPhone.slice(5,9)}-${rawPhone.slice(9)}`;
  ok('con "+" espacios y guiones matchea (formato completo WA)', await runSearch(withDashes), `q="${withDashes}"`);

  // Búsqueda por nombre sigue funcionando (regression guard)
  ok('búsqueda por nombre sigue funcionando', await runSearch('SearchTest'));

  // Búsqueda con menos de 4 dígitos → NO agrega el OR normalizado
  // (queda al comportamiento clásico contains original)
  ok('sub-4 dígitos no explota', typeof (await runSearch('12')) === 'boolean');

  // Cleanup
  await prisma.conversation.delete({ where: { id: conv.id } });
  await prisma.contact.delete({ where: { id: ct.id } });
  await prisma.$disconnect();
  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
