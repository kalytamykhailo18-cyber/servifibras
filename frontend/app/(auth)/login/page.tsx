"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuthStore } from "@/lib/store/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { LoginFormData } from "@/types";

// ============================================================================
// FORM VALIDATION SCHEMA
// ============================================================================

const loginSchema = z.object({
  email: z
    .string()
    .min(1, "El email es requerido")
    .email("Email inválido"),
  password: z
    .string()
    .min(1, "La contraseña es requerida")
    .min(6, "La contraseña debe tener al menos 6 caracteres"),
});

// ============================================================================
// LOGIN PAGE
// ============================================================================

export default function LoginPage() {
  const router = useRouter();
  const { login, error: authError, clearError } = useAuthStore();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  // ========================================================================
  // HANDLE LOGIN SUBMIT
  // ========================================================================

  const onSubmit = async (data: LoginFormData) => {
    setIsSubmitting(true);
    clearError();

    try {
      await login(data);
      // On success, redirect to dashboard home
      router.push("/");
    } catch (error) {
      // Error is handled by auth store
      console.error("Login failed:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <Card className="shadow-2xl border-0">
      <CardHeader className="space-y-1">
        <CardTitle className="text-3xl font-bold text-center">
          Servifibras
        </CardTitle>
        <CardDescription className="text-center text-base">
          Panel de Administración
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* ERROR ALERT */}
          {authError && (
            <Alert variant="destructive">
              <AlertDescription>{authError}</AlertDescription>
            </Alert>
          )}

          {/* EMAIL FIELD */}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="tu@email.com"
              autoComplete="email"
              disabled={isSubmitting}
              {...register("email")}
              className={errors.email ? "border-destructive" : ""}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          {/* PASSWORD FIELD */}
          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={isSubmitting}
              {...register("password")}
              className={errors.password ? "border-destructive" : ""}
            />
            {errors.password && (
              <p className="text-sm text-destructive">{errors.password.message}</p>
            )}
          </div>

          {/* SUBMIT BUTTON */}
          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Iniciando sesión..." : "Iniciar Sesión"}
          </Button>
        </form>

        {/* DEMO CREDENTIALS HINT (Remove in production) */}
        <div className="mt-6 p-4 bg-muted rounded-lg">
          <p className="text-xs text-muted-foreground text-center">
            Usuarios de prueba:
          </p>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <p>• Admin: admin@servifibras.com</p>
            <p>• Brenda: brenda@servifibras.com</p>
            <p>• Franco: franco@servifibras.com</p>
            <p>• Aldo: aldo@servifibras.com</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
