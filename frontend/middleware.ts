// ============================================================================
// SERVIFIBRAS MIDDLEWARE - Route Protection
// ============================================================================
// NOTE: Middleware runs on the server and cannot access localStorage.
// Auth protection is handled by the dashboard layout component on the client.
// This middleware only handles basic public/auth route redirects.
// ============================================================================

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // Middleware cannot access localStorage (client-side only)
  // Route protection is handled by dashboard layout component
  // Just allow all requests to pass through
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api routes
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
