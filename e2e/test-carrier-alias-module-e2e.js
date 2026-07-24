// Marcos 2026-07-24: módulo alias de mensajerías. Cubre:
//   1) alias exacto override hardcoded rules
//   2) alias inactivo NO override
//   3) cache invalidation en create/update/delete
//   4) match case-insensitive
//   5) alias sin match → hardcoded rules aplican

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';
  process.env.HANDOFF_RECONCILE_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { CarrierAliasService } = require('/home/servifibras/backend/dist/src/adapters/admin/carrier-alias.service');
  const { normaliseCarrier } = require('/home/servifibras/backend/dist/src/adapters/admin/carrier-normalize.util');
  const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const svc = app.get(CarrierAliasService);
  const prisma = new PrismaClient();

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' - ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  const stamp = Date.now();
  const rawX = `RarePattern${stamp}`;
  const rawY = `AnotherOne${stamp}`;
  const created = [];

  try {
    // Baseline: sin alias, RarePattern cae al title-case fallback
    const baseline = normaliseCarrier(rawX);
    ok(`baseline (no alias): "${rawX}" title-cased`, baseline === rawX.charAt(0).toUpperCase() + rawX.slice(1).toLowerCase(), `got=${baseline}`);

    // (1) crear alias activo → override
    const a = await svc.create({ rawPattern: rawX, mappedName: 'JyJ', active: true }, null);
    created.push(a.id);
    const map1 = await svc.getMap();
    const r1 = normaliseCarrier(rawX, map1);
    ok('alias activo override → JyJ', r1 === 'JyJ', `got=${r1}`);

    // (2) case-insensitive match
    const r2 = normaliseCarrier(rawX.toUpperCase(), map1);
    ok('alias case-insensitive', r2 === 'JyJ', `got=${r2}`);
    const r3 = normaliseCarrier(`  ${rawX.toLowerCase()}  `, map1);
    ok('alias tolerante a espacios', r3 === 'JyJ', `got=${r3}`);

    // (3) alias diferente para otra key
    const b = await svc.create({ rawPattern: rawY, mappedName: 'Andreani', active: true }, null);
    created.push(b.id);
    const map2 = await svc.getMap();
    ok(`segundo alias: "${rawY}" → Andreani`, normaliseCarrier(rawY, map2) === 'Andreani');
    ok('primer alias sigue funcionando en el mismo map', normaliseCarrier(rawX, map2) === 'JyJ');

    // (4) alias sin match → hardcoded rules
    ok('sin match cae a hardcoded (Andreani raw → Andreani)', normaliseCarrier('Andreani', map2) === 'Andreani');
    ok('sin match cae a hardcoded (JYJ raw → JyJ)', normaliseCarrier('JYJ', map2) === 'JyJ');
    ok('sin match cae a Sin asignar para GBA descriptor', normaliseCarrier('GBA 1 GRATIS', map2) === 'Sin asignar');

    // (5) update: cambio mappedName
    await svc.update(a.id, { mappedName: 'Baires' });
    const map3 = await svc.getMap();
    ok('update: alias apunta a Baires ahora', normaliseCarrier(rawX, map3) === 'Baires', `got=${normaliseCarrier(rawX, map3)}`);

    // (6) desactivar: getMap() sólo trae activos
    await svc.update(a.id, { active: false });
    const map4 = await svc.getMap();
    ok('alias desactivado desaparece del map', !map4.has(rawX.toLowerCase()));
    // Sin alias en el map → normalizer cae al hardcoded/title-case
    ok('normaliza sin alias → title-case', normaliseCarrier(rawX, map4) === rawX.charAt(0).toUpperCase() + rawX.slice(1).toLowerCase());

    // (7) remove: mismo efecto que desactivar
    await svc.remove(b.id);
    const map5 = await svc.getMap();
    ok('remove: entrada eliminada del map', !map5.has(rawY.toLowerCase()));
  } finally {
    for (const id of created) {
      try { await prisma.carrierAlias.delete({ where: { id } }); } catch { /* ok, may already be deleted */ }
    }
  }

  await prisma.$disconnect();
  await app.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
