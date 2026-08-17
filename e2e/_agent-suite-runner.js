// Servifibras Agent Acceptance Suite Runner — real user perspective.
// Playwright drives the CRM sandbox as an operator would: types
// customer messages in the chat box, presses Enter, reads the agent
// bubble that appears, runs assertions. One case at a time, freeze
// on fail (fix-before-advance protocol lives at the caller layer).

const { chromium } = require('/home/servifibras/e2e/node_modules/playwright');

const FRONT = process.env.SERVIFIBRAS_FRONT_URL || 'https://dev.servifibras.com';
const EMAIL = 'e2e-runner@servifibras.com';
const PASSWORD = 'e2e-runner-4x9k';

async function login(page) {
  await page.goto(`${FRONT}/login`, { waitUntil: 'networkidle' });
  await page.click('input#email');
  await page.type('input#email', EMAIL, { delay: 15 });
  await page.click('input#password');
  await page.type('input#password', PASSWORD, { delay: 15 });
  await Promise.all([
    page.waitForURL((u) => !/login/.test(u.toString()), { timeout: 20000 }),
    page.click('button[type="submit"]'),
  ]);
}

async function openSandbox(page) {
  // Real navigation: go to sandbox via URL (this replicates clicking
  // "Probar agente" in the sidebar — the frontend routes to /sandbox).
  await page.goto(`${FRONT}/sandbox`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="sandbox-input"]', { timeout: 15000 });
}

async function switchChannel(page, channel /* 'WEBCHAT' | 'MERCADOLIBRE' | 'INSTAGRAM' */) {
  const btn = page.locator(`[data-testid="sandbox-channel-${channel.toLowerCase()}"]`);
  if (await btn.count() === 0) throw new Error(`Channel tab not found: ${channel}`);
  await btn.click();
  await page.waitForTimeout(300);
}

async function newConversation(page) {
  const resetBtn = page.locator('[data-testid="sandbox-reset-btn"]');
  if (await resetBtn.count() === 0) return;
  // The reset button is `disabled` when the conversation is already
  // empty (fresh session with no history yet). Skip in that case —
  // there's nothing to reset. Only click when the button is enabled.
  const isDisabled = await resetBtn.isDisabled();
  if (isDisabled) return;
  await resetBtn.click();
  const confirm = page.locator('[data-testid="sandbox-reset-confirm"]');
  await confirm.waitFor({ timeout: 3000 });
  await confirm.click();
  await page.waitForTimeout(500);
}

async function sendMessage(page, text) {
  const input = page.locator('[data-testid="sandbox-input"]');
  await input.click();
  await input.fill(''); // clean slate
  await page.keyboard.type(text, { delay: 15 });
  // Prefer clicking send button (mimic operator); Enter would work too.
  const beforeCount = await page.locator('[data-testid="sandbox-agent-bubble"]').count();
  await page.click('[data-testid="sandbox-send-btn"]');
  return beforeCount;
}

async function waitForAgentReply(page, beforeCount, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const now = await page.locator('[data-testid="sandbox-agent-bubble"]').count();
    if (now > beforeCount) {
      // Give the DOM a moment to settle (streaming might still be adding characters)
      await page.waitForTimeout(400);
      return true;
    }
    await page.waitForTimeout(300);
  }
  return false;
}

async function readLatestAgentReply(page) {
  const bubbles = page.locator('[data-testid="sandbox-agent-bubble"]');
  const n = await bubbles.count();
  if (n === 0) return null;
  return await bubbles.nth(n - 1).innerText();
}

async function runSingleTurnCase(page, customerMsg) {
  const before = await sendMessage(page, customerMsg);
  const arrived = await waitForAgentReply(page, before);
  if (!arrived) return { arrived: false, reply: null };
  const reply = await readLatestAgentReply(page);
  return { arrived: true, reply };
}

module.exports = {
  login, openSandbox, switchChannel, newConversation,
  sendMessage, waitForAgentReply, readLatestAgentReply, runSingleTurnCase,
  FRONT, EMAIL, PASSWORD, chromium,
};
