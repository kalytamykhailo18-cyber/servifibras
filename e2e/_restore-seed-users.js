// E2E pre-flight — restore the 4 demo seed users to canonical state
// before every sweep. Some user-management tests mutate admin/franco
// passwords or roles and don't always clean up; without this guard the
// next sweep cascades into dozens of "invalid_credentials" failures
// that are noise, not real regressions. Marcos 2026-06-07: the second
// time this happened in a week. Reset is cheap; running it always.
//
// Marcos 2026-07-02 outage — I ran this against prod during an
// interactive audit shell, thinking it only touched sandbox rows.
// Actual behavior: the SEEDS emails ARE the real users' emails
// (admin / brenda / franco / aldo are both the E2E fixtures AND
// live employee accounts in prod). Every prod deploy that had run
// this script was bricking those 4 people until their passwords
// were manually restored. Added a hard guard: refuses to run unless
// ALLOW_PROD_SEED_RESET=1 is explicitly set. Only run-all.sh sets
// it (via SERVIFIBRAS_E2E=1). An ad-hoc `node _restore-seed-users.js`
// in a shell now aborts before touching a row.

const bcrypt = require('/home/servifibras/backend/node_modules/bcrypt');
const { PrismaClient } = require('/home/servifibras/backend/node_modules/@prisma/client');

const SEEDS = [
  { email: 'admin@servifibras.com',  password: 'admin123', role: 'ADMIN'     },
  { email: 'brenda@servifibras.com', password: 'demo123',  role: 'ATENCION'  },
  { email: 'franco@servifibras.com', password: 'demo123',  role: 'VENTAS'    },
  { email: 'aldo@servifibras.com',   password: 'demo123',  role: 'LOGISTICA' },
];

if (process.env.SERVIFIBRAS_E2E !== '1' && process.env.ALLOW_PROD_SEED_RESET !== '1') {
  console.error('seed-restore ABORTED: this script rewrites live user passwords.');
  console.error('  Set SERVIFIBRAS_E2E=1 (E2E sweep sets it) or ALLOW_PROD_SEED_RESET=1 explicitly.');
  console.error('  If you are in a prod shell and see this — walk away, DO NOT force it.');
  process.exit(2);
}

(async () => {
  const prisma = new PrismaClient();
  try {
    for (const s of SEEDS) {
      const hash = await bcrypt.hash(s.password, 10);
      await prisma.user.update({
        where: { email: s.email },
        data: {
          password: hash,
          role: s.role,
          active: true,
          // Reset lockout state too — the login-reasons test fires
          // wrong-password attempts at the seed users on purpose, and
          // without this the next sweep starts with admin/brenda/
          // franco/aldo locked out from the previous run's tail.
          // Marcos 2026-06-08, security gap #9 fallout.
          failedLoginAttempts: 0,
          lastFailedLoginAt: null,
          lockedUntil: null,
        },
      }).catch((err) => {
        // If the user row doesn't exist (fresh DB), the sweep will
        // create it via its own setup. Don't crash here.
        console.error(`  seed-restore: ${s.email} update skipped — ${err.message}`);
      });
    }
    console.log('seed-restore: 4 demo users restored to canonical state (lockout counters cleared)');
  } finally {
    await prisma.$disconnect();
  }
})().catch((err) => {
  console.error('seed-restore failed:', err.message);
  process.exit(1);
});
