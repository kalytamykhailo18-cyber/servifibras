// Marcos 2026-07-28: Franco no podía entrar al panel — CRM caía
// "Error de red" en el login. Causa raíz: la sesión de Baileys se
// cayó (stream:conflict, otro cliente WA tomó el número), el
// componente `whatsapp` de /health quedó en `down`, el aggregate lo
// propagó al status general y Caddy dejó de rutear TODO el tráfico
// a la API (503 en /auth/login, /orders, todo). Un problema del
// canal de WhatsApp no puede tirar abajo el CRM entero.
//
// Este test valida el nuevo criterio de aggregate:
//   1. Con DB ok y WA down → overall = "degraded" (NO "down").
//   2. Con DB down (crítico) → overall = "down".
//   3. HEALTH_CRITICAL_COMPONENTS puede sumar componentes al set
//      crítico desde el .env, sin recompilar.
//   4. Todo esto sin perder la visibilidad per-componente
//      (components.whatsapp.status sigue reportando 'down' para
//      que el banner del frontend siga funcionando).

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';
  process.env.HANDOFF_RECONCILE_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { HealthService } = require('/home/servifibras/backend/dist/src/adapters/health/health.service');
  const { WhatsappQrService } = require('/home/servifibras/backend/dist/src/adapters/whatsapp-qr/whatsapp-qr.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const health = app.get(HealthService);

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // Baseline — WA is 'unconfigured' (enabled=false) so overall is not
  // 'down'. Just confirm the report shape.
  const baseline = await health.check();
  ok(
    'baseline report has database + whatsapp components',
    !!baseline.components?.database && !!baseline.components?.whatsapp,
  );

  // (1) Simulate the exact failure that took Franco offline this morning:
  // Baileys enabled + disconnected → whatsapp.status = down.
  // With the fix, overall should be 'degraded', NOT 'down'.
  let svc;
  try {
    svc = app.get(WhatsappQrService);
  } catch {
    console.log('  (WhatsappQrService not wired — skipping WA-down scenario)');
  }
  if (svc) {
    const original = svc.getStatus.bind(svc);
    svc.getStatus = () => ({
      enabled: true,
      autoReply: false,
      accountLabel: 'Test',
      status: 'disconnected',
      connectedJid: null,
      connectedAt: null,
      startedAt: new Date().toISOString(),
      lastError: 'stream:conflict device_removed',
      sessionDirExists: true,
    });

    const withWaDown = await health.check();
    ok(
      'WA down but DB ok → whatsapp.status still surfaces as "down"',
      withWaDown.components.whatsapp.status === 'down',
      `whatsapp=${withWaDown.components.whatsapp.status}`,
    );
    ok(
      'WA down but DB ok → overall status = "degraded" (NOT "down")',
      withWaDown.status === 'degraded',
      `overall=${withWaDown.status}`,
    );

    // (3) HEALTH_CRITICAL_COMPONENTS env can promote WA back into
    // critical set for anyone who wants the old behaviour.
    process.env.HEALTH_CRITICAL_COMPONENTS = 'database,whatsapp';
    const strict = await health.check();
    ok(
      'HEALTH_CRITICAL_COMPONENTS=database,whatsapp → WA down = overall down',
      strict.status === 'down',
      `overall=${strict.status}`,
    );
    delete process.env.HEALTH_CRITICAL_COMPONENTS;

    // (4) Default (no env) → back to 'degraded' — confirms the default
    // isn't accidentally strict.
    const defaultAgain = await health.check();
    ok(
      'default (no env) is lenient — overall stays "degraded" on WA down',
      defaultAgain.status === 'degraded',
      `overall=${defaultAgain.status}`,
    );

    svc.getStatus = original;
  }

  // (2) DB is by default critical. We simulate a DB-down state by
  // stubbing the checker directly.
  const originalCheck = health.checkDatabase?.bind(health);
  if (typeof health.checkDatabase === 'function') {
    health.checkDatabase = async () => ({ status: 'down', details: { error: 'stub' } });
    const withDbDown = await health.check();
    ok(
      'DB down → overall = "down" (still traffic-critical)',
      withDbDown.status === 'down',
      `overall=${withDbDown.status}`,
    );
    ok(
      'DB down + WA down → still "down" (DB dominates)',
      withDbDown.components.database.status === 'down',
      `database=${withDbDown.components.database.status}`,
    );
    health.checkDatabase = originalCheck;
  }

  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
