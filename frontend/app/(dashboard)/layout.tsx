"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth-store";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

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
      <Sidebar />
      <div className="lg:pl-64">
        <Header />
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
