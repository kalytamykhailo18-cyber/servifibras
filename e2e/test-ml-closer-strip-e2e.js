// E2E: ML agent must never close with "Quedo a disposición ..." / variants.
//
// Overnight audit 2026-07-02: ~5 of 20 ML replies closed with
// "Quedo a disposición ante cualquier otra duda." as filler final —
// despite rule 7 of the ML system prompt explicitly banning it. The
// prompt-level ban isn't enough on its own; the model emits the
// phrase anyway. Fix is a post-generation regex strip in
// claude.service.ts alongside the other "openers/closers" strips.

const { chromium } = require('playwright');

const FRONT = process.env.SERVIFIBRAS_FRONT_URL || 'https://dev.servifibras.com';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
  cond ? pass++ : fail++;
};

async function loginUi(page) {
  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' });
  await page.fill('input#email', 'admin@servifibras.com');
  await page.fill('input#password', 'admin123');
  await Promise.all([
    page.waitForURL((u) => !/login/.test(u.toString()), { timeout: 20_000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState('networkidle');
}

async function clearSandbox(page) {
  const r = page.locator('[data-testid="sandbox-reset-btn"]');
  if (await r.count() && !(await r.isDisabled())) {
    await r.click().catch(() => {});
    await page.waitForTimeout(400);
    const c = page.locator('[data-testid="sandbox-reset-confirm"]');
    if (await c.count()) { await c.click().catch(() => {}); await page.waitForTimeout(1500); }
  }
}

async function send(page, text) {
  const sel = '[data-testid="sandbox-agent-bubble"]';
  const before = await page.locator(sel).count();
  await page.locator('[data-testid="sandbox-input"]').fill(text);
  await page.locator('[data-testid="sandbox-send-btn"]').click();
  await page.waitForFunction(({ before, sel }) => document.querySelectorAll(sel).length > before, { before, sel }, { timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(800);
  const b = page.locator(sel);
  const total = await b.count();
  if (!total) return '';
  return ((await b.nth(total - 1).innerText()) || '').trim().replace(/^AGENTE\s*\n\s*[·•]\s*\n\s*\d{1,2}:\d{2}\s*\n+/i, '').trim();
}

const banned = /Quedo\s+a\s+(?:tu\s+)?disposici[oó]n|Quedamos\s+a\s+(?:tu\s+)?disposici[oó]n|Estoy\s+a\s+(?:tu\s+)?disposici[oó]n|Ante\s+cualquier\s+(?:otra\s+)?(?:duda|consulta|pregunta)[^.!?\n]*(?:qued|est|escr|avis|consult)/i;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(`${e.name}: ${e.message}`));

  await loginUi(page);
  await page.goto(`${FRONT}/sandbox`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('[data-testid="sandbox-channel-mercadolibre"]').click();
  await page.waitForTimeout(700);

  const scenarios = [
    { name: 'link-share', q: '¿tenés paño de fibra de vidrio de 10 m²?' },
    { name: 'mold-clock', q: '¿este molde redondo de 30 cm sirve para hacer un reloj de pared?' },
    { name: 'nautica', q: '¿la resina náutica sirve para reparar un espejo de lancha?' },
    { name: 'random', q: '¿cuánto tiempo tarda en curar la resina?' },
  ];

  for (const s of scenarios) {
    await clearSandbox(page);
    console.log(`\n[${s.name}] driving "${s.q}"`);
    const r = await send(page, s.q);
    console.log(`    R: ${r.replace(/\n/g, ' ⏎ ').slice(0, 260)}`);
    ok(`[${s.name}] reply does NOT contain banned closer`, !banned.test(r), banned.test(r) ? 'HIT: ' + (r.match(banned) || [''])[0] : '');
  }

  if (errs.length) {
    console.log('\nPage errors:');
    errs.forEach((e) => console.log('  ' + e));
    fail += errs.length;
  } else {
    ok('no page errors observed', true);
  }
  await browser.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
