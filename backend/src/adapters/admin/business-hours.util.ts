/**
 * Marcos 2026-08-04 (WhatsApp 14:21 AR): "el promedio de respuesta
 * tiene que ser en horario de 9 a 13 y de 14 a 17 horas que es el
 * horario de atención". Antes el latency y el waiting-time se
 * medían en wall-clock, así que 1 pregunta que entró un viernes a
 * las 17:30 y se contestó el sábado a las 10 mostraba ~16h aunque
 * el equipo no estuvo activo la mayor parte de ese lapso. Este
 * módulo calcula la superposición entre un rango [from, to] y las
 * ventanas de atención (default Argentina 9-13, 14-17, Lun-Vie) y
 * devuelve sólo esos ms.
 *
 * Env knobs:
 *   BUSINESS_HOURS_TZ_OFFSET_MIN   — offset del local time vs UTC en
 *                                    minutos (default -180 = AR UTC-3).
 *   BUSINESS_HOURS_WINDOWS         — CSV de ventanas HH:mm-HH:mm
 *                                    (default "09:00-13:00,14:00-17:00").
 *   BUSINESS_HOURS_DAYS            — CSV de días de semana en base ISO
 *                                    1..7 = Lun..Dom (default "1,2,3,4,5").
 *
 * Devuelve wall-clock diff cuando `from >= to` o cuando el
 * `BUSINESS_HOURS_DISABLED=true` está seteado — kill switch por si
 * hay que revertir sin redeploy.
 */

export interface BusinessHoursSchedule {
  tzOffsetMin: number;
  windows: Array<[number, number]>; // [startMinFromMidnight, endMinFromMidnight]
  daysIso: Set<number>;             // ISO day-of-week: 1=Mon..7=Sun
}

export function loadBusinessHoursScheduleFromEnv(): BusinessHoursSchedule {
  const tzOffsetMin = (() => {
    const raw = Number(process.env.BUSINESS_HOURS_TZ_OFFSET_MIN);
    return Number.isFinite(raw) ? raw : -180;
  })();
  const windowsCsv = (process.env.BUSINESS_HOURS_WINDOWS ?? '09:00-13:00,14:00-17:00').trim();
  const daysCsv = (process.env.BUSINESS_HOURS_DAYS ?? '1,2,3,4,5').trim();

  const parseHm = (s: string): number => {
    const [h, m] = s.split(':').map((x) => Number(x.trim()));
    if (!Number.isFinite(h) || !Number.isFinite(m)) throw new Error(`Bad HH:MM in windows: "${s}"`);
    return h * 60 + m;
  };
  const windows: Array<[number, number]> = windowsCsv
    .split(',').map((w) => w.trim()).filter(Boolean)
    .map((w) => {
      const [a, b] = w.split('-').map((x) => x.trim());
      const start = parseHm(a);
      const end = parseHm(b);
      if (end <= start) throw new Error(`Bad window "${w}" (end <= start)`);
      return [start, end] as [number, number];
    });
  const daysIso = new Set<number>(
    daysCsv.split(',').map((d) => Number(d.trim())).filter((n) => Number.isFinite(n) && n >= 1 && n <= 7),
  );
  if (daysIso.size === 0) daysIso.add(1); // safety — never end up with empty days
  return { tzOffsetMin, windows, daysIso };
}

/**
 * ms de superposición entre [from, to] y las ventanas de horario de
 * atención. Iteramos día por día del local time — un rango típico
 * (7 días) sale en <=14 iteraciones. Nunca lanza — errores de parsing
 * caen a wall-clock del rango.
 */
export function businessHoursMsBetween(
  from: Date,
  to: Date,
  scheduleOverride?: BusinessHoursSchedule,
): number {
  if (!(from instanceof Date) || !(to instanceof Date)) return 0;
  const wall = to.getTime() - from.getTime();
  if (wall <= 0) return 0;
  if ((process.env.BUSINESS_HOURS_DISABLED ?? '').toLowerCase() === 'true') return wall;
  let schedule: BusinessHoursSchedule;
  try {
    schedule = scheduleOverride ?? loadBusinessHoursScheduleFromEnv();
  } catch {
    // Bad env config — fall back to wall-clock so nothing crashes.
    return wall;
  }

  // Shift both instants to "local time" seen as UTC — hace la
  // aritmética de día/hora local totalmente independiente de la TZ
  // del proceso Node (que en prod es UTC).
  const offsetMs = schedule.tzOffsetMin * 60_000;
  const fromLocal = from.getTime() + offsetMs;
  const toLocal = to.getTime() + offsetMs;

  const MS_PER_DAY = 86_400_000;
  // Índice del día (UTC-anchored porque ya está shifted) — usamos
  // Math.floor con base 1970-01-01 (jueves = ISO 4).
  const firstDayIdx = Math.floor(fromLocal / MS_PER_DAY);
  const lastDayIdx = Math.floor(toLocal / MS_PER_DAY);

  let overlapMs = 0;
  for (let dayIdx = firstDayIdx; dayIdx <= lastDayIdx; dayIdx++) {
    // 1970-01-01 (day 0) = Thursday = ISO 4.
    const iso = ((dayIdx + 3) % 7) + 1;
    if (!schedule.daysIso.has(iso)) continue;
    const dayStartMs = dayIdx * MS_PER_DAY;
    for (const [wStartMin, wEndMin] of schedule.windows) {
      const wStart = dayStartMs + wStartMin * 60_000;
      const wEnd = dayStartMs + wEndMin * 60_000;
      const lo = Math.max(fromLocal, wStart);
      const hi = Math.min(toLocal, wEnd);
      if (hi > lo) overlapMs += hi - lo;
    }
  }
  return overlapMs;
}

/** Convenience — devuelve minutos redondeados. */
export function businessHoursMinutesBetween(from: Date, to: Date): number {
  return Math.round(businessHoursMsBetween(from, to) / 60_000);
}
