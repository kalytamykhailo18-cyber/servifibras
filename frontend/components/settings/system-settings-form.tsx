"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { Save, RefreshCw, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-96" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const maintenanceMode = form.watch("maintenanceMode");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuración del Sistema</CardTitle>
        <CardDescription>
          Ajustes generales del sistema y funcionalidades
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Maintenance Mode Warning */}
            {maintenanceMode && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  El modo mantenimiento deshabilitará el acceso al sistema para todos los usuarios
                  excepto administradores.
                </AlertDescription>
              </Alert>
            )}

            {/* Maintenance Mode */}
            <FormField
              control={form.control}
              name="maintenanceMode"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Modo Mantenimiento</FormLabel>
                    <FormDescription>
                      Deshabilitar acceso al sistema temporalmente
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            {/* Max Concurrent Conversations */}
            <FormField
              control={form.control}
              name="maxConcurrentConversations"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Máximo de Conversaciones Concurrentes</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="1"
                      max="1000"
                      {...field}
                      onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                    />
                  </FormControl>
                  <FormDescription>
                    Número máximo de conversaciones activas simultáneas
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Session Timeout */}
            <FormField
              control={form.control}
              name="sessionTimeoutMinutes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Timeout de Sesión (minutos)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="5"
                      max="1440"
                      {...field}
                      onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                    />
                  </FormControl>
                  <FormDescription>
                    Tiempo de inactividad antes de cerrar la sesión automáticamente
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Backup Enabled */}
            <FormField
              control={form.control}
              name="backupEnabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Backups Automáticos</FormLabel>
                    <FormDescription>
                      Habilitar backups automáticos de la base de datos
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            {/* Log Level */}
            <FormField
              control={form.control}
              name="logLevel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nivel de Logging</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
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
                  <FormDescription>
                    Nivel de detalle para los logs del sistema
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Features */}
            <div className="space-y-4">
              <FormLabel>Funcionalidades del Sistema</FormLabel>

              <FormField
                control={form.control}
                name="features.aiAutoResponse"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel className="text-sm">Respuestas Automáticas IA</FormLabel>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="features.knowledgeBase"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel className="text-sm">Base de Conocimiento</FormLabel>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="features.analytics"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel className="text-sm">Analíticas y Reportes</FormLabel>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="features.multiChannel"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel className="text-sm">Soporte Multi-Canal</FormLabel>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={isSaving}>
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? "Guardando..." : "Guardar Cambios"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={fetchSystemConfig}
                disabled={isLoading}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Recargar
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
