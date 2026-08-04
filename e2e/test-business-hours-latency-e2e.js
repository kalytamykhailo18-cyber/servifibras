// Marcos 2026-08-04 (WhatsApp 14:21 AR): "el promedio de respuesta
// tiene que ser en horario de 9 a 13 y de 14 a 17 horas que es el
// horario de atención". Métricas de Atención (1ª respuesta 7d,
// waitingMinutes por conversación sin resolver) contaban wall-clock
// — incluyendo siesta, noche, fin de semana. Ahora sólo cuentan la
// intersección con las ventanas de horario de atención (default AR
// Lun-Vie 9-13 y 14-17).
//
// Este test valida la utility pura business-hours.util.ts contra
// escenarios reales:

const path = require('path');
const {
  businessHoursMsBetween,
  businessHoursMinutesBetween,
  loadBusinessHoursScheduleFromEnv,
} = require(path.join('/home/servifibras/backend/dist/src/adapters/admin/business-hours.util.js'));

function h(n) { return n * 60 * 60 * 1000; }

// Argentina UTC-3. Un instante AR "YYYY-MM-DDTHH:MM AR" = misma
// wall-clock string agregando "-03:00".
const arDate = (iso) => new Date(iso + '-03:00');

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`);
  cond ? pass++ : fail++;
};

// (1) Un lunes de 10:00 a 12:00 AR = 2h business hours.
{
  const t = businessHoursMsBetween(arDate('2026-08-03T10:00:00'), arDate('2026-08-03T12:00:00'));
  ok('Lunes 10:00 → 12:00 AR = 2h business hours', t === h(2), `${(t/h(1)).toFixed(2)}h`);
}

// (2) Lunes 10:00 → 15:00 AR abarca la siesta 13:00-14:00; la
// intersección debe ser 3h (10-13) + 1h (14-15) = 4h.
{
  const t = businessHoursMsBetween(arDate('2026-08-03T10:00:00'), arDate('2026-08-03T15:00:00'));
  ok('Lunes 10:00 → 15:00 AR = 4h (siesta 13-14 excluida)', t === h(4), `${(t/h(1)).toFixed(2)}h`);
}

// (3) Viernes 17:00 AR → Lunes 09:00 AR = 0h (weekend + fuera de horario).
// Fri = 2026-07-31, Mon = 2026-08-03.
{
  const t = businessHoursMsBetween(arDate('2026-07-31T17:00:00'), arDate('2026-08-03T09:00:00'));
  ok('Viernes 17:00 → Lunes 09:00 AR = 0h (fin de semana)', t === 0, `${(t/h(1)).toFixed(2)}h`);
}

// (4) Viernes 16:30 AR → Lunes 10:00 AR = 30min viernes + 1h lunes = 1.5h.
{
  const t = businessHoursMsBetween(arDate('2026-07-31T16:30:00'), arDate('2026-08-03T10:00:00'));
  ok('Viernes 16:30 → Lunes 10:00 AR = 1.5h (cruza fin de semana)', t === h(1.5), `${(t/h(1)).toFixed(2)}h`);
}

// (5) Miércoles 22:00 AR → jueves 10:00 AR = 1h (sólo jueves 09-10).
{
  const t = businessHoursMsBetween(arDate('2026-08-06T22:00:00'), arDate('2026-08-07T10:00:00'));
  ok('Mié 22:00 → Jue 10:00 AR = 1h (noche excluida)', t === h(1), `${(t/h(1)).toFixed(2)}h`);
}

// (6) Sábado entero = 0h.
{
  const t = businessHoursMsBetween(arDate('2026-08-02T09:00:00'), arDate('2026-08-02T17:00:00'));
  ok('Sábado completo = 0h', t === 0, `${(t/h(1)).toFixed(2)}h`);
}

// (7) from >= to → 0.
{
  ok('from == to → 0', businessHoursMsBetween(arDate('2026-08-03T10:00:00'), arDate('2026-08-03T10:00:00')) === 0);
  ok('from > to → 0', businessHoursMsBetween(arDate('2026-08-03T11:00:00'), arDate('2026-08-03T10:00:00')) === 0);
}

// (8) Un día completo de atención (9-13 + 14-17) = 7h.
{
  const t = businessHoursMsBetween(arDate('2026-08-03T00:00:00'), arDate('2026-08-04T00:00:00'));
  ok('Un día completo cuenta las 7h de horario', t === h(7), `${(t/h(1)).toFixed(2)}h`);
}

// (9) Kill switch BUSINESS_HOURS_DISABLED=true devuelve wall-clock.
{
  process.env.BUSINESS_HOURS_DISABLED = 'true';
  const t = businessHoursMsBetween(arDate('2026-08-02T09:00:00'), arDate('2026-08-02T17:00:00'));
  delete process.env.BUSINESS_HOURS_DISABLED;
  ok('BUSINESS_HOURS_DISABLED=true → wall-clock', t === h(8), `${(t/h(1)).toFixed(2)}h`);
}

// (10) Env override: BUSINESS_HOURS_WINDOWS con 1 sola ventana (10-16 = 6h).
{
  process.env.BUSINESS_HOURS_WINDOWS = '10:00-16:00';
  const t = businessHoursMsBetween(arDate('2026-08-03T00:00:00'), arDate('2026-08-04T00:00:00'));
  delete process.env.BUSINESS_HOURS_WINDOWS;
  ok('Env override WINDOWS 10:00-16:00 → 6h por día', t === h(6), `${(t/h(1)).toFixed(2)}h`);
}

// (11) Minutos helper redondea correctamente.
{
  const m = businessHoursMinutesBetween(arDate('2026-08-03T10:00:00'), arDate('2026-08-03T10:30:00'));
  ok('businessHoursMinutesBetween → minutos redondeados', m === 30, `got=${m}`);
}

// (12) Ariel-like scenario: escalado sábado 18:00, revisado lunes 14:20.
// Sat = 2026-08-01, Mon = 2026-08-03. Sábado 18:00 → domingo entero = 0.
// Lunes 09-13 (4h) + 14-14:20 (20m) = 4h20m = 260m.
{
  const m = businessHoursMinutesBetween(arDate('2026-08-01T18:00:00'), arDate('2026-08-03T14:20:00'));
  ok('Ariel-like: sábado 18:00 → lunes 14:20 = 260m (no 27h wall-clock)', m === 260, `got=${m}`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
