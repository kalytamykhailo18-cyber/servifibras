// Marcos 2026-07-18: /health ahora reporta el estado del canal
// WhatsApp (Baileys QR). Sin este check, la CRM podía quedar 48h
// sin ingesta de WA sin que nadie viera nada — ya pasó dos veces
// (viernes-lunes hace dos semanas, y anoche 07-16/07-17/07-18).
// Este test valida:
//   1. GET /health devuelve components.whatsapp
//   2. Cuando WHATSAPP_QR_ENABLED=false → status = unconfigured
//   3. Cuando WHATSAPP_QR_ENABLED=true y el socket está caído →
//      status = down (o degraded si está reconectando)
//   4. El estado de conexión (connectionStatus) viaja en details
//      para que el frontend pueda mostrarlo en el banner

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { HealthService } = require('/home/servifibras/backend/dist/src/adapters/health/health.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const health = app.get(HealthService);

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // (1) health check surfaces the whatsapp component
  const report = await health.check();
  ok('health report has components.whatsapp', report.components?.whatsapp !== undefined);

  const wa = report.components.whatsapp;

  // (2) With WHATSAPP_QR_ENABLED=false (this test sets it) status must
  // be unconfigured — we don't want a green cert-lookalike when the
  // channel is intentionally off.
  ok(
    'unconfigured when WHATSAPP_QR_ENABLED=false',
    wa.status === 'unconfigured',
    `status=${wa.status}`,
  );

  // (3) details.reason exposes why so the banner can tell the operator
  // "channel disabled" vs "session closed" vs "starting".
  ok(
    'details present on unconfigured branch',
    !!wa.details,
    JSON.stringify(wa.details ?? {}),
  );

  // (4) aggregate health does NOT go 'down' just because WA is
  // intentionally off — otherwise every non-QR deployment would page.
  ok(
    'aggregate stays ok/degraded, not down',
    report.status !== 'down',
    `aggregate=${report.status}`,
  );

  // (5) simulate an enabled-but-disconnected channel by monkey-patching
  // the injected service's getStatus. This is a test-side stub — the
  // real service would report the same shape when Baileys drops.
  const svc = (health)['whatsappQr'];
  if (svc) {
    const original = svc.getStatus.bind(svc);
    svc.getStatus = () => ({
      enabled: true,
      autoReply: false,
      accountLabel: 'Test',
      status: 'disconnected',
      connectedJid: null,
      connectedAt: null,
      startedAt: null,
      lastError: 'QR refs attempts ended',
      sessionDirExists: true,
    });
    const r2 = await health.check();
    ok(
      'enabled + disconnected → whatsapp.status = down',
      r2.components.whatsapp.status === 'down',
      `status=${r2.components.whatsapp.status}`,
    );
    ok(
      'connectionStatus surfaced in details for frontend banner',
      r2.components.whatsapp.details?.connectionStatus === 'disconnected',
      `details.connectionStatus=${r2.components.whatsapp.details?.connectionStatus}`,
    );
    ok(
      'lastError surfaced in details for operator visibility',
      r2.components.whatsapp.details?.lastError === 'QR refs attempts ended',
      `details.lastError=${r2.components.whatsapp.details?.lastError}`,
    );

    svc.getStatus = () => ({
      enabled: true,
      autoReply: false,
      accountLabel: 'Test',
      status: 'waiting_qr',
      connectedJid: null,
      connectedAt: null,
      startedAt: new Date().toISOString(),
      lastError: null,
      sessionDirExists: false,
    });
    const r3 = await health.check();
    ok(
      'enabled + waiting_qr → whatsapp.status = degraded',
      r3.components.whatsapp.status === 'degraded',
      `status=${r3.components.whatsapp.status}`,
    );

    svc.getStatus = original;
  } else {
    console.log('  (stub check skipped — WhatsappQrService not wired at test time)');
  }

  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
