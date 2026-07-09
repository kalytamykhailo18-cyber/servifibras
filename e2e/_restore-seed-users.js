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

// Marcos 2026-07-08: this used to also RESET password + role for these
// emails to the "canonical seed" values. Problem: the seeds are the LIVE
// employee emails. Franco was flipped ENCARGADO → VENTAS this morning
// because a full sweep ran and this script overwrote his role back to
// the "canonical" VENTAS. Marcos surfaced it as "se le salió el módulo
// de logística". Same class as the 2026-07-02 outage the comment above
// already warned about — but the guard only stops ad-hoc shell runs,
// not sweeps that legitimately set SERVIFIBRAS_E2E=1.
//
// Fix: only touch the LOCKOUT counters (which are safe to clear — they
// don't change what the user is). Never touch password / role / active
// again. If an E2E test needs a specific credential set, it has to set
// it up under an e2e-only email that is NOT a real employee.
const LOCKOUT_RESET_EMAILS = [
  'admin@servifibras.com',
  'brenda@servifibras.com',
  'franco@servifibras.com',
  'aldo@servifibras.com',
];

if (process.env.SERVIFIBRAS_E2E !== '1' && process.env.ALLOW_PROD_SEED_RESET !== '1') {
  console.error('seed-restore ABORTED: this script mutates live user rows.');
  console.error('  Set SERVIFIBRAS_E2E=1 (E2E sweep sets it) or ALLOW_PROD_SEED_RESET=1 explicitly.');
  console.error('  If you are in a prod shell and see this — walk away, DO NOT force it.');
  process.exit(2);
}

(async () => {
  const prisma = new PrismaClient();
  try {
    for (const email of LOCKOUT_RESET_EMAILS) {
      await prisma.user.update({
        where: { email },
        data: {
          // Only the lockout counters. Password / role / active are
          // OFF-LIMITS — these emails are real employees.
          failedLoginAttempts: 0,
          lastFailedLoginAt: null,
          lockedUntil: null,
        },
      }).catch((err) => {
        // If the user row doesn't exist (fresh DB), the sweep will
        // create it via its own setup. Don't crash here.
        console.error(`  seed-restore: ${email} update skipped — ${err.message}`);
      });
    }
    console.log('seed-restore: lockout counters cleared for 4 employee accounts (password/role NOT touched)');
  } finally {
    await prisma.$disconnect();
  }
})().catch((err) => {
  console.error('seed-restore failed:', err.message);
  process.exit(1);
});
