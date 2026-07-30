// Marcos 2026-07-30: durante el outage del 07-28/07-29, Baileys se quedó
// más de 30 horas con status="starting" y ninguna reintento — la única
// forma de reactivar era un deploy manual. Root cause: cuando WA cambió
// de protocolo, el socket bootea, la conexión se cae con code=405, y
// después de unos ciclos start()/close() el socket queda referenciado
// pero no emite ningún evento nuevo. Sin un watchdog, la única señal
// era el silencio.
//
// Este test valida:
//   1. Watchdog detecta status transitorio (starting) que dura más que
//      WHATSAPP_QR_STARTING_TIMEOUT_MS y fuerza un hard reset + start().
//   2. Idempotencia: start() llamado con this.sock ya seteado y
//      this.status='starting' NO crea un socket huérfano; devuelve el
//      estado actual.
//
// Ambos son fixes internos de la clase — usamos el service directamente
// sin bootear Baileys real (mockeamos el proceso de start).

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'true';
  process.env.WHATSAPP_QR_STARTING_TIMEOUT_MS = '500';    // watchdog reacts fast in test
  process.env.WHATSAPP_QR_WATCHDOG_INTERVAL_MS = '100';
  process.env.WHATSAPP_QR_SESSION_DIR = '/tmp/servifibras-test-wa-session-' + process.pid;
  process.env.HANDOFF_RECONCILE_ENABLED = 'false';

  const { WhatsappQrService } = require('/home/servifibras/backend/dist/src/adapters/whatsapp-qr/whatsapp-qr.service');

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // Build the service directly — no Nest context needed since the fix
  // is pure private-state logic.
  const svc = new WhatsappQrService(undefined, undefined);

  // (1) Idempotency: simulate a socket in-flight and a stray start() call
  let startCallCount = 0;
  const stubStart = async () => {
    startCallCount++;
    return { ok: true, status: 'starting' };
  };
  // Prime the internal state as if we already started
  svc.sock = { end: () => {}, logout: async () => {} }; // pretend a socket exists
  svc.status = 'starting';

  // Manually invoke the public `start()`. With the fix, it should
  // early-return without booting a new socket.
  const preSock = svc.sock;
  const r = await svc.start();
  ok(
    'start() while status=starting + sock present → early return, no new socket',
    svc.sock === preSock && r.ok === true,
    `sock changed=${svc.sock !== preSock}, ok=${r.ok}`,
  );

  // (2) Watchdog: prime a transient state, wait past the timeout, ensure
  // the watchdog forces a hard reset. We can't easily assert start()
  // was re-called (that would boot Baileys), so instead we assert
  // that after > startingTimeoutMs, transientSince was reset — the
  // internal signal that watchdogTick fired hardResetAndRestart.
  svc.status = 'starting';
  svc.transientSince = Date.now() - 2000; // pretend we've been stuck 2s (> 500ms threshold)
  // Replace hardResetAndRestart so it does NOT actually try to open Baileys
  let hardResetCalled = 0;
  svc.hardResetAndRestart = async () => { hardResetCalled++; };
  svc.startWatchdog();

  // Wait long enough for at least one watchdog tick (interval=100ms).
  await new Promise((r) => setTimeout(r, 300));

  ok(
    'watchdog fires hard-reset after > WHATSAPP_QR_STARTING_TIMEOUT_MS in transient state',
    hardResetCalled >= 1,
    `hardResetCalled=${hardResetCalled}`,
  );

  // (3) Watchdog does NOT fire when status is stable (connected / disconnected).
  hardResetCalled = 0;
  svc.status = 'connected';
  svc.transientSince = null;
  await new Promise((r) => setTimeout(r, 300));
  ok(
    'watchdog is a no-op while status=connected',
    hardResetCalled === 0,
    `hardResetCalled=${hardResetCalled}`,
  );

  // (4) After a stable window, transientSince resets — so a NEW stuck
  // window has to accumulate its own timeout, not inherit the old one.
  svc.status = 'starting';
  svc.transientSince = null; // fresh entry into starting
  await new Promise((r) => setTimeout(r, 150)); // less than 500ms threshold
  ok(
    'watchdog does not fire within threshold from a fresh transient entry',
    hardResetCalled === 0,
    `hardResetCalled=${hardResetCalled}`,
  );

  // Cleanup
  if (svc.watchdogTimer) {
    clearInterval(svc.watchdogTimer);
    svc.watchdogTimer = null;
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
