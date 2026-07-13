// A1 (documento de trabajo 2026-07-10): en canal MercadoLibre, el
// agente NUNCA debe emitir teléfono/WhatsApp/email/dirección exacta.
// Antes la defensa era una regex específica de Buenos Aires (área 11);
// una área distinta o un número dígito-por-dígito se colaba.
//
// Criterio de aceptación del documento:
//   "Batería de ≥ 15 preguntas que intenten sacar contacto, variando
//    formato: 0 filtraciones, como test automático."

async function main() {
  process.env.WHATSAPP_QR_ENABLED = 'false';

  const path = require('path');
  const { NestFactory } = require(path.join('/home/servifibras/backend/node_modules/@nestjs/core'));
  const { AppModule } = require('/home/servifibras/backend/dist/src/app.module');
  const { ClaudeService } = require('/home/servifibras/backend/dist/src/adapters/ai/claude.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const claude = app.get(ClaudeService);

  let pass = 0, fail = 0;
  const ok = (label, cond, extra = '') => {
    console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
    cond ? pass++ : fail++;
  };

  const scrub = (text) => claude['dropFabricatedUrls'](text, 'MERCADOLIBRE');

  // Battery of 15+ phrasings the agent might emit and that should ALL
  // be scrubbed to zero contact leakage before landing on ML.
  const attempts = [
    // Argentina Buenos Aires (already covered pre-A1).
    'Escribinos al +54 9 11 3588 0083',
    'llamanos al 11 3588 0083',
    // Other AR area codes (NEW under A1).
    'llamanos al +54 351 5551234',    // Córdoba
    'contactanos al 341 5551234',      // Rosario
    'nuestro cel es 261 5551234',      // Mendoza
    'marcá 381 5551234',                // Tucumán
    'nuestro numero es 3814448899',    // Tucumán glued
    // Spaced digit-by-digit (NEW under A1).
    'nuestro numero es 1 1 3 5 8 8 0 0 8 3',
    'anotalo: 5 4 9 1 1 3 5 8 8 0 0 8 3',
    'escribinos al 5 4 9 1 1 3 5 8 8 0 0 8 3',
    // Email + external domain (already covered pre-A1).
    'mandanos un mail a hola@servifibras.com',
    'buscanos en servifibras.com',
    'buscá tiendaservifibras.com.ar',
    'nuestro email es info@servifibras.com.ar',
    // Bare WhatsApp mention (already covered pre-A1).
    'preguntanos por whatsapp',
    'te respondemos por WhatsApp',
    // Exact street (already covered).
    'venite a Martín de Álzaga 3634',
  ];

  let leaked = 0;
  const leaks = [];
  for (const phrase of attempts) {
    const out = scrub(phrase).text;
    // Any digit-heavy string (7+ digits) or any *external* domain/email
    // suffix reaching the output is a leak. (Note: replacements like
    // "[contacto fuera...]" have zero digits, so they're safe.)
    const remainingDigits = (out.match(/\d/g) ?? []).length;
    const hasEmail = /@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(out);
    const hasBareServifibras = /\bservifibras\.com/i.test(out) && !out.includes('perfil de tienda');
    const hasWhatsappWord = /\bwhats?\s*app\b/i.test(out);
    const isLeak = remainingDigits >= 7 || hasEmail || hasBareServifibras || hasWhatsappWord;
    if (isLeak) {
      leaked++;
      leaks.push(`  ${phrase.slice(0,55)}  →  ${out.slice(0,80)}`);
    }
  }

  ok(
    `battery of ${attempts.length} attempts — zero contact leaks land on ML`,
    leaked === 0,
    leaked === 0 ? 'all scrubbed' : `${leaked} leaked:\n${leaks.join('\n')}`,
  );
  ok(
    'battery covered ≥ 15 phrasings',
    attempts.length >= 15,
    `n=${attempts.length}`,
  );

  await app.close();

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
