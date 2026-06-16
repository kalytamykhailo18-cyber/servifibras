// ============================================================================
// SERVIFIBRAS AUTH STORE (Zustand)
// ============================================================================
// Global authentication state management
// ============================================================================

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthUser, LoginRequest } from "@/types";
import { api } from "@/lib/api/endpoints";
import { setAuthTokens, clearAuthToken, isAuthenticated, tokenManager } from "@/lib/api/client";

/**
 * Map a backend login-failure code to user-facing Spanish copy. Falls back
 * to the server-supplied message when the code is unknown — keeps us
 * forward-compatible if the backend introduces a new code before the
 * frontend redeploys. Generic last-resort string only fires when both code
 * and message are empty (never expected in practice but cheap insurance).
 */
function messageForLoginCode(code?: string, fallback?: string): string {
  switch (code) {
    case "invalid_credentials":
      return "Email o contraseña incorrectos.";
    case "account_deactivated":
      return "Tu cuenta está desactivada. Contactá al administrador para reactivarla.";
    case "account_locked":
      // The backend payload carries the exact cooldown ("Probá de
      // nuevo en ~X min, o pedile al administrador que la
      // desbloquee."), so prefer the server-supplied `fallback`
      // message and only fall back to the generic if it's missing.
      return fallback || "Cuenta bloqueada temporalmente por intentos fallidos. Probá de nuevo en unos minutos.";
    case "invalid_format":
      return "Email o contraseña incorrectos.";
    case "internal_error":
      return "No se pudo procesar el inicio de sesión. Probá de nuevo.";
    default:
      return fallback || "Error al iniciar sesión.";
  }
}

// ============================================================================
// STORE STATE INTERFACE
// ============================================================================

interface AuthState {
  // State
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (credentials: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

// ============================================================================
// AUTH STORE
// ============================================================================

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      // ========================================================================
      // LOGIN
      // ========================================================================
      login: async (credentials: LoginRequest) => {
        set({ isLoading: true, error: null });

        try {
          // Call login API
          const response = await api.auth.login(credentials);

          // Backend returns HTTP 200 even on credential / deactivation
          // failures (so the body-level `{ success: false, code, error }`
          // contract works the same way as /auth/refresh). Detect that
          // shape here and surface the right Spanish message.
          const r = response as any;
          if (r?.success === false || !(r?.accessToken || r?.token)) {
            const message = messageForLoginCode(r?.code, r?.error);
            set({
              user: null,
              isAuthenticated: false,
              isLoading: false,
              error: message,
            });
            throw new Error(message);
          }

          // Store both access + refresh. The interceptor uses the refresh
          // token to silently rotate the access JWT when it expires (15 min
          // by default). Falls back to legacy single-token field for
          // robustness if the backend response shape ever regresses.
          const accessToken = r.accessToken ?? r.token;
          const refreshToken = r.refreshToken ?? "";
          setAuthTokens(accessToken, refreshToken);

          // Update state
          set({
            user: response.user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
        } catch (error: any) {
          // Map transport-level failures (429 throttle, 5xx, network) into
          // user-facing Spanish copy. Body-level failures (handled above)
          // already carry their own message.
          //
          // The axios interceptor flattens errors into `{ message,
          // statusCode }` before they reach this catch — original raw
          // AxiosError.response is no longer available. Check the
          // flattened shape first, fall back to the raw shape so we
          // stay compatible if the interceptor changes.
          const status =
            (typeof error?.statusCode === 'number' ? error.statusCode : null) ??
            (typeof error?.response?.status === 'number' ? error.response.status : null);
          const message = status === 429
            ? "Demasiados intentos. Esperá un minuto y volvé a intentar."
            : (status !== null && status >= 500)
              ? "No se pudo contactar al servidor. Probá en unos segundos."
              : error?.message || "Error al iniciar sesión";

          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: message,
          });

          throw error;
        }
      },

      // ========================================================================
      // LOGOUT
      // ========================================================================
      logout: async () => {
        // Tell the backend to revoke the refresh-token family server-side
        // first — this invalidates any other tab/session sharing the same
        // refresh chain. The call is fire-and-forget; if it fails we still
        // proceed with the local clear so the user isn't stuck.
        const refreshToken = tokenManager.getRefresh();
        try {
          await api.auth.logout(refreshToken);
        } catch {
          // Already swallowed inside api.auth.logout, but belt-and-braces.
        }

        // Clear local tokens
        clearAuthToken();

        // Reset state
        set({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: null,
        });

        // Redirect to login (if in browser)
        if (typeof window !== "undefined") {
          window.location.href = "/login";
        }
      },

      // ========================================================================
      // CHECK AUTH (Validate token and get current user)
      // ========================================================================
      checkAuth: async () => {
        // Check if token exists
        if (!isAuthenticated()) {
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
          });
          return;
        }

        set({ isLoading: true });

        try {
          // Validate token by fetching current user
          const user = await api.auth.getCurrentUser();

          set({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
        } catch (error) {
          // Token is invalid, clear auth
          clearAuthToken();

          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: null,
          });
        }
      },

      // ========================================================================
      // CLEAR ERROR
      // ========================================================================
      clearError: () => {
        set({ error: null });
      },
    }),
    {
      name: "servifibras-auth", // localStorage key
      partialize: (state) => ({
        // Only persist user and isAuthenticated
        // Token is managed separately in apiClient
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

// ============================================================================
// SELECTORS (For optimized re-renders)
// ============================================================================

export const selectUser = (state: AuthState) => state.user;
export const selectIsAuthenticated = (state: AuthState) => state.isAuthenticated;
export const selectIsLoading = (state: AuthState) => state.isLoading;
export const selectError = (state: AuthState) => state.error;
export const selectUserRole = (state: AuthState) => state.user?.role;
export const selectUserName = (state: AuthState) => state.user?.name;
