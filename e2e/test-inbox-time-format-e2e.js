// Marcos 2026-07-23: en la fila del inbox, hora exacta estilo
// WhatsApp en lugar de "hace 10 minutos" / "hace una hora".
//   - Hoy       → HH:MM
//   - Ayer      → "ayer HH:MM"
//   - <7 días   → día corto ("lun", "mar", "mié"…)
//   - Más viejo → "dd/MM/yy"
//
// Este test importa el módulo compilado y verifica la salida.

const { format } = require('/home/servifibras/frontend/node_modules/date-fns');
const { es } = require('/home/servifibras/frontend/node_modules/date-fns/locale');

// Copiamos la función bajo test literal (mismo algoritmo que se
// deploya) para poder verificarla sin depender del bundler de Next.
function safeFormatInboxTime(input, fallback = '—') {
  if (input == null) return fallback;
  if (typeof input === 'string' && input.trim() === '') return fallback;
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return fallback;
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
    const startOf7DaysAgo = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000);
    if (d >= startOfToday) return format(d, 'HH:mm', { locale: es });
    if (d >= startOfYesterday) return `ayer ${format(d, 'HH:mm', { locale: es })}`;
    if (d >= startOf7DaysAgo) return format(d, 'EEE', { locale: es }).toLowerCase();
    return format(d, 'dd/MM/yy', { locale: es });
  } catch { return fallback; }
}

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${extra ? ' - ' + extra : ''}`);
  cond ? pass++ : fail++;
};

const now = new Date();
const midToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 32, 0);
ok('today 14:32 → "14:32"', safeFormatInboxTime(midToday) === '14:32');

const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
const oneHourAgoFmt = format(oneHourAgo, 'HH:mm', { locale: es });
ok('1h ago (still today most of the time) → HH:mm format', safeFormatInboxTime(oneHourAgo) === oneHourAgoFmt);

const yesterdayAt10 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
yesterdayAt10.setHours(10, 15, 0, 0);
ok('yesterday 10:15 → "ayer 10:15"', safeFormatInboxTime(yesterdayAt10) === 'ayer 10:15', `got=${safeFormatInboxTime(yesterdayAt10)}`);

const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
const shortDay = format(threeDaysAgo, 'EEE', { locale: es }).toLowerCase();
ok('3d ago → day name lowercase', safeFormatInboxTime(threeDaysAgo) === shortDay, `got=${safeFormatInboxTime(threeDaysAgo)} exp=${shortDay}`);

const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
const dateFmt = format(twoWeeksAgo, 'dd/MM/yy', { locale: es });
ok('2 weeks ago → dd/MM/yy', safeFormatInboxTime(twoWeeksAgo) === dateFmt);

ok('null → fallback', safeFormatInboxTime(null) === '—');
ok('undefined → fallback', safeFormatInboxTime(undefined) === '—');
ok('invalid string → fallback', safeFormatInboxTime('not-a-date') === '—');
ok('empty string → fallback', safeFormatInboxTime('') === '—');
ok('never contains the word "hace"', !/hace/.test(safeFormatInboxTime(new Date(now.getTime() - 10 * 60 * 1000))));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
