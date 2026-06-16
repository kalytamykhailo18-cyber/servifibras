"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore, selectUser } from "@/lib/store/auth-store";
import { UserRole } from "@/types";
import { toast } from "sonner";

// Page-level role guard — call from a "use client" page. If the logged-in
// user's role is not in `allowedRoles`, push them to /conversations (the one
// route every role can see) and surface a toast so they understand why.
//
// 2026-06-15: callers gate page render on `isAllowed`. We default `isAllowed`
// to FALSE while the auth store is still hydrating (user is null) so a
// disallowed user never sees the protected content during the rehydrate
// window — Brenda (ATENCION) was briefly seeing /quotes before the
// useEffect-driven redirect fired. The small loading flash is the right
// trade for never showing forbidden content.
export function useRoleGuard(allowedRoles: UserRole[]) {
  const router = useRouter();
  const user = useAuthStore(selectUser);

  useEffect(() => {
    if (!user) return;
    if (!allowedRoles.includes(user.role)) {
      toast.error("No tienes acceso a esta sección");
      router.replace("/conversations");
    }
  }, [user, allowedRoles, router]);

  // Render nothing until we know who the user is AND that they are allowed.
  // Pages early-return on !isAllowed, so a brief null render is invisible
  // (the layout's bootstrap spinner covers the auth-hydration gap).
  return {
    isAllowed: !!user && allowedRoles.includes(user.role),
  };
}
