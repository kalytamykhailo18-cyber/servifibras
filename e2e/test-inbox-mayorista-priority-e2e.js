// E2E: mayoristas al tope del inbox (Marcos 2026-07-06 PM).
//
// Verifica que listConversations en el primer page (offset=0) devuelve
// primero las conversaciones cuyo contact.type='MAYORISTA' O
// contact.customerType='MAYORISTA', y recién después las no-mayoristas
// (ambos grupos ordenados por recencia adentro).
//
// Test-safe: no modifica datos. Sólo lee.

async function main() {
  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { ConversationManagementService } = require('/home/servifibras/backend/dist/src/adapters/admin/conversation-management.service');
  const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const svc = app.get(ConversationManagementService);
  const prisma = new PrismaClient();

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // First, confirm there are mayorista convs available in the DB.
  const mayoristaCount = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n
    FROM conversations c JOIN contacts co ON co.id = c."contactId"
    WHERE c."isSandbox" = false
      AND (co.type = 'MAYORISTA' OR co."customerType" = 'MAYORISTA')
  `);
  ok('DB has at least 1 mayorista conversation', mayoristaCount[0].n > 0, `total=${mayoristaCount[0].n}`);

  if (mayoristaCount[0].n === 0) {
    await prisma.$disconnect();
    await app.close();
    console.log(`\n=== ${pass} passed, ${fail} failed (nothing to test) ===`);
    process.exit(fail > 0 ? 1 : 0);
  }

  // Call listConversations first page.
  const res = await svc.listConversations({ limit: 20, offset: 0 });
  const rows = res?.conversations ?? res?.data ?? [];
  ok('listConversations returned rows', rows.length > 0, `count=${rows.length}`);

  const isMayorista = (r) => {
    const co = r.contact;
    if (!co) return false;
    return co.type === 'MAYORISTA' || co.customerType === 'MAYORISTA';
  };

  // Find the boundary: how many mayoristas at the top?
  let mayoristaPrefix = 0;
  for (const r of rows) {
    if (!isMayorista(r)) break;
    mayoristaPrefix++;
  }
  ok('page 1 leads with at least 1 mayorista', mayoristaPrefix > 0, `prefix=${mayoristaPrefix}`);

  // After the mayorista prefix, no more mayoristas in this page.
  const hasMayoristaAfterPrefix = rows.slice(mayoristaPrefix).some(isMayorista);
  ok('no mayoristas mixed in after the prefix (proper partitioning)', !hasMayoristaAfterPrefix);

  // Recency ordering INSIDE the mayorista block.
  const mayoristaRows = rows.slice(0, mayoristaPrefix);
  const recencyOrdered = mayoristaRows.every((r, i) => {
    if (i === 0) return true;
    return new Date(mayoristaRows[i - 1].updatedAt).getTime() >= new Date(r.updatedAt).getTime();
  });
  ok('mayoristas sorted by recency internally', recencyOrdered);

  console.log(`\n  → summary: page 1 = ${mayoristaPrefix} mayoristas + ${rows.length - mayoristaPrefix} others`);

  await prisma.$disconnect();
  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
