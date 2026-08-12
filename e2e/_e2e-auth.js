// E2E auth helper — Marcos 2026-08-12: la password del admin real ya
// no es admin123 (fue rotada en prod) así que el patrón `login(page,
// 'admin@servifibras.com', 'admin123')` que usan los tests viejos
// devuelve 401 en toda la sweep desde entonces (21/166 pasan por eso).
// Este helper minta directamente un JWT firmado con el mismo secret
// del backend + siembra localStorage + zustand persist así los tests
// UI arrancan sesionados sin necesidad de conocer la contraseña real.
//
// Uso:
//   const { seedAdminSession } = require('./_e2e-auth');
//   const page = await ctx.newPage();
//   await seedAdminSession(page, FRONT);
//   await page.goto(`${FRONT}/conversations`);   // ya logueado
//
// Notas:
//  - Sólo funciona si el proceso corre en la VPS con acceso al
//    backend/.env (para JWT_SECRET) y a la DB (para userId real).
//  - El JWT tiene la vida corta configurada por JWT_EXPIRES_IN (15m
//    default) — suficiente para tests unitarios de UI.
//  - No genera refresh token — el frontend sólo lo pide en 401, y
//    los tests corren < 15m.

const fs = require('fs');
const path = require('path');
const jwt = require('/home/servifibras/backend/node_modules/jsonwebtoken');

// Load backend/.env so DATABASE_URL / JWT_SECRET are available even when
// the caller didn't source it — run-all.sh does, but ad-hoc `node
// test-x.js` invocations don't. Idempotent: doesn't clobber values that
// process.env already has.
(function loadBackendEnv() {
  try {
    const raw = fs.readFileSync('/home/servifibras/backend/.env', 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (!m) continue;
      const [, k, vRaw] = m;
      if (process.env[k] != null) continue;
      const v = vRaw.trim().replace(/^"(.*)"$/, '$1');
      process.env[k] = v;
    }
  } catch { /* .env missing → downstream throws clearly */ }
})();

const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');

let cachedSecret = null;
function jwtSecret() {
  if (cachedSecret) return cachedSecret;
  const env = fs.readFileSync('/home/servifibras/backend/.env', 'utf8');
  const line = env.split('\n').find((l) => /^JWT_SECRET=/.test(l));
  if (!line) throw new Error('JWT_SECRET missing in backend/.env');
  cachedSecret = line.replace(/^JWT_SECRET=/, '').trim().replace(/^"|"$/g, '');
  return cachedSecret;
}
function jwtExpires() {
  try {
    const env = fs.readFileSync('/home/servifibras/backend/.env', 'utf8');
    const line = env.split('\n').find((l) => /^JWT_EXPIRES_IN=/.test(l));
    if (line) return line.replace(/^JWT_EXPIRES_IN=/, '').trim().replace(/^"|"$/g, '');
  } catch {}
  return '15m';
}

async function mintTokenForEmail(email) {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`user ${email} not in DB`);
    if (!user.active) throw new Error(`user ${email} is not active`);
    const payload = {
      userId: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      role: user.role,
      jti: `${Date.now()}-e2e`,
    };
    const token = jwt.sign(payload, jwtSecret(), { expiresIn: jwtExpires() });
    return { token, user };
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Seeds the frontend's auth state on a fresh Playwright page.
 * MUST be called before page.goto() to the app, because localStorage
 * on a fresh context is empty and the app checks it during hydration.
 * We navigate to the app origin once (with a lightweight path) so
 * localStorage is scoped to that origin, then seed, then the caller
 * navigates to their target route.
 */
async function seedAdminSession(page, frontUrl, email = 'admin@servifibras.com') {
  const { token, user } = await mintTokenForEmail(email);
  // Land on the app origin so localStorage.setItem targets it. Login
  // page always renders (no auth required) and is the lightest bootstrap.
  await page.goto(`${frontUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('servifibras_auth_token', token);
    localStorage.setItem('servifibras-auth', JSON.stringify({
      state: {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          role: user.role,
          active: user.active,
        },
        isAuthenticated: true,
      },
      version: 0,
    }));
  }, { token, user });
  return { token, user };
}

module.exports = { seedAdminSession, mintTokenForEmail, jwtSecret };
