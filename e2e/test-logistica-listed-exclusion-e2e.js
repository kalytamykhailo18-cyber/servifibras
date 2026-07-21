// Marcos 2026-07-21 (hunt preventivo): Order.status en este sistema
// NUNCA avanza a DISPATCHED — el flow de despacho usa la tabla
// logistica_armado con state='LISTO'. Antes, getLogisticaMetrics
// contaba pendingOrders/overdueOrders sobre Order.status IN
// (CONFIRMED, PROCESSING) sin cruzar contra logistica_armado. Marcos
// veía 1096 pendientes cuando 1072 ya estaban LISTO (backlog real
// ~24). Este test valida:
//   (a) órdenes con LISTO se restan del count
//   (b) órdenes sin LISTO se cuentan
//   (c) el reconciler alinea rows needsHumanAttention=false + WAITING
//   (d) clearFlag baja status a ACTIVE (fixed en el mismo pass)

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';
  process.env.HANDOFF_RECONCILE_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { RoleMetricsService } = require('/home/servifibras/backend/dist/src/adapters/admin/role-metrics.service');
  const { HumanHandoffService } = require('/home/servifibras/backend/dist/src/adapters/lead-detection/human-handoff.service');
  const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const roles = app.get(RoleMetricsService);
  const handoff = app.get(HumanHandoffService);
  const prisma = new PrismaClient();

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' - ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  const stamp = Date.now();
  const contact = await prisma.contact.create({
    data: { name: `Log test ${stamp}`, phone: `9995${stamp}`, isSandbox: false },
  });
  // 10 años atrás para garantizar que caiga en el top-6 más viejos
  // aunque haya rows históricas en prod.
  const oldTs = new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000);

  // Baseline snapshot
  const before = await roles.getLogisticaMetrics();

  // Seed 3 orders: one still pending (CONFIRMED, no LISTO row), two
  // pending-per-Order.status but LISTO-per-ops (should be excluded).
  const stillPending = await prisma.order.create({
    data: {
      contactId: contact.id, orderNumber: `TEST-P-${stamp}`,
      amount: 1000, currency: 'ARS', status: 'CONFIRMED',
      createdAt: oldTs,
      products: [{ name: 'seed', quantity: 1 }],
    },
  });
  const listedTnStyle = await prisma.order.create({
    data: {
      contactId: contact.id, orderNumber: `TEST-L1-${stamp}`,
      amount: 1000, currency: 'ARS', status: 'CONFIRMED',
      createdAt: oldTs,
      products: [{ name: 'seed', quantity: 1 }],
    },
  });
  const listedCrmStyle = await prisma.order.create({
    data: {
      contactId: contact.id, orderNumber: `TEST-L2-${stamp}`,
      amount: 1000, currency: 'ARS', status: 'CONFIRMED',
      createdAt: oldTs,
      products: [{ name: 'seed', quantity: 1 }],
    },
  });

  // Ops marks two of them LISTO — one via tn: rowKey, one via crm:
  // rowKey. Both formats are what daily-logistica-aggregator writes.
  await prisma.logisticaArmado.create({
    data: {
      rowKey: `tn:${listedTnStyle.id}`,
      dayDate: new Date().toISOString().slice(0, 10),
      state: 'LISTO',
      listoAt: new Date(),
    },
  });
  await prisma.logisticaArmado.create({
    data: {
      rowKey: `crm:${listedCrmStyle.id}`,
      dayDate: new Date().toISOString().slice(0, 10),
      state: 'LISTO',
      listoAt: new Date(),
    },
  });

  const after = await roles.getLogisticaMetrics();

  ok(
    'pendingOrders bumped by exactly +1 (the non-LISTO order)',
    after.pendingOrders === before.pendingOrders + 1,
    `before=${before.pendingOrders} after=${after.pendingOrders}`,
  );
  ok(
    'overdueOrders bumped by exactly +1 (72h old, non-LISTO)',
    after.overdueOrders === before.overdueOrders + 1,
    `before=${before.overdueOrders} after=${after.overdueOrders}`,
  );
  const inTop = (after.pendingTop ?? []).some((o) => o.orderId === stillPending.id);
  const listedInTop = (after.pendingTop ?? []).some((o) => o.orderId === listedTnStyle.id || o.orderId === listedCrmStyle.id);
  ok('pendingTop lists the non-LISTO order (oldest-first)', inTop);
  ok('pendingTop does NOT surface LISTO orders', !listedInTop);

  // Reconciler status-alignment case
  const stuckConv = await prisma.conversation.create({
    data: {
      contactId: contact.id,
      channel: 'WHATSAPP',
      isSandbox: false,
      needsHumanAttention: false,
      status: 'WAITING',
    },
  });
  const dry = await handoff.reconcileStaleNeedsHumanAttention({ dryRun: true });
  ok('dry-run reports statusAligned candidate count >= 1', (dry.statusAligned ?? 0) >= 1, `statusAligned=${dry.statusAligned}`);
  const live = await handoff.reconcileStaleNeedsHumanAttention();
  ok('live run aligned statuses', (live.statusAligned ?? 0) >= 1, `aligned=${live.statusAligned}`);
  const aligned = await prisma.conversation.findUnique({ where: { id: stuckConv.id }, select: { status: true } });
  ok('stuck conversation moved WAITING -> ACTIVE', aligned?.status === 'ACTIVE', `status=${aligned?.status}`);

  // clearFlag test — sets flag=true, then clearFlag, verifies status=ACTIVE
  const flagConv = await prisma.conversation.create({
    data: {
      contactId: contact.id,
      channel: 'WHATSAPP',
      isSandbox: false,
      needsHumanAttention: true,
      status: 'WAITING',
    },
  });
  await handoff.clearFlag(flagConv.id);
  const cleared = await prisma.conversation.findUnique({ where: { id: flagConv.id }, select: { needsHumanAttention: true, status: true } });
  ok('clearFlag flipped needsHumanAttention=false', cleared?.needsHumanAttention === false);
  ok('clearFlag also set status=ACTIVE (was WAITING)', cleared?.status === 'ACTIVE', `status=${cleared?.status}`);

  // Cleanup
  await prisma.logisticaArmado.deleteMany({ where: { rowKey: { in: [`tn:${listedTnStyle.id}`, `crm:${listedCrmStyle.id}`] } } });
  await prisma.conversation.deleteMany({ where: { id: { in: [stuckConv.id, flagConv.id] } } });
  await prisma.order.deleteMany({ where: { id: { in: [stillPending.id, listedTnStyle.id, listedCrmStyle.id] } } });
  await prisma.contact.delete({ where: { id: contact.id } });

  await prisma.$disconnect();
  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
