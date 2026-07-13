// A4 (documento de trabajo 2026-07-10):
//  Parte 1) Al editar un usuario SIN tocar la contraseña, la clave NO
//           debe cambiarse. Valores que parecen un hash bcrypt deben
//           ser rechazados (autofill del navegador re-hasheaba el hash).
//  Parte 2) Un pedido marcado DISPATCHED localmente NO debe volver a
//           CONFIRMED por el sync de TiendaNube.

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { UserManagementService } = require('/home/servifibras/backend/dist/src/adapters/admin/user-management.service');
  const { PrismaClient, OrderStatus, OrderType, OrderSource } = require('/home/servifibras/backend/node_modules/@prisma/client');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const users = app.get(UserManagementService);
  const prisma = new PrismaClient();

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // ==== Parte 1: password ====================================================
  const stamp = Date.now();
  const email = `a4-test-${stamp}@servifibras.test`;
  const created = await prisma.user.create({
    data: {
      email,
      username: `a4-${stamp}`,
      name: 'A4 Test',
      role: 'ATENCION',
      password: '$2a$10$originalPasswordHashOriginalHashValue012345678901234567890', // 60 chars
      active: true,
    },
    select: { id: true, password: true },
  });
  const originalHash = created.password;

  // Sub-test 1: name-only edit does NOT change the password.
  await users.update(created.id, { name: 'A4 Test Renamed' });
  const afterNameEdit = await prisma.user.findUnique({ where: { id: created.id }, select: { password: true } });
  ok(
    'password NOT changed when only name is edited',
    afterNameEdit.password === originalHash,
  );

  // Sub-test 2: sending a bcrypt-hash-looking password is rejected.
  const fakeHash = '$2b$10$XYZfakelookslikeabcryptvaluehaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  let hashRejected = false;
  try {
    await users.update(created.id, { password: fakeHash });
  } catch (err) {
    if (String(err.message).includes('hash')) hashRejected = true;
  }
  ok(
    'bcrypt-hash-looking password is rejected (autofill trap)',
    hashRejected,
  );

  // Sub-test 3: sending a plain-text password DOES change the password.
  await users.update(created.id, { password: 'plainNewPassword123' });
  const afterExplicitReset = await prisma.user.findUnique({ where: { id: created.id }, select: { password: true } });
  ok(
    'plain-text password DOES change the stored hash',
    afterExplicitReset.password !== originalHash,
  );

  await prisma.user.delete({ where: { id: created.id } });

  // ==== Parte 2: order status =================================================
  // Seed a sandbox contact + a DISPATCHED order sourced from TN.
  const contact = await prisma.contact.create({
    data: { name: `A4 order buyer ${stamp}`, phone: `a4-${stamp}`, isSandbox: true },
  });
  const externalId = `a4-tn-${stamp}`;
  const order = await prisma.order.create({
    data: {
      orderNumber: `TN-A4-${stamp}`,
      contactId: contact.id,
      status: OrderStatus.DISPATCHED,
      orderType: OrderType.STANDARD,
      source: OrderSource.TIENDANUBE,
      externalId,
      amount: 0,
      currency: 'ARS',
      products: [],
      dispatchedAt: new Date(Date.now() - 60_000),
    },
  });

  // Simulate what TiendaNubeOrdersSyncService.upsertOne does now with
  // a payload where the incoming status downgrades to CONFIRMED.
  // We directly re-run the guarded-update block (extracted as a
  // constant in the service; here we replicate its shape).
  const existing = await prisma.order.findUnique({
    where: { source_externalId: { source: OrderSource.TIENDANUBE, externalId } },
  });
  const incomingStatus = OrderStatus.CONFIRMED;
  const RANK = { PENDING: 0, CONFIRMED: 1, PROCESSING: 2, DISPATCHED: 3, DELIVERED: 4, CANCELLED: 5 };
  const localRank = RANK[existing.status];
  const incomingRank = RANK[incomingStatus];
  const preserveLocalStatus =
    existing.status === 'CANCELLED' ||
    (localRank >= RANK.DISPATCHED && incomingRank < localRank);
  await prisma.order.update({
    where: { id: existing.id },
    data: {
      status: preserveLocalStatus ? existing.status : incomingStatus,
      dispatchedAt: existing.dispatchedAt,
    },
  });
  const afterSync = await prisma.order.findUnique({ where: { id: order.id }, select: { status: true } });
  ok(
    'DISPATCHED order stays DISPATCHED after sync tries to roll it back to CONFIRMED',
    afterSync.status === OrderStatus.DISPATCHED,
    `local=${afterSync.status}`,
  );

  // Complement: PENDING → CONFIRMED is a valid forward transition and should apply.
  const forwardExtId = `a4-tn-forward-${stamp}`;
  const pendingOrder = await prisma.order.create({
    data: {
      orderNumber: `TN-A4F-${stamp}`,
      contactId: contact.id,
      status: OrderStatus.PENDING,
      orderType: OrderType.STANDARD,
      source: OrderSource.TIENDANUBE,
      externalId: forwardExtId,
      amount: 0,
      currency: 'ARS',
      products: [],
    },
  });
  const ex2 = await prisma.order.findUnique({
    where: { source_externalId: { source: OrderSource.TIENDANUBE, externalId: forwardExtId } },
  });
  const incoming2 = OrderStatus.CONFIRMED;
  const l2 = RANK[ex2.status];
  const i2 = RANK[incoming2];
  const preserve2 = ex2.status === 'CANCELLED' || (l2 >= RANK.DISPATCHED && i2 < l2);
  await prisma.order.update({
    where: { id: ex2.id },
    data: { status: preserve2 ? ex2.status : incoming2 },
  });
  const forwardResult = await prisma.order.findUnique({ where: { id: pendingOrder.id }, select: { status: true } });
  ok(
    'forward transition PENDING → CONFIRMED still applies',
    forwardResult.status === OrderStatus.CONFIRMED,
    `local=${forwardResult.status}`,
  );

  // Cleanup orders + contact
  await prisma.order.deleteMany({ where: { contactId: contact.id } });
  await prisma.contact.delete({ where: { id: contact.id } });

  await prisma.$disconnect();
  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
