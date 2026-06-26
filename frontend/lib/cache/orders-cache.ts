/**
 * Cache local de /orders para degradación elegante cuando la API
 * está caída — Marcos 2026-06-26 (después del incidente 500 de
 * shippingPickupType el 06-25).
 *
 * Idea: la última respuesta válida del listado de pedidos se
 * persiste en localStorage. Cuando el fetch falla, en vez de mostrar
 * la pantalla de error vacía, el componente carga el snapshot
 * cacheado y muestra un cartel "Datos del [hora], reconectando…",
 * mientras un reintento automático en background trata de recuperar.
 *
 * Alcance v1 (deliberadamente acotado):
 *  - Solo cachea la vista default sin filtros (statusFilter="all",
 *    search=""). Las búsquedas/filtros filtran sobre la cache si la
 *    API está caída — es mejor mostrar algo aunque sea incompleto
 *    que pantalla en blanco.
 *  - Versión bumpable en MAX_KEY_VERSION por si cambia el shape de
 *    OrderDetails y necesitamos invalidar caches viejos.
 *  - TTL: 7 días. Si el snapshot es más viejo que eso ya no sirve
 *    para nada operativo (los pedidos cambiaron demasiado).
 *  - Tamaño: skip si serializado supera 3 MB — protección contra
 *    QuotaExceededError en localStorage (suele ser 5-10 MB total).
 */

const KEY = 'orders.cache.v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 días
const MAX_SERIALIZED_BYTES = 3 * 1024 * 1024; // 3 MB

interface OrdersCacheSnapshot {
  // Free-form para no acoplar el cache al shape exacto de Order del
  // backend — si TS extiende el tipo, el cache sigue funcionando.
  data: unknown[];
  total: number;
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

export function saveOrdersSnapshot(data: unknown[], total: number): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    const snapshot: OrdersCacheSnapshot = {
      data,
      total,
      savedAtIso: new Date().toISOString(),
    };
    const serialized = JSON.stringify(snapshot);
    if (serialized.length > MAX_SERIALIZED_BYTES) {
      // Snapshot demasiado grande: no cacheamos pero tampoco volamos
      // el snapshot anterior — vale más uno viejo que ninguno.
      return;
    }
    storage.setItem(KEY, serialized);
  } catch {
    // QuotaExceededError u otro fallo de storage: silencioso.
  }
}

export function loadOrdersSnapshot(): {
  data: unknown[];
  total: number;
  savedAt: Date;
} | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OrdersCacheSnapshot;
    if (!parsed?.savedAtIso || !Array.isArray(parsed.data)) return null;
    const savedAt = new Date(parsed.savedAtIso);
    if (Number.isNaN(savedAt.getTime())) return null;
    if (Date.now() - savedAt.getTime() > MAX_AGE_MS) {
      // Snapshot demasiado viejo — no lo devolvemos pero lo limpiamos
      // para liberar storage.
      storage.removeItem(KEY);
      return null;
    }
    return {
      data: parsed.data,
      total: typeof parsed.total === 'number' ? parsed.total : parsed.data.length,
      savedAt,
    };
  } catch {
    return null;
  }
}

export function clearOrdersSnapshot(): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(KEY);
  } catch {
    // ignore
  }
}
