"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { RealtimeNotifications } from "@/components/layout/realtime-notifications";

const TOKEN_KEY = "servifibras_auth_token";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { isAuthenticated, checkAuth } = useAuthStore();
  // Gate the entire layout on a synchronous token check so we don't redirect
  // to /login during the brief moment before Zustand persist rehydrates the
  // store from localStorage. Without this, navigation to any dashboard route
  // bounces through /login → /conversations.
  const [bootstrapped, setBootstrapped] = useState(false);
  // Mobile nav drawer state — lifted here so Header can open it and Sidebar
  // can close it. At lg+ the drawer is permanently visible regardless.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      router.replace("/login");
      return;
    }
    checkAuth().finally(() => setBootstrapped(true));
  }, [checkAuth, router]);

  // After bootstrap, trust the store. If it ever goes false (logout, expired
  // token), bounce back to login.
  useEffect(() => {
    if (bootstrapped && !isAuthenticated) {
      router.replace("/login");
    }
  }, [bootstrapped, isAuthenticated, router]);

  // Cross-tab logout: if another tab clears the access token (or the
  // zustand-persisted auth state), this tab bounces too. Without this,
  // tab B keeps a stale `isAuthenticated:true` in memory and the user
  // sees the dashboard while their session is actually dead — the next
  // API call would 401 and produce a surprise redirect.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOKEN_KEY && e.newValue === null) {
        window.location.href = "/login";
      } else if (e.key === "servifibras-auth" && e.newValue === null) {
        window.location.href = "/login";
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  if (!bootstrapped) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
          <p className="mt-4 text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <RealtimeNotifications />
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="lg:pl-64">
        <Header onMenuClick={() => setMobileNavOpen(true)} />
        <main className="p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
