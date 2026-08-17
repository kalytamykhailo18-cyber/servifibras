// Serial runner. Loads acceptance-cases, runs each case, freezes on
// fail. Reports per-turn / per-assert. Fresh conversation between cases.

const runner = require('./_agent-suite-runner');
const cases = require('./_agent-suite-cases');

const ONLY = (process.env.E2E_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
const STOP_ON_FAIL = (process.env.E2E_STOP_ON_FAIL || 'true').toLowerCase() !== 'false';

(async () => {
  const browser = await runner.chromium.launch({ headless: true });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  PAGEERROR: ${e.message}`));

  try {
    console.log('[login]');
    await runner.login(page);
    console.log('[open sandbox]');
    await runner.openSandbox(page);

    const results = [];
    for (const c of cases) {
      if (ONLY.length > 0 && !ONLY.includes(c.id)) continue;
      console.log(`\n\n============ ${c.id} — ${c.title} ============`);
      await runner.switchChannel(page, c.channel).catch(() => {});
      await runner.newConversation(page);

      let caseAllPass = true;
      const turnResults = [];
      for (let ti = 0; ti < c.turns.length; ti++) {
        const turn = c.turns[ti];
        console.log(`\n[T${ti + 1}] ${turn.customer}`);
        const t0 = Date.now();
        const { arrived, reply } = await runner.runSingleTurnCase(page, turn.customer).catch((e) => ({ arrived: false, reply: null, error: e.message }));
        const ms = Date.now() - t0;
        if (!arrived) {
          console.log(`  ✗ NO REPLY (${ms}ms)`);
          caseAllPass = false;
          turnResults.push({ ti, arrived: false, reply: null, asserts: [] });
          break;
        }
        console.log(`  → ${(reply || '').replace(/\n/g, ' | ').slice(0, 220)}${(reply || '').length > 220 ? '…' : ''}`);
        const assertResults = [];
        for (const a of turn.asserts) {
          let pass;
          try { pass = !!a.fn(reply || ''); } catch { pass = false; }
          console.log(`    ${pass ? '✓' : '✗'} ${a.name}`);
          assertResults.push({ name: a.name, pass });
          if (!pass) caseAllPass = false;
        }
        turnResults.push({ ti, arrived: true, reply, ms, asserts: assertResults });
      }
      results.push({ id: c.id, title: c.title, pass: caseAllPass, turns: turnResults });
      if (!caseAllPass && STOP_ON_FAIL) {
        console.log(`\n\n>>>>>> FREEZE on ${c.id} — see failed asserts above. Fix + re-run. <<<<<<`);
        await page.screenshot({ path: `/tmp/e2e-fail-${c.id}.png`, fullPage: true }).catch(() => {});
        console.log(`Screenshot: /tmp/e2e-fail-${c.id}.png`);
        break;
      }
    }

    const total = results.length;
    const passed = results.filter((r) => r.pass).length;
    const failed = total - passed;
    console.log(`\n\n============ SUMMARY ============`);
    console.log(`${passed}/${total} passed`);
    if (failed > 0) {
      console.log(`\nFAILED:`);
      for (const r of results.filter((x) => !x.pass)) {
        console.log(`  - ${r.id} ${r.title}`);
      }
    }
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('RUN ERROR:', err.message);
    await page.screenshot({ path: '/tmp/e2e-crash.png', fullPage: true }).catch(() => {});
    process.exit(2);
  } finally {
    await browser.close();
  }
})();
