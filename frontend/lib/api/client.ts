// ============================================================================
// SERVIFIBRAS API CLIENT
// ============================================================================
// Axios client with auth-token + refresh-token rotation.
//
// Flow on a 401 response:
//   1. The response interceptor calls `/auth/refresh` with the stored
//      refresh token.
//   2. On success, the new access+refresh pair is stored and the original
//      request is retried with the fresh access token.
//   3. On failure (refresh missing/revoked/expired), tokens are cleared
//      and the user is bounced to /login.
//
// Concurrent requests share a single in-flight refresh promise so a burst
// of expired requests doesn't hammer `/auth/refresh`. The original request
// is retried only once via the `_retry` flag — if a retried request 401s,
// we give up to avoid an infinite loop.
//
// We ALSO refresh proactively, before the access token expires, so a 15-min
// JWT_EXPIRES_IN never causes a visible 401 in the browser console even
// when the user has been idle. The proactive timer is scheduled at
// (exp - PROACTIVE_REFRESH_LEAD_MS) and re-scheduled after each successful
// refresh. The 401-fallback path stays in place as a safety net.
// ============================================================================

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig, AxiosRequestConfig } from "axios";
import type { ApiError } from "@/types";

// ============================================================================
// TOKEN MANAGEMENT
// ============================================================================

const TOKEN_KEY = "servifibras_auth_token";
const REFRESH_KEY = "servifibras_refresh_token";
// zustand-persist key for the auth store. We reach in to clear it
// alongside the tokens so a server-rejected session can't leave
// `isAuthenticated: true` cached, which would trick the (auth) layout
// into bouncing back to /conversations and create a redirect loop.
const AUTH_STORE_KEY = "servifibras-auth";

export const tokenManager = {
  get: (): string | null => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(TOKEN_KEY);
  },

  set: (token: string): void => {
    if (typeof window === "undefined") return;
    localStorage.setItem(TOKEN_KEY, token);
  },

  remove: (): void => {
    if (typeof window === "undefined") return;
    localStorage.removeItem(TOKEN_KEY);
  },

  getRefresh: (): string | null => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(REFRESH_KEY);
  },

  setRefresh: (token: string): void => {
    if (typeof window === "undefined") return;
    localStorage.setItem(REFRESH_KEY, token);
  },

  removeRefresh: (): void => {
    if (typeof window === "undefined") return;
    localStorage.removeItem(REFRESH_KEY);
  },

  setPair: (accessToken: string, refreshToken: string): void => {
    if (typeof window === "undefined") return;
    localStorage.setItem(TOKEN_KEY, accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
    scheduleProactiveRefresh();
  },

  clearAll: (): void => {
    if (typeof window === "undefined") return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    // Also wipe the zustand-persisted auth state so a stale
    // `isAuthenticated: true` doesn't survive a token-clear and bounce
    // the user back into the dashboard with no token.
    localStorage.removeItem(AUTH_STORE_KEY);
    cancelProactiveRefresh();
  },
};

// ============================================================================
// PROACTIVE TOKEN REFRESH
// ============================================================================
// JWT access tokens last 15 minutes (JWT_EXPIRES_IN=15m). If we wait for
// them to actually expire, the next request will 401 — which the response
// interceptor then catches and silently recovers from. The 401 still lands
// in the browser console because the browser logs every failed XHR
// regardless of what code does afterwards. The fix is to refresh BEFORE
// expiry so the access token is always valid when used.
//
// Lead time: refresh 60s before the token expires. Long enough to absorb
// clock skew + network latency, short enough that we don't refresh
// unnecessarily often.

const PROACTIVE_REFRESH_LEAD_MS = 60_000;
let proactiveTimer: ReturnType<typeof setTimeout> | null = null;

/** Decode a JWT's `exp` claim (unix seconds). Returns null on any failure. */
function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // base64url → base64
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "===".slice((b64.length + 3) % 4);
    const json = atob(padded);
    const claims = JSON.parse(json);
    return typeof claims.exp === "number" ? claims.exp : null;
  } catch {
    return null;
  }
}

function cancelProactiveRefresh(): void {
  if (proactiveTimer != null) {
    clearTimeout(proactiveTimer);
    proactiveTimer = null;
  }
}

