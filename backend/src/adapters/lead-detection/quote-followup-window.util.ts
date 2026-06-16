/**
 * ADAPTERS LAYER — Shared resolver for the "quote stale" threshold.
 *
 * Marcos wants sub-hour follow-ups (25 min as of 2026-05-04), so we read
 * `QUOTE_FOLLOWUP_MINUTES` first and fall back to `QUOTE_FOLLOWUP_HOURS`.
 * Both keys remain in `.env.example` so the legacy hours name keeps working
 * for anyone deploying an older config.
 *
 * Defaults: 1440 minutes (24h) if neither key is set — same as the old
 * `QUOTE_FOLLOWUP_HOURS=24` baseline before we tightened it.
 */

const FALLBACK_MINUTES = 1440;

export function quoteFollowupMinutes(): number {
  const minutesRaw = process.env.QUOTE_FOLLOWUP_MINUTES;
  if (minutesRaw != null && minutesRaw.trim().length > 0) {
    const m = Number(minutesRaw);
    if (Number.isFinite(m) && m > 0) return m;
  }
  const hoursRaw = process.env.QUOTE_FOLLOWUP_HOURS;
  if (hoursRaw != null && hoursRaw.trim().length > 0) {
    const h = Number(hoursRaw);
    if (Number.isFinite(h) && h > 0) return h * 60;
  }
  return FALLBACK_MINUTES;
}

export function quoteFollowupMs(): number {
  return quoteFollowupMinutes() * 60_000;
}

/**
 * Whole-minutes elapsed since `since` (clamped to >= 0). Used by role-metrics
 * to render Franco's "X min idle" badges.
 */
export function idleMinutesSince(since: Date | null | undefined): number {
  if (!since) return 0;
  const ms = Date.now() - since.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / 60_000);
}
