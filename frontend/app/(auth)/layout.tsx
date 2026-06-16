"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";
import { PublicHeader } from "@/components/layout/public-header";
import { PublicFooter } from "@/components/layout/public-footer";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  // Already-authenticated users landing on /login go straight to the
  // inbox — but only if the access token is ALSO present. Without this
  // guard, a stale zustand-persisted `isAuthenticated:true` (e.g. tokens
  // were cleared by `bounceToLogin` but the persistence somehow lingered)
  // would push the user to /conversations, which would in turn bounce
  // them here for missing tokens — an infinite ping-pong.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("servifibras_auth_token");
      if (!token) return;
    }
    router.push("/conversations");
  }, [isAuthenticated, router]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <PublicHeader />
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <PublicFooter />
    </div>
  );
}
