import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

const FALLBACK = "—";

function toValidDate(input: unknown): Date | null {
  if (input == null) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (typeof input === "string" || typeof input === "number") {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function safeFormatDate(
  input: unknown,
  formatStr: string,
  fallback: string = FALLBACK,
): string {
  const d = toValidDate(input);
  if (!d) return fallback;
  try {
    return format(d, formatStr, { locale: es });
  } catch {
    return fallback;
  }
}

export function safeFormatDistanceToNow(
  input: unknown,
  fallback: string = FALLBACK,
): string {
  const d = toValidDate(input);
  if (!d) return fallback;
  try {
    return formatDistanceToNow(d, { addSuffix: true, locale: es });
  } catch {
    return fallback;
  }
}
