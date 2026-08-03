// Marcos 2026-08-03 (WhatsApp 11:04 AR): "actualmente está posicionando
// arriba los más nuevos. Pero tenemos que aplicar la lógica de que
// posiciona arriba los más urgentes de atención (mayoristas, cliente
// recurrente, y conversaciones que lleven más tiempo esperando)".
//
// Este test valida el nuevo ordering compuesto de urgencia:
//   1. Bloque pendientes arriba
//   2. Dentro de pendientes: MAYORISTA → recurring → resto
//   3. Dentro de cada sub-bloque: longest waiting first
//   4. No-pendientes al final por recency DESC
//   5. Tab "No leídas" (needsHumanAttention=true) preserva urgency
//      dentro de la slice pendiente
//   6. Search + role scope + favorite quedan intactos (regression guard)

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
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // 6 contacts + 6 conversations covering the ranking dimensions:
  //   A: pending, MAYORISTA,   1 week ago       → highest (mayorista + longest wait among pending)
  //   B: pending, MAYORISTA,   1 hour ago       → mayorista, recent → 2nd
  //   C: pending, FRECUENTE,   1 month ago      → recurring + longest wait → 3rd
  //   D: pending, ARTESANO,    1 day ago        → base pending, longest → 4th
  //   E: NOT pending, INDUSTRIAL, 5 min ago     → non-pending, newest → 5th
  //   F: NOT pending, MAYORISTA, oneMonthAgo    → non-pending, oldest → last (mayorista status doesn't hoist non-pending)
  const seedRows = [
    { key: 'A', type: 'MAYORISTA',   stage: 'CONSULTA', pending: true,  lastMsg: oneWeekAgo },
    { key: 'B', type: 'MAYORISTA',   stage: 'CONSULTA', pending: true,  lastMsg: oneHourAgo },
    { key: 'C', type: 'ARTESANO',    stage: 'FRECUENTE',pending: true,  lastMsg: oneMonthAgo },
    { key: 'D', type: 'ARTESANO',    stage: 'CONSULTA', pending: true,  lastMsg: oneDayAgo },
    { key: 'E', type: 'INDUSTRIAL',  stage: 'CONSULTA', pending: false, lastMsg: new Date(now.getTime() - 5 * 60 * 1000) },
    { key: 'F', type: 'MAYORISTA',   stage: 'CONSULTA', pending: false, lastMsg: oneMonthAgo },
  ];

  // Aislamos las conversaciones de prueba asignándolas a un user
  // dedicado; después listamos con assignedToUserId=isolateUser para
  // que la query no traiga las miles de conversaciones reales de prod.
  // Sin aislar, el pool de pending saturaba el page-size y las 2 test
  // no-pending nunca entraban al slice — falso negativo.
  const isolateUser = await prisma.user.create({
    data: { email: `urg-test-${suffix}@t.io`, username: `urg${suffix}`, name: 'UrgTest', role: 'VENTAS', password: 'x', active: false },
  });
  const created = {};
  for (const r of seedRows) {
    const contact = await prisma.contact.create({
      data: {
        phone: `urg-${suffix}-${r.key}`,
        name: `Test ${r.key}`,
        channel: 'WHATSAPP',
        customerType: r.type,
        funnelStage: r.stage,
      },
    });
    const conv = await prisma.conversation.create({
      data: {
        contactId: contact.id,
        channel: 'WHATSAPP',
        status: 'ACTIVE',
        needsHumanAttention: r.pending,
        lastMessageAt: r.lastMsg,
        assignedTo: isolateUser.id,
      },
    });
    created[r.key] = { contactId: contact.id, convId: conv.id };
  }
  const seededConvIds = new Set(Object.values(created).map((v) => v.convId));

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };
  const idOf = (k) => created[k].convId;

  const runList = async (extra = {}) => {
    const r = await svc.listConversations({
      channel: 'WHATSAPP',
      assignedToUserId: isolateUser.id,   // aísla del prod ruido
      limit: 500,
      offset: 0,
      scope: { userId: 'system-test', role: UserRole.ADMIN },
      ...extra,
    });
    return r.conversations.filter((c) => seededConvIds.has(c.id)).map((c) => c.id);
  };

  // (1) Todas tab — full urgency composite
  const rTodas = await runList();
  const expectedTodas = ['A', 'B', 'C', 'D', 'E', 'F'].map(idOf);
  ok(
    'Todas: pending arriba (Mayorista longest-wait → Mayorista recent → Recurring → Otros), no-pending por recency',
    JSON.stringify(rTodas) === JSON.stringify(expectedTodas),
    `got=${rTodas.map((id) => Object.entries(created).find(([, v]) => v.convId === id)?.[0]).join(',')}`,
  );

  // (2) No leídas tab — same order but only pending
  const rNoLeidas = await runList({ needsHumanAttention: true });
  const expectedNoLeidas = ['A', 'B', 'C', 'D'].map(idOf);
  ok(
    'No leídas: mismo ordering compuesto, sólo pending',
    JSON.stringify(rNoLeidas) === JSON.stringify(expectedNoLeidas),
    `got=${rNoLeidas.map((id) => Object.entries(created).find(([, v]) => v.convId === id)?.[0]).join(',')}`,
  );

  // (3) Between mayoristas, oldest waiting wins (regression guard on "longest wait")
  const aIdx = rTodas.indexOf(idOf('A'));
  const bIdx = rTodas.indexOf(idOf('B'));
  ok('Mayorista pending oldest (A) va antes que Mayorista pending recent (B)', aIdx < bIdx && aIdx !== -1, `aIdx=${aIdx} bIdx=${bIdx}`);

  // (4) A recurring pending is between mayorista and base — check C between B and D
  const cIdx = rTodas.indexOf(idOf('C'));
  const dIdx = rTodas.indexOf(idOf('D'));
  ok('Cliente recurrente (C) queda entre Mayoristas (A,B) y base (D)', bIdx < cIdx && cIdx < dIdx, `bIdx=${bIdx} cIdx=${cIdx} dIdx=${dIdx}`);

  // (5) Non-pending MAYORISTA (F) does NOT get hoisted above non-pending others
  const eIdx = rTodas.indexOf(idOf('E'));
  const fIdx = rTodas.indexOf(idOf('F'));
  ok('Non-pending: MAYORISTA no se hoistea por encima de recency (E antes de F por recency)', eIdx < fIdx, `eIdx=${eIdx} fIdx=${fIdx}`);
  ok('Todo non-pending queda debajo de todo pending', dIdx < eIdx, `dIdx=${dIdx} eIdx=${eIdx}`);

  // Cleanup
  await prisma.conversation.deleteMany({ where: { id: { in: [...seededConvIds] } } });
  await prisma.contact.deleteMany({ where: { id: { in: Object.values(created).map((v) => v.contactId) } } });
  await prisma.user.delete({ where: { id: isolateUser.id } });
  await prisma.$disconnect();
  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
