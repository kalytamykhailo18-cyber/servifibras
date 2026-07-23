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

/**
 * Marcos 2026-07-23: pidió hora exacta en la fila del inbox en lugar
 * de "hace 10 minutos". Formato estilo WhatsApp:
 *   - Hoy       → HH:MM (ej. "14:32")
 *   - Ayer      → "ayer HH:MM"
 *   - <7 días   → nombre corto del día ("lun", "mar")
 *   - Más viejo → "dd/MM/yy"
 * Devuelve fallback ("—") si el input es inválido.
 */
export function safeFormatInboxTime(
  input: unknown,
  fallback: string = FALLBACK,
): string {
  const d = toValidDate(input);
  if (!d) return fallback;
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
    const startOf7DaysAgo = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000);
    if (d >= startOfToday) {
      return format(d, 'HH:mm', { locale: es });
    }
    if (d >= startOfYesterday) {
      return `ayer ${format(d, 'HH:mm', { locale: es })}`;
    }
    if (d >= startOf7DaysAgo) {
      // "lun", "mar", "mié", …
      return format(d, 'EEE', { locale: es }).toLowerCase();
    }
    return format(d, 'dd/MM/yy', { locale: es });
  } catch {
    return fallback;
  }
}
