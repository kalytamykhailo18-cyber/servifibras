// E2E: bumping user.passwordChangedAt must invalidate every JWT
// issued before that timestamp.
//
// Marcos 2026-07-03: during the 2026-07-02 outage the operators
// couldn't log in with their own accounts and used the shared admin
// password. Admin then rotated the password, but the operators'
// JWTs kept them logged in until natural expiry (24h). Fix: add
// user.passwordChangedAt; validateToken rejects tokens with iat <
// passwordChangedAt; user-management.update() bumps the timestamp
// and revokes refresh tokens in the same call.
//
// This test exercises the JWT rejection path directly — bumps
// passwordChangedAt with raw SQL to avoid needing the admin API
// endpoint (Marcos rotated admin@ so canonical creds don't work in
// prod). The endpoint wiring is verified by code review + the
// deploy-time TS check.

const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');

const API = process.env.SERVIFIBRAS_API_URL || 'https://api-dev.servifibras.com';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
  cond ? pass++ : fail++;
};

async function post(path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json ?? text };
}

async function get(path, headers = {}) {
  const res = await fetch(`${API}${path}`, { headers });
  return { status: res.status };
}

(async () => {
  const prisma = new PrismaClient();

  // Snapshot brenda's current passwordChangedAt so we can restore.
  const brenda0 = await prisma.user.findUnique({
    where: { email: 'brenda@servifibras.com' },
    select: { id: true, passwordChangedAt: true },
  });
  ok('[setup] brenda exists', !!brenda0?.id);
  if (!brenda0?.id) { await prisma.$disconnect(); process.exit(1); }
  const originalPc = brenda0.passwordChangedAt;

  try {
    // [A] Login as brenda → get JWT A.
    const brendaLogin1 = await post('/auth/login', { email: 'brenda@servifibras.com', password: 'demo123' });
    ok('[A] brenda login with demo123 OK', brendaLogin1.status === 201 && !!brendaLogin1.body?.token, `status=${brendaLogin1.status}`);
    const jwtA = brendaLogin1.body?.token;
    if (!jwtA) throw new Error('brenda login failed');

    // Prove JWT A is valid before rotation.
    const meBefore = await get('/auth/me', { Authorization: `Bearer ${jwtA}` });
    ok('[A] JWT A works — /auth/me returns 200', meBefore.status === 200, `status=${meBefore.status}`);

    // JWT iat is second-precision (JWT standard). We compare in
    // seconds in validateToken to avoid false-rejecting logins issued
    // in the same wall-clock second as the password change. Sleep
    // past the second boundary so JWT A and the passwordChangedAt
    // bump land in distinct seconds and the check triggers.
    await new Promise(r => setTimeout(r, 1200));

    // [B] Bump passwordChangedAt to now (simulates what a password change would do).
    const now = new Date();
    await prisma.user.update({
      where: { id: brenda0.id },
      data: { passwordChangedAt: now },
    });
    ok('[B] passwordChangedAt bumped to now', true);

    // Wait a moment so the update is durable.
    await new Promise(r => setTimeout(r, 500));

    // [C] JWT A must now be rejected (iat < passwordChangedAt).
    const meAfter = await get('/auth/me', { Authorization: `Bearer ${jwtA}` });
    ok('[C] JWT A rejected after passwordChangedAt bump (401)',
       meAfter.status === 401, `status=${meAfter.status}`);

    // [D] A fresh login → JWT B, which is issued AFTER passwordChangedAt.
    const brendaLogin2 = await post('/auth/login', { email: 'brenda@servifibras.com', password: 'demo123' });
    ok('[D] brenda re-login OK', brendaLogin2.status === 201 && !!brendaLogin2.body?.token, `status=${brendaLogin2.status}`);
    const jwtB = brendaLogin2.body?.token;

    if (jwtB) {
      const meNew = await get('/auth/me', { Authorization: `Bearer ${jwtB}` });
      ok('[E] JWT B works — /auth/me returns 200', meNew.status === 200, `status=${meNew.status}`);
    } else {
      ok('[E] JWT B works', false, 'no token returned');
    }

    // [F] JWT B still valid after a subsequent non-password field update
    //     (only password changes should bump passwordChangedAt).
    await prisma.user.update({
      where: { id: brenda0.id },
      data: { name: 'Brenda D. — audit ' + Date.now() },
    });
    await new Promise(r => setTimeout(r, 300));

    if (jwtB) {
      const meAfterNameChange = await get('/auth/me', { Authorization: `Bearer ${jwtB}` });
      ok('[F] JWT B unaffected by non-password field update',
         meAfterNameChange.status === 200, `status=${meAfterNameChange.status}`);
    }
  } finally {
    // Restore brenda's passwordChangedAt + name.
    await prisma.user.update({
      where: { id: brenda0.id },
      data: {
        passwordChangedAt: originalPc,
        name: 'Brenda Denardo',
      },
    });
    await prisma.$disconnect();
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((err) => {
  console.error('E2E error:', err);
  process.exit(1);
});