/**
 * Re-arm the proactive-refresh timer based on the current access token's
 * `exp`. Idempotent — clears any existing timer first. No-op when the
 * token is missing or undecodable; the response interceptor's 401 fallback
 * still covers those cases.
 */
function scheduleProactiveRefresh(): void {
  if (typeof window === "undefined") return;
  cancelProactiveRefresh();

  const token = tokenManager.get();
  if (!token) return;
  const exp = decodeJwtExp(token);
  if (exp == null) return;

  const msUntilRefresh = exp * 1000 - Date.now() - PROACTIVE_REFRESH_LEAD_MS;
  if (msUntilRefresh <= 0) {
    // Already in (or past) the lead window — refresh now.
    void runProactiveRefresh();
    return;
  }

  proactiveTimer = setTimeout(() => {
    proactiveTimer = null;
    void runProactiveRefresh();
  }, msUntilRefresh);
}

async function runProactiveRefresh(): Promise<void> {
  // Reuse the same in-flight promise the response interceptor uses, so a
  // proactive refresh + a concurrent 401 don't both hit /auth/refresh.
  if (!inflightRefresh) inflightRefresh = refreshAccessToken();
  const newAccess = await inflightRefresh;
  inflightRefresh = null;
  if (newAccess) {
    // setPair() already called scheduleProactiveRefresh() inside
    // refreshAccessToken — so the next timer is armed automatically.
    return;
  }
  // Refresh failed — token already cleared inside refreshAccessToken on
  // failure, plus bounceToLogin runs from the response interceptor next
  // time the user makes a real request. Nothing else to do here.
}

// Marcos 2026-08-21 — cross-tab coordination.
//
// El servidor tiene detección de reuso: si el refresh presentado ya está
// `revokedAt`, considera "token stolen" y revoca la familia entera →
// ambas pestañas quedan sin sesión. La condición de carrera que veía
// Marcos: dos pestañas abiertas de la CRM, sus timers de proactive-
// refresh caen dentro de milisegundos; ambas mandan /auth/refresh con
// el MISMO token unrevoked; el servidor rota para una, la segunda cae
// como reuso → family revoke → una pestaña se refresca sola y cierra.
//
// Fix: cuando OTRA pestaña escribe el par de tokens, cancelamos
// nuestro refresh in-flight y re-armamos el timer contra el NUEVO
// access token de localStorage. La segunda pestaña se entera de la
// rotación en vez de intentarla ella también.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== REFRESH_KEY && e.key !== TOKEN_KEY) return;
    // Otra pestaña rotó. Descartamos nuestro refresh en curso (si lo
    // había) y reprogramamos el proactive con el nuevo exp.
    inflightRefresh = null;
    cancelProactiveRefresh();
    if (tokenManager.get()) {
      scheduleProactiveRefresh();
    }
  });
}

// ============================================================================
// AXIOS INSTANCE
// ============================================================================

const baseURL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export const apiClient: AxiosInstance = axios.create({
  baseURL,
  timeout: 30000, // 30 seconds
  headers: {
    "Content-Type": "application/json",
  },
});

// ============================================================================
// REQUEST INTERCEPTOR - Add auth token
// ============================================================================

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = tokenManager.get();

    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  }
);

// ============================================================================
// RESPONSE INTERCEPTOR - Handle errors and 401 redirects
// ============================================================================

// ----------------------------------------------------------------------------
// In-flight refresh promise — shared so concurrent 401s don't cause N
// simultaneous /auth/refresh calls. The first 401 starts the refresh; every
// subsequent 401 awaits the same promise.
// ----------------------------------------------------------------------------
let inflightRefresh: Promise<string | null> | null = null;

// Path of the refresh endpoint — kept here so the interceptor can detect a
// 401 originating from the refresh call itself and bail out instead of
// looping.
const REFRESH_PATH = "/auth/refresh";

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = tokenManager.getRefresh();
  if (!refreshToken) return null;

  // Use a bare axios.post so the request bypasses our own interceptors —
  // a 401 from /auth/refresh must NOT recursively trigger another refresh.
  try {
    const res = await axios.post<{ accessToken?: string; refreshToken?: string; success?: boolean }>(
      `${baseURL}${REFRESH_PATH}`,
      { refreshToken },
      { headers: { "Content-Type": "application/json" }, timeout: 30000 },
    );
    const data: any = res.data ?? {};
    if (data?.success === false) return null;
    const newAccess = data.accessToken;
    const newRefresh = data.refreshToken;
    if (!newAccess || !newRefresh) return null;
    tokenManager.setPair(newAccess, newRefresh);
    return newAccess;
  } catch {
    return null;
  }
}

