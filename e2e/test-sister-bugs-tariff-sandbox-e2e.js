// Sister-bug regressions for the 2026-07-16 audit sweep:
//
//   (1) DispatchTariffService.estimateFor / estimateBatch must match
//       "GBA 1" against a "GBA1" tariff row (and "JYJ" against "JyJ"),
//       via normalizeTariffKey — the fix that already lived only in
//       analytics.service.ts. Baires shipments were showing "sin
//       tarifa" every time the operator picked a zone with a slightly
//       different spelling than the stored row.
//
//   (2) RoleMetricsService.getAdminMetrics() must exclude sandbox
//       fixtures from the W/W deltas, the best-converting-channel
//       card, and top-sold-products. Before the fix, E2E seed rows
//       inflated Marcos's Admin dashboard.
//
// Both were shipped alongside the initial fixes but only in ONE call
// site each — this test locks the sibling sites in place.

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { DispatchTariffService, normalizeTariffKey } = require('/home/servifibras/backend/dist/src/adapters/admin/dispatch-tariff.service');
  const { RoleMetricsService } = require('/home/servifibras/backend/dist/src/adapters/admin/role-metrics.service');
  const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const tariffs = app.get(DispatchTariffService);
  const metrics = app.get(RoleMetricsService);
  const prisma = new PrismaClient();

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // ─── (1) tariff normalization sister-bug ──────────────────────────
  // Seed a canonical "SISTER-CARRIER" row spelled with mixed case +
  // internal space collapsing, verify all four permutations resolve.
  const stamp = Date.now();
  const carrierRaw = `SisterCarrier${stamp}`;
  const zoneRaw = 'GBA1';
  const seeded = await prisma.dispatchTariff.create({
    data: {
      carrier: carrierRaw,
      zone: zoneRaw,
      costPerPackage: 1234,
      currency: 'ARS',
      active: true,
    },
  });

  const permutations = [
    { label: 'exact', carrier: carrierRaw, zone: 'GBA1' },
    { label: 'zone-with-space', carrier: carrierRaw, zone: 'GBA 1' },
    { label: 'carrier-lowercase', carrier: carrierRaw.toLowerCase(), zone: 'GBA1' },
    { label: 'both-with-noise', carrier: carrierRaw.toUpperCase() + ' ', zone: '  gba 1 ' },
  ];

  for (const p of permutations) {
    const e = await tariffs.estimateFor({ carrier: p.carrier, zone: p.zone, packages: 3 });
    ok(
      `estimateFor(${p.label}) matches the seed row`,
      e !== null && e.unitCost === 1234 && e.total === 3702,
      e ? `total=${e.total}` : 'null',
    );
  }

  const batch = await tariffs.estimateBatch(permutations.map((p) => ({ carrier: p.carrier, zone: p.zone, packages: 1 })));
  ok(
    'estimateBatch resolves every permutation',
    batch.every((r) => r?.unitCost === 1234),
    batch.map((r) => (r ? 'OK' : 'null')).join(','),
  );

  const helperKey = normalizeTariffKey('SISTER CARRIER', ' GBA 1 ');
  ok(
    'normalizeTariffKey is exported and strips space + case',
    helperKey === 'sistercarrier::gba1',
    helperKey,
  );

  await prisma.dispatchTariff.delete({ where: { id: seeded.id } });

  // ─── (2) AdminMetrics sandbox scope sister-bug ────────────────────
  // Seed a sandbox conversation + sandbox contact-owned lead+order,
  // fetch metrics, assert the counts stayed the same as the pre-seed
  // baseline (sandbox rows do NOT show up).
  const baseline = await metrics.getAdminMetrics();

  const sandboxContact = await prisma.contact.create({
    data: {
      name: `Sister sandbox ${stamp}`,
      phone: `999${stamp}`,
      isSandbox: true,
    },
  });
  const sandboxConv = await prisma.conversation.create({
    data: { contactId: sandboxContact.id, channel: 'WHATSAPP', isSandbox: true },
  });
  const sandboxLead = await prisma.lead.create({
    data: {
      contactId: sandboxContact.id,
      status: 'WON',
      source: 'WHATSAPP',
      productInterest: 'Sister sandbox seed',
    },
  });
  const sandboxOrder = await prisma.order.create({
    data: {
      contactId: sandboxContact.id,
      orderNumber: `ORD-SISTER-${stamp}`,
      amount: 999999,
      currency: 'ARS',
      status: 'CONFIRMED',
      products: [{ name: 'Sister sandbox product', quantity: 1 }],
    },
  });

  const after = await metrics.getAdminMetrics();

  ok(
    'AdminMetrics W/W conversations count did NOT rise from sandbox fixture',
    after.wow.conversations.thisWeek === baseline.wow.conversations.thisWeek,
    `before=${baseline.wow.conversations.thisWeek} after=${after.wow.conversations.thisWeek}`,
  );
  ok(
    'AdminMetrics W/W leads count did NOT rise from sandbox fixture',
    after.wow.leads.thisWeek === baseline.wow.leads.thisWeek,
    `before=${baseline.wow.leads.thisWeek} after=${after.wow.leads.thisWeek}`,
  );
  ok(
    'AdminMetrics W/W orders count did NOT rise from sandbox fixture',
    after.wow.orders.thisWeek === baseline.wow.orders.thisWeek,
    `before=${baseline.wow.orders.thisWeek} after=${after.wow.orders.thisWeek}`,
  );
  ok(
    'topSoldProducts did NOT surface the sandbox product',
    !after.topSoldProducts.some((p) => p.name === 'Sister sandbox product'),
    after.topSoldProducts.map((p) => p.name).join('|'),
  );

  await prisma.order.delete({ where: { id: sandboxOrder.id } });
  await prisma.lead.delete({ where: { id: sandboxLead.id } });
  await prisma.conversation.delete({ where: { id: sandboxConv.id } });
  await prisma.contact.delete({ where: { id: sandboxContact.id } });

  await prisma.$disconnect();
  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
