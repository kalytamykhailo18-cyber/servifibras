// Marcos 2026-07-23: OCA bucket con 2 packs OD-* en Despachos. Trace:
// contact.isSandbox=true en ambos, pero el daily-logistica-aggregator
// NO filtraba por contact.isSandbox (a diferencia de analytics.service y
// role-metrics). El fix agrega el mismo scope { contact: { is: {
// isSandbox: false } } } sobre los dos findMany de orders.
//
// El test verifica end-to-end contra el aggregator: seed 2 órdenes
// contra un contact sandbox → NO aparecen en aggregate; seed 2 contra
// contact real → sí aparecen.

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';
  process.env.HANDOFF_RECONCILE_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { DailyLogisticaAggregatorService } = require('/home/servifibras/backend/dist/src/adapters/admin/daily-logistica-aggregator.service');
  const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const agg = app.get(DailyLogisticaAggregatorService);
  const prisma = new PrismaClient();

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' - ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  const stamp = Date.now();

  // Seed: 1 contact sandbox + 1 real, cada uno con 1 orden CONFIRMED
  const sandboxContact = await prisma.contact.create({
    data: { name: `Sandbox Agg ${stamp}`, phone: `9990${stamp}`, isSandbox: true },
  });
  const realContact = await prisma.contact.create({
    data: { name: `Real Agg ${stamp}`, phone: `9991${stamp}`, isSandbox: false },
  });
  const sandboxOrder = await prisma.order.create({
    data: {
      contactId: sandboxContact.id,
      orderNumber: `OD-SANDBOX-${stamp}`,
      amount: 50000, currency: 'ARS', status: 'CONFIRMED',
      carrier: 'OCA', // el mismo tag que estaba filtrandose de más
      products: [{ name: 'seed', quantity: 1 }],
    },
  });
  const realOrder = await prisma.order.create({
    data: {
      contactId: realContact.id,
      orderNumber: `OD-REAL-${stamp}`,
      amount: 50000, currency: 'ARS', status: 'CONFIRMED',
      carrier: 'OCA',
      products: [{ name: 'seed', quantity: 1 }],
    },
  });

  const result = await agg.aggregate(new Date());

  // Recolectamos todas las rowKey visibles across sections
  const allRowKeys = [];
  for (const section of Object.keys(result.sections)) {
    for (const row of result.sections[section] || []) {
      allRowKeys.push(row.rowKey);
    }
  }
  const sandboxRowKey = `crm:${sandboxOrder.id}`;
  const realRowKey = `crm:${realOrder.id}`;

  ok('sandbox order does NOT appear in aggregate', !allRowKeys.includes(sandboxRowKey), `sandboxRowKey=${sandboxRowKey}`);
  ok('real order DOES appear in aggregate', allRowKeys.includes(realRowKey), `realRowKey=${realRowKey}`);

  // Extra check: si el sandbox se colaba, el carrierSummary tendría más
  // en OCA. Sin garantizar el conteo exacto (hay traffic real), sí
  // verificamos que NO existe el rowKey del sandbox en cualquier sección.
  ok('sandbox rowKey not in any section', !allRowKeys.some((k) => k === sandboxRowKey));

  // Cleanup
  await prisma.order.deleteMany({ where: { id: { in: [sandboxOrder.id, realOrder.id] } } });
  await prisma.contact.deleteMany({ where: { id: { in: [sandboxContact.id, realContact.id] } } });

  await prisma.$disconnect();
  await app.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
