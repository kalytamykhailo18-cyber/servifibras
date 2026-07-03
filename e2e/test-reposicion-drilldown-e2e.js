// E2E: drill-down del widget "Costo de reposiciones por responsable"
// (Marcos 2026-07-03, item 4).
//
// Invariante crítica: la suma de rowTotal en el drill-down de un
// responsable en un rango dado tiene que ser IGUAL al totalCost de
// ese responsable en el summary del mismo rango. Sin esto el número
// del dashboard no es auditable.
//
// Testea directo contra los service methods vía NestFactory
// createApplicationContext (los endpoints requieren ADMIN token y
// Marcos rotó el password de admin@ el 2026-07-02).

async function main() {
  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { AnalyticsService } = require('/home/servifibras/backend/dist/src/adapters/admin/analytics.service');
  const { OrderManagementService } = require('/home/servifibras/backend/dist/src/adapters/admin/order-management.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const analytics = app.get(AnalyticsService);
  const orderMgmt = app.get(OrderManagementService);

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // Wide window covering all historical REPOSICIONES.
  const now = new Date();
  const fromIso = new Date('2026-01-01T00:00:00.000Z').toISOString();
  const toIso = now.toISOString();

  console.log('\n[summary] getReposicionCostByResponsible over full history');
  const summary = await analytics.getReposicionCostByResponsible({ fromIso, toIso });
  console.log(`  ${summary.byResponsible.length} responsables · ${summary.total} pedidos · ARS ${summary.totalCost}`);

  ok('[summary] returned at least one responsible', summary.byResponsible.length >= 1);

  // For each responsible bucket, verify drill-down sum matches.
  console.log('\n[invariant] sum(drilldown.rowTotal) === summary.totalCost per responsible');
  for (const bucket of summary.byResponsible) {
    const respIdOrNull = bucket.responsibleId;
    const dd = await analytics.getReposicionOrdersByResponsible({
      responsibleId: respIdOrNull,
      fromIso,
      toIso,
    });
    const summed = dd.orders.reduce((s, o) => s + o.rowTotal, 0);
    const summedRounded = Math.round(summed * 100) / 100;
    ok(
      `[${bucket.name}] drill-down sum = summary totalCost`,
      Math.abs(summedRounded - bucket.totalCost) < 0.5,
      `drill=ARS ${summedRounded} summary=ARS ${bucket.totalCost} count=${dd.orders.length}/${bucket.count}`,
    );
    ok(
      `[${bucket.name}] drill-down count matches summary count`,
      dd.orders.length === bucket.count,
      `drill=${dd.orders.length} summary=${bucket.count}`,
    );
  }

  // ORD-2026-9360 verification (Marcos's concrete example): after this
  // deploy the detail is populated. Snapshot the row.
  console.log('\n[example] ORD-2026-9360 reads back with new fields');
  const {PrismaClient} = require('/home/servifibras/backend/node_modules/@prisma/client');
  const p = new PrismaClient();
  const ord = await p.order.findFirst({
    where: { orderNumber: 'ORD-2026-9360' },
    select: {
      id: true, orderNumber: true, orderType: true,
      carrier: true, shippingZone: true, shippingCost: true,
      returnCarrier: true, returnShippingCost: true, returnState: true,
      productLabel: true, productValue: true,
      responsible: { select: { name: true } },
      errorReason: true, errorReasonNote: true,
    },
  });
  console.log('  order:', ord?.orderNumber, ord?.orderType);
  console.log('  carrier=', ord?.carrier, 'zona=', ord?.shippingZone, 'costo ida=', ord?.shippingCost);
  console.log('  responsable=', ord?.responsible?.name);
  console.log('  producto=', ord?.productLabel, 'valor=', ord?.productValue);
  console.log('  retorno=', ord?.returnCarrier, 'costo retorno=', ord?.returnShippingCost, 'state=', ord?.returnState);
  console.log('  motivo=', ord?.errorReason, 'nota=', ord?.errorReasonNote);
  ok('ORD-2026-9360 exists', !!ord);
  ok('ORD-2026-9360 has carrier persisted', ord?.carrier != null);
  ok('ORD-2026-9360 has zona persisted', ord?.shippingZone != null);
  ok('ORD-2026-9360 has responsable persisted', ord?.responsible?.name != null);

  await p.$disconnect();
  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
