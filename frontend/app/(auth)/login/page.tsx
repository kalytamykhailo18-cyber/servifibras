"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuthStore } from "@/lib/store/auth-store";
import type { LoginFormData } from "@/types";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import MailOutlineIcon from "@mui/icons-material/MailOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";

const loginSchema = z.object({
  email: z.string().min(1, "El email es requerido").email("Email inválido"),
  password: z
    .string()
    .min(1, "La contraseña es requerida")
    .min(6, "La contraseña debe tener al menos 6 caracteres"),
});

const DEMO_USERS = [
  { name: "Admin", email: "admin@servifibras.com", color: "from-blue-500 to-cyan-400" },
  { name: "Brenda", email: "brenda@servifibras.com", color: "from-pink-500 to-rose-400" },
  { name: "Franco", email: "franco@servifibras.com", color: "from-emerald-500 to-teal-400" },
  { name: "Aldo", email: "aldo@servifibras.com", color: "from-amber-500 to-orange-400" },
];

export default function LoginPage() {
  const router = useRouter();
  const { login, error: authError, clearError } = useAuthStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Hydration guard. Before React hydrates, the `<form>` has no JS
  // submit handler attached — so a fast click would trigger the
  // browser's default GET submission with credentials in the query
  // string (the bug we kept seeing as a one-test-per-sweep flake).
  // Render the submit button disabled until this flips, which (a)
  // makes the default-submit path impossible to reach and (b) gives
  // Playwright a natural "wait for enabled" anchor so tests don't
  // need their own custom synchronisation.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  // Bounce reason (Bloque C — Marcos 2026-06-06, security gap #10).
  // When the apiClient interceptor redirects here with
  // ?reason=idle_expired we surface a toast instead of leaving the
  // user to wonder why they got kicked. We read window.location
  // directly inside a client-only effect — `useSearchParams` would
  // need a Suspense boundary in Next 15 prerender, which is heavier
  // than this one-shot read.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const reason = params.get("reason");
    if (reason === "idle_expired") {
      toast.message("Sesión vencida por inactividad", {
        description: "Iniciá sesión de nuevo para continuar.",
      });
    }
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsSubmitting(true);
    clearError();
    try {
      await login(data);
      router.push("/conversations");
    } catch (error) {
      console.error("Login failed:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const fillDemo = (email: string) => {
    setValue("email", email);
    setValue("password", "admin123");
    clearError();
  };

  return (
    <>
      {/* Immersive animated background — sits behind the card AND the auth chrome */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50/30 to-cyan-50/40">
        <div className="absolute -left-40 top-10 h-[28rem] w-[28rem] rounded-full bg-blue-300/40 blur-3xl animate-blob" />
        <div className="absolute right-0 top-1/3 h-[22rem] w-[22rem] rounded-full bg-cyan-300/40 blur-3xl animate-blob [animation-delay:-7s]" />
        <div className="absolute bottom-0 left-1/3 h-[26rem] w-[26rem] rounded-full bg-indigo-300/35 blur-3xl animate-blob [animation-delay:-13s]" />
        {/* Subtle grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(15_23_42/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(15_23_42/0.04)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>

      {/* Glass card */}
      <div className="relative animate-fade-up rounded-3xl border border-white/60 bg-white/70 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.18),0_0_0_1px_rgb(255_255_255/0.6)_inset] backdrop-blur-2xl backdrop-saturate-150 sm:p-8">
        {/* Logo + title — official Servifibras mark */}
        <div className="mb-7 text-center">
          <div className="mb-5 inline-flex animate-fade-up [animation-delay:0.1s]">
            <span className="animate-float">
              <Image
                src="/servifibras-mark.png"
                alt="Servifibras"
                width={72}
                height={72}
                priority
                className="h-16 w-16 object-contain"
              />
            </span>
          </div>
          <h1 className="animate-fade-up text-3xl font-bold tracking-[0.05em] text-slate-900 [animation-delay:0.2s]">
            SERVIFIBRAS
          </h1>
          <p className="mt-1 animate-fade-up text-sm text-slate-500 [animation-delay:0.3s]">
            Panel de Administración
          </p>
        </div>

        <form
          onSubmit={handleSubmit(onSubmit)}
          // `action="#"` is a defence-in-depth fallback: even if a fast
          // click somehow lands before the submit listener is wired,
          // the default form action stays on the page instead of
          // appending the credentials to the URL as query params.
          action="#"
          method="post"
          noValidate
          data-ready={hydrated ? "true" : "false"}
          data-testid="login-form"
          className="space-y-4"
        >
          {/* Auth error banner */}
          {authError && (
            <div className="flex animate-fade-up items-start gap-2 rounded-xl border border-red-200/70 bg-red-50/80 px-3.5 py-3 text-sm text-red-700">
              <ErrorOutlineIcon sx={{ fontSize: 18 }} className="mt-0.5 shrink-0" />
              <span>{authError}</span>
            </div>
          )}

          {/* Email */}
          <div className="animate-fade-up [animation-delay:0.4s]">
            <label htmlFor="email" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Email
            </label>
            <div className="group relative">
              <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-slate-400 transition-colors duration-300 group-focus-within:text-blue-600">
                <MailOutlineIcon sx={{ fontSize: 20 }} />
              </span>
              <input
                id="email"
                type="email"
                placeholder="tu@email.com"
                autoComplete="email"
                disabled={isSubmitting}
                {...register("email")}
                className={`h-12 w-full rounded-xl border bg-white/60 pl-11 pr-4 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all duration-200 focus:bg-white focus:ring-4 ${
                  errors.email
                    ? "border-red-400 focus:border-red-500 focus:ring-red-500/15"
                    : "border-slate-200 focus:border-blue-500 focus:ring-blue-500/15"
                }`}
              />
            </div>
            {errors.email && (
              <p className="mt-1.5 animate-fade-up text-xs text-red-600">{errors.email.message}</p>
            )}
          </div>

          {/* Password */}
          <div className="animate-fade-up [animation-delay:0.5s]">
            <label htmlFor="password" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Contraseña
            </label>
            <div className="group relative">
              <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-slate-400 transition-colors duration-300 group-focus-within:text-blue-600">
                <LockOutlinedIcon sx={{ fontSize: 20 }} />
              </span>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                autoComplete="current-password"
                disabled={isSubmitting}
                {...register("password")}
                className={`h-12 w-full rounded-xl border bg-white/60 pl-11 pr-11 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all duration-200 focus:bg-white focus:ring-4 ${
                  errors.password
                    ? "border-red-400 focus:border-red-500 focus:ring-red-500/15"
                    : "border-slate-200 focus:border-blue-500 focus:ring-blue-500/15"
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-700"
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {showPassword ? <VisibilityOffIcon sx={{ fontSize: 20 }} /> : <VisibilityIcon sx={{ fontSize: 20 }} />}
              </button>
            </div>
            {errors.password && (
              <p className="mt-1.5 animate-fade-up text-xs text-red-600">{errors.password.message}</p>
            )}
          </div>

          {/* Submit — gradient + continuous shimmer + lift + press */}
          <button
            type="submit"
            // Disabled until React hydrates so the submit listener is
            // guaranteed to be attached before the button accepts a
            // click — closes the SSR-render-to-hydration race that
            // produced the `/login?email=…&password=…` flake.
            disabled={isSubmitting || !hydrated}
            className="group relative mt-2 flex h-12 w-full animate-fade-up items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-sm font-medium text-white shadow-[0_8px_24px_-6px_rgb(59_130_246/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] [animation-delay:0.6s] hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-8px_rgb(59_130_246/0.7)] active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-[0_8px_24px_-6px_rgb(59_130_246/0.5)]"
          >
            {!isSubmitting && (
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
            )}
            {isSubmitting ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                <span className="relative">Iniciando sesión...</span>
              </>
            ) : (
              <>
                <span className="relative">Iniciar Sesión</span>
                <ArrowForwardIcon sx={{ fontSize: 18 }} className="relative transition-transform duration-300 group-hover:translate-x-1" />
              </>
            )}
          </button>
        </form>

        {/* Demo chips — click to auto-fill */}
        <div className="mt-7 animate-fade-up border-t border-slate-200/70 pt-5 [animation-delay:0.75s]">
          <p className="mb-3 text-center text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Cuentas de prueba
          </p>
          <div className="grid grid-cols-2 gap-2">
            {DEMO_USERS.map((u) => (
              <button
                key={u.email}
                type="button"
                onClick={() => fillDemo(u.email)}
                className="group flex items-center gap-2.5 rounded-xl border border-slate-200/70 bg-white/60 px-3 py-2 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300/70 hover:bg-white hover:shadow-[0_8px_20px_-6px_rgb(15_23_42/0.18)]"
              >
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${u.color} text-[11px] font-bold text-white shadow-sm transition-transform duration-300 group-hover:scale-110`}>
                  {u.name[0]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-slate-900">{u.name}</span>
                  <span className="block truncate text-[10px] text-slate-500">{u.email}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
