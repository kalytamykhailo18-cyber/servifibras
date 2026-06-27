/**
 * Cache local del aggregator de /logistica-diaria — misma idea que
 * orders-cache.ts (Marcos 2026-06-26). Cuando la respuesta del
 * aggregator se cae o tarda demasiado y Axios timeoutea (el
 * aggregator pulla ML+TN+PRFV y a veces tarda 30+ segundos), el
 * componente carga el snapshot guardado y muestra un cartel
 * "Mostrando datos guardados del [hora]", con reintento automático
 * cada 30s.
 *
 * Marcos 2026-06-27: extendido a este panel después que el operador
 * vio "Error de red" sin tener fallback — pidió expresamente que el
 * cache que armamos para Pedidos aplique también acá.
 *
 * Key per día (la vista del aggregator cambia por fecha). TTL 7
 * días, cap 3MB. Misma defensa contra QuotaExceeded.
 */

const KEY_PREFIX = 'logistica.cache.v1:';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SERIALIZED_BYTES = 3 * 1024 * 1024;

interface LogisticaCacheSnapshot {
  // free-form para no acoplar la cache al shape exacto de
  // AggregatedDay; si extiende el tipo, la cache sigue funcionando.
  data: unknown;
  savedAtIso: string;
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function keyFor(date: string): string {
  return `${KEY_PREFIX}${date}`;
}

export function saveLogisticaSnapshot(date: string, data: unknown): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    const snapshot: LogisticaCacheSnapshot = {
      data,
      savedAtIso: new Date().toISOString(),
    };
    const serialized = JSON.stringify(snapshot);
    if (serialized.length > MAX_SERIALIZED_BYTES) return;
    storage.setItem(keyFor(date), serialized);
  } catch {
    // QuotaExceeded etc: silencioso.
  }
}

export function loadLogisticaSnapshot(date: string): {
  data: unknown;
  savedAt: Date;
} | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(keyFor(date));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LogisticaCacheSnapshot;
    if (!parsed?.savedAtIso || parsed.data === undefined) return null;
    const savedAt = new Date(parsed.savedAtIso);
    if (Number.isNaN(savedAt.getTime())) return null;
    if (Date.now() - savedAt.getTime() > MAX_AGE_MS) {
      storage.removeItem(keyFor(date));
      return null;
    }
    return { data: parsed.data, savedAt };
  } catch {
    return null;
  }
}

export function clearLogisticaSnapshot(date?: string): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    if (date) {
      storage.removeItem(keyFor(date));
    } else {
      // Limpiar todos los snapshots del cache (útil en logout / debug).
      const toDelete: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(KEY_PREFIX)) toDelete.push(k);
      }
      for (const k of toDelete) storage.removeItem(k);
    }
  } catch {
    // ignore
  }
}
