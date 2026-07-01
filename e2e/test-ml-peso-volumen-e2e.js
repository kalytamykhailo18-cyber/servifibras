// E2E: ML agent must NOT claim a 1:1 volume-ratio resin is also 1:1 by weight
//
// Marcos 2026-07-01, publicación MLA2736866806
// (Resina Cristal Epoxi 2 Unidades De 500ml Mezcla 1 A 1):
// Comprador OSCAREDUARDOHUNZIKER preguntó "está resina es en
// proporción 1 a 1 en peso ?". El agente respondió "Exacto, 1 a 1 en
// volumen — 500 ml de Parte A + 500 ml de Parte B. Si lo querés en
// peso, los dos componentes pesan prácticamente lo mismo
// (aproximadamente 1:1 también), así que para cálculos rápidos podés
// asumir que son equivalentes."
//
// Marcos: "Pregunta por peso, responde si pero en volumen. la resina
// es en volumen, pero el cliente preguntó EN PESO. esto debería
// saberlo, es básico!"
//
// Fix in claude.service.ts: added Noveno caso real declaring
// "1:1 volume ≠ 1:1 weight" as a factual rule.

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

  await clearSandbox(page);
  console.log('\n[peso-volumen] driving "está resina es en proporción 1 a 1 en peso?"');
  const r = await send(page, 'Hola! Que tal? Te consulto, está resina epoxi 1 a 1 500ml es en proporción 1 a 1 en peso?');
  console.log(`    R: ${r.replace(/\n/g, ' ⏎ ').slice(0, 400)}`);

  ok('[peso-volumen] reply mentions the proportion is EN VOLUMEN',
     /en\s+volumen|por\s+volumen|se\s+mide\s+en\s+volumen|especificad[oa]\s+en\s+volumen|proporci[óo]n[^.]{0,40}volumen/i.test(r));

  ok('[peso-volumen] reply does NOT claim "aproximadamente 1:1 también" / "prácticamente lo mismo" en peso',
     !/aproximadamente\s+1[:\s]*a?\s*1\s+tambi[eé]n|pr[aá]cticamente\s+(?:pesan\s+)?lo\s+mismo|pesan\s+pr[aá]cticamente\s+(?:lo\s+mismo|igual)|(?:cálculos?\s+rápidos?|para\s+c[aá]lculos)[^.]*equivalentes/i.test(r));

  ok('[peso-volumen] reply does NOT confirm the ratio holds in weight (any variant)',
     !/(?:en\s+peso|por\s+peso)[^.]{0,80}(?:1\s*[:.\s]*a?\s*1|tambi[eé]n\s+1[:\s]*a?\s*1|proporci[óo]n\s+1[:\s]*a?\s*1|igual|equivalent)/i.test(r)
     || /(?:en\s+peso|por\s+peso)[^.]{0,100}(?:no\s+es\s+1[:\s]*a?\s*1|no\s+es\s+equivalent|no\s+se\s+aplica|no\s+se\s+cumple|no\s+coincide|densidad(?:es)?\s+distint|densidad(?:es)?\s+diferent)/i.test(r));

  ok('[peso-volumen] reply mentions weight-ratio disclaimer (densidades / no equivalente / no 1:1 en peso)',
     /densidad(?:es)?\s+(?:distint|diferent)|no\s+es\s+1[:\s]*a?\s*1\s+en\s+peso|en\s+peso\s+no\s+(?:es|se|coincide|aplica|equival)|no\s+es\s+equivalent\s+en\s+peso|mezclá(?:la)?\s+(?:por|en|con)\s+volumen|(?:vasos?|jeringas?)\s+medidor/i.test(r));

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