function bounceToLogin(reason?: 'idle_expired' | 'invalid'): void {
  tokenManager.clearAll();
  if (typeof window !== "undefined" && !window.location.pathname.includes("/login")) {
    // Pass the reason as a query param so the login page can render
    // the right toast ("Sesión vencida por inactividad" vs the
    // default). Marcos 2026-06-06, security gap #10.
    const suffix = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    window.location.href = `/login${suffix}`;
  }
}

apiClient.interceptors.response.use(
  (response) => {
    // Unwrap {success, data} wrapper ONLY if there are no other fields besides success and data
    // This prevents losing pagination metadata like total, limit, offset
    if (response.data && typeof response.data === 'object' && response.data.success !== undefined && response.data.data !== undefined) {
      const keys = Object.keys(response.data);

      // Only unwrap if the response has exactly 2 keys: success and data
      if (keys.length === 2 && keys.includes('success') && keys.includes('data')) {
        response.data = response.data.data;
      } else {
      }
    }
    return response;
  },
  async (error: AxiosError<ApiError>) => {
    const originalRequest = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined;

    // Idle-session short-circuit (Bloque C — security gap #10).
    // When the backend rejects with `code: idle_expired`, refreshing
    // would be pointless — the next request would just trip the same
    // idle check. Drop straight to login with the reason flag so the
    // login page can show the right toast.
    const errCode = (error.response?.data as any)?.code;
    if (error.response?.status === 401 && errCode === 'idle_expired') {
      bounceToLogin('idle_expired');
    } else if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !originalRequest.url?.includes(REFRESH_PATH)
    ) {
      // 401 → try silent refresh, retry original once. Skip for the
      // refresh endpoint itself and for already-retried requests.
      originalRequest._retry = true;
      // Share a single refresh promise across concurrent 401s.
      if (!inflightRefresh) inflightRefresh = refreshAccessToken();
      const newAccessToken = await inflightRefresh;
      inflightRefresh = null;

      if (newAccessToken) {
        if (originalRequest.headers) {
          (originalRequest.headers as any).Authorization = `Bearer ${newAccessToken}`;
        }
        return apiClient(originalRequest);
      }
      // Refresh failed — wipe tokens and bounce to login.
      bounceToLogin('invalid');
    } else if (error.response?.status === 401) {
      // Either we already retried, or the 401 came from /auth/refresh.
      bounceToLogin('invalid');
    }

    // Handle network errors
    if (!error.response) {
      return Promise.reject({
        message: "Error de red. Verifica tu conexión a internet.",
        statusCode: 0,
      } as ApiError);
    }

    // Format API error
    const apiError: ApiError = {
      message: error.response.data?.message || "Error desconocido",
      statusCode: error.response.status,
      errors: error.response.data?.errors,
    };

    return Promise.reject(apiError);
  }
);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if API is healthy
 */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const response = await apiClient.get("/health");
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Set auth token for all future requests (legacy single-token path).
 * Prefer `setAuthTokens` when both access + refresh are available.
 */
export function setAuthToken(token: string): void {
  tokenManager.set(token);
}

/**
 * Store both the short-lived access token and the long-lived refresh token.
 * Call this on login + after every refresh.
 */
export function setAuthTokens(accessToken: string, refreshToken: string): void {
  tokenManager.setPair(accessToken, refreshToken);
}

/**
 * Clear access + refresh tokens (full logout — local state only).
 */
export function clearAuthToken(): void {
  tokenManager.clearAll();
}

/**
 * Check if user is authenticated (has an access token in local storage).
 */
export function isAuthenticated(): boolean {
  return tokenManager.get() !== null;
}

// On module init in the browser, if a token is already in localStorage
// (page reload, returning user), arm the proactive-refresh timer so we
// never let it sit and expire silently.
if (typeof window !== "undefined") {
  scheduleProactiveRefresh();
}
