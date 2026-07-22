// Marcos 2026-07-22: guardia de dominio .test para user-create.
// Contexto: 4 rows E2E (@servifibras.test) quedaron active=true en
// prod y ensuciaban el dropdown "Asignar a" del CRM. Se limpiaron
// esas 4 rows y se agregó guardia en UserManagementService.create:
// cualquier email que termine en `.test` se crea con active=false
// aunque el llamador pida active=true. Esta guarda es la barrera
// que evita que la próxima batería de tests vuelva a filtrarse.
//
// Test cubre:
//   (a) create con email @servifibras.test + active=true → guarda fuerza active=false
//   (b) create con email @servifibras.test + active=false → sigue false
//   (c) create con email real (@servifibras.com) + active=true → active=true
//   (d) el email se normaliza a lowercase antes de comparar el sufijo
//   (e) rows existentes @servifibras.test están inactivas en prod

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';
  process.env.HANDOFF_RECONCILE_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { UserManagementService } = require('/home/servifibras/backend/dist/src/adapters/admin/user-management.service');
  const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const svc = app.get(UserManagementService);
  const prisma = new PrismaClient();

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' - ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  const stamp = Date.now();
  const created = [];

  try {
    // (a) test-domain + active=true → forced to false
    const testActive = await svc.create({
      email: `guard-test-${stamp}@servifibras.test`,
      username: `guard_test_${stamp}`,
      name: 'Guard test A',
      role: 'VENTAS',
      active: true,
      password: 'guard-test-pw-123',
    });
    created.push(testActive.id);
    ok('.test domain + active=true → forced to false', testActive.active === false, `active=${testActive.active}`);

    // (b) test-domain + active=false → stays false
    const testInactive = await svc.create({
      email: `guard-test-${stamp}-b@servifibras.test`,
      username: `guard_test_b_${stamp}`,
      name: 'Guard test B',
      role: 'LOGISTICA',
      active: false,
      password: 'guard-test-pw-123',
    });
    created.push(testInactive.id);
    ok('.test domain + active=false → stays false', testInactive.active === false);

    // (c) real domain + active=true → stays true
    const realUser = await svc.create({
      email: `guard-real-${stamp}@servifibras.com`,
      username: `guard_real_${stamp}`,
      name: 'Guard real',
      role: 'VENTAS',
      active: true,
      password: 'guard-test-pw-123',
    });
    created.push(realUser.id);
    ok('real (.com) domain + active=true → active=true', realUser.active === true);

    // (d) uppercase .TEST → still caught (lowercase normalization)
    const upperTest = await svc.create({
      email: `Guard-Upper-${stamp}@Servifibras.TEST`,
      username: `guard_upper_${stamp}`,
      name: 'Guard upper',
      role: 'ATENCION',
      active: true,
      password: 'guard-test-pw-123',
    });
    created.push(upperTest.id);
    ok('mixed-case .TEST → normalized + forced inactive', upperTest.active === false, `email=${upperTest.email} active=${upperTest.active}`);
    ok('email normalized to lowercase', upperTest.email === upperTest.email.toLowerCase());

    // (e) historical .test rows in prod are all inactive now
    const leftoverActive = await prisma.user.count({
      where: {
        active: true,
        email: { endsWith: '.test' },
      },
    });
    ok('no active .test users linger in prod', leftoverActive === 0, `count=${leftoverActive}`);
  } finally {
    if (created.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: created } } });
    }
  }

  await prisma.$disconnect();
  await app.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
