// ============================================================================
// SERVIFIBRAS API CLIENT
// ============================================================================
// Axios client with auth token management and error handling
// ============================================================================

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from "axios";
import type { ApiError } from "@/types";

// ============================================================================
// TOKEN MANAGEMENT
// ============================================================================

const TOKEN_KEY = "servifibras_auth_token";

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
};

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

apiClient.interceptors.response.use(
  (response) => {
    // Unwrap {success, data} wrapper if present
    if (response.data && response.data.success !== undefined && response.data.data !== undefined) {
      response.data = response.data.data;
    }
    return response;
  },
  (error: AxiosError<ApiError>) => {
    // Handle 401 Unauthorized - clear token and redirect to login
    if (error.response?.status === 401) {
      tokenManager.remove();

      // Only redirect if we're in the browser
      if (typeof window !== "undefined") {
        // Check if we're not already on the login page
        if (!window.location.pathname.includes("/login")) {
          window.location.href = "/login";
        }
      }
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
 * Set auth token for all future requests
 */
export function setAuthToken(token: string): void {
  tokenManager.set(token);
}

/**
 * Clear auth token and logout
 */
export function clearAuthToken(): void {
  tokenManager.remove();
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return tokenManager.get() !== null;
}
