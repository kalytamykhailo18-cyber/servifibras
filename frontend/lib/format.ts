const LOCALE = "es-AR";
const FALLBACK = "0";

export function formatNumber(value: unknown, fallback: string = FALLBACK): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString(LOCALE);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n.toLocaleString(LOCALE);
  }
  return fallback;
}

export function formatMoney(
  value: unknown,
  currency?: string | null,
  fallback: string = FALLBACK,
): string {
  const n = formatNumber(value, fallback);
  return currency ? `${currency} $${n}` : `$${n}`;
}
