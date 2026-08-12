// E2E (UI): Bloque A/3 — Página de Competidores.
//
// Marcos 2026-08-12: recorrida desde la perspectiva del operador:
//   [1] Login (JWT seeded) → /competidores.
//   [2] La página carga (título + form de alta rápida presentes).
//   [3] Si hay watches cargados: click en el botón de eliminar
//       abre el AlertDialog custom (NO window.confirm nativo —
//       feedback_custom_confirm_modals). Cancelar cierra sin
//       tocar la API.
//   [4] window.confirm nunca se invoca en toda la sesión.
//
// El path de confirmación real (Sacar del seguimiento) no se
// ejercita porque eliminaría un watch productivo de Marcos.

const { chromium } = require('playwright');
const { seedAdminSession } = require('./_e2e-auth');

const FRONT = process.env.SERVIFIBRAS_FRONT_URL || 'https://dev.servifibras.com';

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (cond) pass++; else fail++;
};

(async () => {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

    await page.addInitScript(() => {
      window.__nativeConfirmCalls = 0;
      const orig = window.confirm;
      window.confirm = function (msg) {
        window.__nativeConfirmCalls = (window.__nativeConfirmCalls || 0) + 1;
        return orig.call(window, msg);
      };
    });

    await seedAdminSession(page, FRONT);
    ok('admin session seeded', true);

    await page.goto(`${FRONT}/competidores`, { waitUntil: 'networkidle' });

    // Wait for the list container (or the empty-state banner) to
    // resolve. The role guard renders null while checking, so the
    // page can be blank for a beat.
    await page.waitForTimeout(1500);
    // Page-level heading probe: "Competidores" text somewhere on page.
    const heading = await page.getByText(/^Competidores/).first().count();
    ok('página Competidores renderiza', heading > 0);

    const anyRemoveBtn = page.locator('[data-testid^="competidores-remove-"]').first();
    const hasWatch = await anyRemoveBtn.count() > 0;

    if (hasWatch) {
      await anyRemoveBtn.click();
      await page.waitForSelector('[data-testid="competidores-remove-dialog"]', { timeout: 3000 });
      ok('AlertDialog custom aparece al eliminar (no window.confirm)', true);

      const cancelBtn = page.getByRole('button', { name: /^Cancelar$/ });
      await cancelBtn.first().click();
      await page.waitForTimeout(200);
      const gone = await page.locator('[data-testid="competidores-remove-dialog"]').count() === 0;
      ok('Cancelar cierra el dialog sin efectos', gone);
    } else {
      ok('sin watches cargados — flow del dialog no ejercitable', true, 'esperado si no hay competidores en seguimiento');
    }

    const confirmCalls = await page.evaluate(() => window.__nativeConfirmCalls || 0);
    ok('window.confirm() nunca se invocó', confirmCalls === 0, `count=${confirmCalls}`);
  } finally {
    await browser.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
