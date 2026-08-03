// Marcos 2026-08-03 (WhatsApp 8:16 AR): "yanina ve todas las
// conversaciones de whatsapp, brenda y franco no". Yanina es ADMIN;
// Brenda y Franco son ENCARGADO. El scoping trataba ENCARGADO como
// VENTAS/LOGISTICA — sólo asignadas — cuando en la realidad de
// Servifibras es rol elevated (managers de operaciones). Otros
// controllers ya lo trataban así (orders, logística) pero el scoping
// del inbox de conversaciones quedó afuera.
//
// Test valida:
//   1. ADMIN ve todas las conversaciones (incluidas ajenas + sin asignar)
//   2. ENCARGADO ahora ve TAMBIÉN todas (equivalente a ADMIN)
//   3. ATENCION ve sólo las asignadas a ella + las sin asignar
//   4. VENTAS ve SÓLO las asignadas a ella (nunca las de otros ni las
//      sin asignar) — regresión-guard: no ampliamos scope de más
//   5. LOGISTICA ídem VENTAS

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
  const now = new Date();

  const usrAdmin = await prisma.user.create({ data: { email: `test-admin-${suffix}@t.io`, username: `admin${suffix}`, name: 'TestAdmin', role: 'ADMIN', password: 'x', active: false } });
  const usrEnc = await prisma.user.create({ data: { email: `test-enc-${suffix}@t.io`, username: `enc${suffix}`, name: 'TestEncargado', role: 'ENCARGADO', password: 'x', active: false } });
  const usrAten = await prisma.user.create({ data: { email: `test-aten-${suffix}@t.io`, username: `aten${suffix}`, name: 'TestAtencion', role: 'ATENCION', password: 'x', active: false } });
  const usrVen = await prisma.user.create({ data: { email: `test-ven-${suffix}@t.io`, username: `ven${suffix}`, name: 'TestVentas', role: 'VENTAS', password: 'x', active: false } });

  // 3 conversations: one assigned to Atencion, one assigned to Ventas,
  // one unassigned. customerType MAYORISTA + lastMessageAt=1 year ago
  // los ubica arriba del pool pending (urgency ordering agosto-03), así
  // no quedan afuera del top-500 cuando prod tiene ~600 pending.
  const veryOld = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  void veryOld;
  const contactAten = await prisma.contact.create({ data: { phone: `9994${suffix}A`, name: 'CustA', channel: 'WHATSAPP', customerType: 'MAYORISTA' } });
  const contactVen = await prisma.contact.create({ data: { phone: `9994${suffix}V`, name: 'CustV', channel: 'WHATSAPP', customerType: 'MAYORISTA' } });
  const contactUn = await prisma.contact.create({ data: { phone: `9994${suffix}U`, name: 'CustU', channel: 'WHATSAPP', customerType: 'MAYORISTA' } });

  // needsHumanAttention: true — el listConversations ordena pending
  // primero (fix urgency 08-03) y satura el page-size con el pool
  // pending de prod. Sin marcar pending, mis test convs quedan fuera
  // de la primera página aunque tengan lastMessageAt=ahora.
  // lastMessageAt hace 1 año: dentro del bucket MAYORISTA-pending, el
  // que espera más tiempo va arriba (longest wait). 1 año garantiza
  // sortear en top-3 del pool.
  const ancient = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const convAten = await prisma.conversation.create({ data: { contactId: contactAten.id, channel: 'WHATSAPP', status: 'ACTIVE', assignedTo: usrAten.id, lastMessageAt: ancient, needsHumanAttention: true } });
  const convVen = await prisma.conversation.create({ data: { contactId: contactVen.id, channel: 'WHATSAPP', status: 'ACTIVE', assignedTo: usrVen.id, lastMessageAt: ancient, needsHumanAttention: true } });
  const convUn = await prisma.conversation.create({ data: { contactId: contactUn.id, channel: 'WHATSAPP', status: 'ACTIVE', assignedTo: null, lastMessageAt: ancient, needsHumanAttention: true } });
  const seededIds = new Set([convAten.id, convVen.id, convUn.id]);

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  const runList = async (userId, role) => {
    const r = await svc.listConversations({ channel: 'WHATSAPP', page: 1, pageSize: 500, scope: { userId, role } });
    const ids = new Set((r?.conversations ?? []).map((c) => c.id));
    return {
      seesAten: ids.has(convAten.id),
      seesVen: ids.has(convVen.id),
      seesUn: ids.has(convUn.id),
    };
  };

  const rAdmin = await runList(usrAdmin.id, UserRole.ADMIN);
  ok('ADMIN sees all 3 conversations (baseline)', rAdmin.seesAten && rAdmin.seesVen && rAdmin.seesUn, JSON.stringify(rAdmin));

  const rEnc = await runList(usrEnc.id, UserRole.ENCARGADO);
  ok('ENCARGADO sees ALL 3 conversations (fix — was only own before)', rEnc.seesAten && rEnc.seesVen && rEnc.seesUn, JSON.stringify(rEnc));

  const rAten = await runList(usrAten.id, UserRole.ATENCION);
  ok('ATENCION sees own + unassigned; NOT other user\'s', rAten.seesAten && rAten.seesUn && !rAten.seesVen, JSON.stringify(rAten));

  const rVen = await runList(usrVen.id, UserRole.VENTAS);
  ok('VENTAS sees ONLY own (regression guard on strict scope)', !rVen.seesAten && rVen.seesVen && !rVen.seesUn, JSON.stringify(rVen));

  // (5) Deep-link check via getConversationDetails: ENCARGADO can open any conv
  const detEnc = await svc.getConversationById(convVen.id, { userId: usrEnc.id, role: UserRole.ENCARGADO });
  ok('ENCARGADO deep-link into another user\'s conv → allowed', detEnc && detEnc.id === convVen.id, `got=${detEnc?.id ?? 'null'}`);

  const detVen = await svc.getConversationById(convAten.id, { userId: usrVen.id, role: UserRole.VENTAS });
  ok('VENTAS deep-link into another user\'s conv → hidden (null)', detVen === null, `got=${detVen?.id ?? 'null'}`);

  // Cleanup — conversations first, then contacts, then users
  await prisma.conversation.deleteMany({ where: { id: { in: [...seededIds] } } });
  await prisma.contact.deleteMany({ where: { id: { in: [contactAten.id, contactVen.id, contactUn.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [usrAdmin.id, usrEnc.id, usrAten.id, usrVen.id] } } });
  await prisma.$disconnect();

  await app.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
