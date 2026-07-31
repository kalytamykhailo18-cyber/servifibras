// Marcos 2026-07-30: verifyHmac calculaba base64 y comparaba contra
// el header, pero TN venía firmando en HEX — 17.799 mismatches/día en
// el log (sólo warning, dispatchamos igual porque strict=off, pero
// impide activar strict-mode para bloquear webhooks forjados). El log
// de mismatch confirmaba: rcvd matcheaba exactamente computed-hex.
// Fix: aceptar hex O base64.
//
// Test corre el mismo verifyHmac sobre bodies + firmas conocidas.

const crypto = require('crypto');

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';
  process.env.HANDOFF_RECONCILE_ENABLED = 'false';

  const { TiendaNubeWebhookController } = require('/home/servifibras/backend/dist/src/infrastructure/modules/tiendanube/tiendanube-webhook.controller');

  const svc = { syncProduct: async () => {}, syncOrder: async () => {} };
  const ctrl = new TiendaNubeWebhookController(svc);

  const secret = 'test-secret-abc123';
  const body = Buffer.from(JSON.stringify({ event: 'product/updated', resource_id: 123 }));
  const hexSig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  const b64Sig = crypto.createHmac('sha256', secret).update(body).digest('base64');
  const wrongSig = crypto.createHmac('sha256', 'wrong').update(body).digest('hex');

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  // verifyHmac is private — access via prototype for the test.
  const verify = ctrl.verifyHmac.bind(ctrl);

  ok('accepts hex-encoded signature (TN\'s actual format)', verify(body, secret, hexSig));
  ok('accepts base64-encoded signature (legacy / other regions)', verify(body, secret, b64Sig));
  ok('rejects wrong secret', !verify(body, secret, wrongSig));
  ok('rejects empty signature', !verify(body, secret, ''));
  ok('rejects missing body', !verify(undefined, secret, hexSig));
  ok(
    'rejects tampered body (raw bytes mutated after signing)',
    !verify(Buffer.concat([body, Buffer.from('X')]), secret, hexSig),
  );

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
