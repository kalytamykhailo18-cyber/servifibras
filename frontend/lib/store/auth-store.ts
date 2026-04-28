// ============================================================================
// SERVIFIBRAS AUTH STORE (Zustand)
// ============================================================================
// Global authentication state management
// ============================================================================

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthUser, LoginRequest } from "@/types";
import { api } from "@/lib/api/endpoints";
import { setAuthToken, clearAuthToken, isAuthenticated } from "@/lib/api/client";

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
  logout: () => void;
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

          // Store token
          setAuthToken(response.token);

          // Update state
          set({
            user: response.user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
        } catch (error: any) {
          // Handle login error
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: error.message || "Error al iniciar sesión",
          });

          throw error;
        }
      },

      // ========================================================================
      // LOGOUT
      // ========================================================================
      logout: () => {
        // Clear token
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
