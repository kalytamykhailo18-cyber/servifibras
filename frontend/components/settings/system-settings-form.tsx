"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api/endpoints";
import { toast } from "sonner";
import RefreshIcon from "@mui/icons-material/Refresh";
import SaveIcon from "@mui/icons-material/Save";
import SettingsIcon from "@mui/icons-material/Settings";
import WarningIcon from "@mui/icons-material/Warning";

interface SystemConfig {
  maintenanceMode: boolean;
  maxConcurrentConversations: number;
  sessionTimeoutMinutes: number;
  backupEnabled: boolean;
  logLevel: string;
  features: {
    aiAutoResponse: boolean;
    knowledgeBase: boolean;
    analytics: boolean;
    multiChannel: boolean;
  };
}

const FIELD_LABEL = "text-xs font-medium uppercase tracking-wide text-slate-500";

export function SystemSettingsForm() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<SystemConfig>({
    defaultValues: {
      maintenanceMode: false,
      maxConcurrentConversations: 100,
      sessionTimeoutMinutes: 30,
      backupEnabled: true,
      logLevel: "info",
      features: {
        aiAutoResponse: true,
        knowledgeBase: true,
        analytics: true,
        multiChannel: true,
      },
    },
  });

  const fetchSystemConfig = async () => {
    try {
      setIsLoading(true);
      const config = await api.config.getSystem();
      form.reset({
        maintenanceMode: config.maintenanceMode || false,
        maxConcurrentConversations: config.maxConcurrentConversations || 100,
        sessionTimeoutMinutes: config.sessionTimeoutMinutes || 30,
        backupEnabled: config.backupEnabled !== false,
        logLevel: config.logLevel || "info",
        features: {
          aiAutoResponse: config.features?.aiAutoResponse !== false,
          knowledgeBase: config.features?.knowledgeBase !== false,
          analytics: config.features?.analytics !== false,
          multiChannel: config.features?.multiChannel !== false,
        },
      });
    } catch (error: any) {
      toast.error(error.message || "Error al cargar configuración del sistema");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSystemConfig();
  }, []);

  const onSubmit = async (data: SystemConfig) => {
    try {
      setIsSaving(true);
      await api.config.updateSystem(data);
      toast.success("Configuración del sistema actualizada correctamente");
    } catch (error: any) {
      toast.error(error.message || "Error al actualizar configuración");
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className="mb-5 flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <div className="space-y-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const maintenanceMode = form.watch("maintenanceMode");

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-slate-700 to-zinc-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(100_116_139/0.45)]">
          <SettingsIcon sx={{ fontSize: 22 }} />
        </span>
        <div>
          <h2 className="text-base font-semibold text-slate-900">Configuración del Sistema</h2>
          <p className="text-xs text-slate-500">
            Ajustes generales del sistema y funcionalidades
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          {maintenanceMode && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200/70 bg-amber-50/80 px-4 py-3 text-sm text-amber-800">
              <WarningIcon sx={{ fontSize: 18 }} className="mt-0.5 shrink-0 text-amber-600" />
              <span>
                El modo mantenimiento deshabilitará el acceso al sistema para todos los usuarios
                excepto administradores.
              </span>
            </div>
          )}

          <FormField
            control={form.control}
            name="maintenanceMode"
            render={({ field }) => (
              <FormItem
                className={`flex flex-row items-center justify-between gap-3 rounded-xl border p-4 transition-colors duration-200 space-y-0 ${
                  field.value
                    ? "border-amber-300/80 bg-amber-50/60"
                    : "border-slate-200 bg-slate-50/50"
                }`}
              >
                <div className="min-w-0">
                  <FormLabel className="block text-sm font-semibold text-slate-900">
                    Modo Mantenimiento
                  </FormLabel>
                  <FormDescription className="text-xs text-slate-600">
                    Deshabilitar acceso al sistema temporalmente
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="maxConcurrentConversations"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className={FIELD_LABEL}>Máx. Conversaciones Concurrentes</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="1"
                      max="1000"
                      {...field}
                      onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                    />
                  </FormControl>
                  <FormDescription className="text-[11px] text-slate-500">
                    Conversaciones activas simultáneas
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sessionTimeoutMinutes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className={FIELD_LABEL}>Timeout de Sesión (min)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="5"
                      max="1440"
                      {...field}
                      onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                    />
                  </FormControl>
                  <FormDescription className="text-[11px] text-slate-500">
                    Inactividad antes de cerrar sesión
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="backupEnabled"
            render={({ field }) => (
              <FormItem
                className={`flex flex-row items-center justify-between gap-3 rounded-xl border p-4 transition-colors duration-200 space-y-0 ${
                  field.value
                    ? "border-emerald-200/70 bg-emerald-50/50"
                    : "border-slate-200 bg-slate-50/50"
                }`}
              >
                <div className="min-w-0">
                  <FormLabel className="block text-sm font-semibold text-slate-900">
                    Backups Automáticos
                  </FormLabel>
                  <FormDescription className="text-xs text-slate-600">
                    Habilitar backups automáticos de la base de datos
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="logLevel"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={FIELD_LABEL}>Nivel de Logging</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="error">Error</SelectItem>
                    <SelectItem value="warn">Warning</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="debug">Debug</SelectItem>
                    <SelectItem value="verbose">Verbose</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription className="text-[11px] text-slate-500">
                  Nivel de detalle para los logs del sistema
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Features grid */}
          <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-4">
            <p className={`mb-3 ${FIELD_LABEL}`}>Funcionalidades del Sistema</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="features.aiAutoResponse"
                render={({ field }) => (
                  <FeatureRow label="Respuestas Automáticas IA" dot="bg-violet-500" field={field} />
                )}
              />
              <FormField
                control={form.control}
                name="features.knowledgeBase"
                render={({ field }) => (
                  <FeatureRow label="Base de Conocimiento" dot="bg-violet-500" field={field} />
                )}
              />
              <FormField
                control={form.control}
                name="features.analytics"
                render={({ field }) => (
                  <FeatureRow label="Analíticas y Reportes" dot="bg-pink-500" field={field} />
                )}
              />
              <FormField
                control={form.control}
                name="features.multiChannel"
                render={({ field }) => (
                  <FeatureRow label="Soporte Multi-Canal" dot="bg-blue-500" field={field} />
                )}
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-slate-700 to-zinc-600 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(100_116_139/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(100_116_139/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
            >
              {isSaving ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Guardando...
                </>
              ) : (
                <>
                  <SaveIcon sx={{ fontSize: 16 }} />
                  Guardar Cambios
                </>
              )}
            </button>
            <button
              type="button"
              onClick={fetchSystemConfig}
              disabled={isLoading}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] disabled:opacity-60"
            >
              <RefreshIcon sx={{ fontSize: 16 }} />
              Recargar
            </button>
          </div>
        </form>
      </Form>
    </div>
  );
}

function FeatureRow({
  label,
  dot,
  field,
}: {
  label: string;
  dot: string;
  field: { value: boolean; onChange: (v: boolean) => void };
}) {
  return (
    <FormItem className="flex flex-row items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 space-y-0">
      <FormLabel className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </FormLabel>
      <FormControl>
        <Switch checked={field.value} onCheckedChange={field.onChange} />
      </FormControl>
    </FormItem>
  );
}
