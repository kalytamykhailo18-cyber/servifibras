"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api/endpoints";
import { Channel, CHANNEL_LABELS } from "@/types";
import { toast } from "sonner";
import SaveIcon from "@mui/icons-material/Save";
import WifiIcon from "@mui/icons-material/Wifi";

interface ChannelConfig {
  enabled: boolean;
  apiKey?: string;
  apiSecret?: string;
  webhookUrl?: string;
  autoResponse: boolean;
  responseDelay?: number;
  businessHours?: {
    start: string;
    end: string;
  };
}

const FIELD_LABEL = "text-xs font-medium uppercase tracking-wide text-slate-500";

export function ChannelConfigForm() {
  const [activeChannel, setActiveChannel] = useState<Channel>(Channel.WHATSAPP);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<ChannelConfig>({
    defaultValues: {
      enabled: false,
      apiKey: "",
      apiSecret: "",
      webhookUrl: "",
      autoResponse: true,
      responseDelay: 1,
      businessHours: {
        start: "09:00",
        end: "18:00",
      },
    },
  });

  const fetchChannelConfig = async (channel: Channel) => {
    try {
      setIsLoading(true);
      const config = await api.config.getChannel(channel);
      form.reset({
        enabled: config.enabled || false,
        apiKey: config.apiKey || "",
        apiSecret: config.apiSecret || "",
        webhookUrl: config.webhookUrl || "",
        autoResponse: config.autoResponse !== false,
        responseDelay: config.responseDelay || 1,
        businessHours: config.businessHours || { start: "09:00", end: "18:00" },
      });
    } catch (error: any) {
      toast.error(error.message || "Error al cargar configuración del canal");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchChannelConfig(activeChannel);
  }, [activeChannel]);

  const onSubmit = async (data: ChannelConfig) => {
    try {
      setIsSaving(true);
      await api.config.updateChannel(activeChannel, data);
      toast.success(`Configuración de ${CHANNEL_LABELS[activeChannel]} actualizada`);
    } catch (error: any) {
      toast.error(error.message || "Error al actualizar configuración");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(59_130_246/0.45)]">
          <WifiIcon sx={{ fontSize: 22 }} />
        </span>
        <div>
          <h2 className="text-base font-semibold text-slate-900">Configuración de Canales</h2>
          <p className="text-xs text-slate-500">
            Gestiona la configuración de cada canal de comunicación
          </p>
        </div>
      </div>

      <Tabs value={activeChannel} onValueChange={(value) => setActiveChannel(value as Channel)}>
        <TabsList className="flex h-auto w-full flex-wrap gap-1 rounded-2xl border border-slate-200/70 bg-slate-100/60 p-1.5">
          {Object.entries(CHANNEL_LABELS).map(([key, label]) => (
            <TabsTrigger
              key={key}
              value={key}
              className="flex-1 rounded-xl border-0 px-3 py-2 text-xs font-medium text-slate-600 transition-all duration-200 hover:text-slate-900 data-active:bg-white data-active:text-blue-700 data-active:shadow-[0_4px_12px_-2px_rgb(15_23_42/0.08)]"
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {Object.keys(CHANNEL_LABELS).map((channel) => (
          <TabsContent key={channel} value={channel} className="mt-5 space-y-4">
            {isLoading ? (
              <div className="space-y-4">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-20 rounded-xl" />
                ))}
              </div>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                  <FormField
                    control={form.control}
                    name="enabled"
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
                            Canal Habilitado
                          </FormLabel>
                          <FormDescription className="text-xs text-slate-600">
                            {field.value
                              ? "Activo — los mensajes de este canal serán procesados."
                              : "Inactivo — el canal está desactivado."}
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
                    name="apiKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={FIELD_LABEL}>API Key</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="••••••••••••" {...field} />
                        </FormControl>
                        <FormDescription className="text-[11px] text-slate-500">
                          Clave de API del canal
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="apiSecret"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={FIELD_LABEL}>API Secret</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="••••••••••••" {...field} />
                        </FormControl>
                        <FormDescription className="text-[11px] text-slate-500">
                          Secreto de API del canal
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="webhookUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={FIELD_LABEL}>Webhook URL</FormLabel>
                        <FormControl>
                          <Input placeholder="https://..." {...field} />
                        </FormControl>
                        <FormDescription className="text-[11px] text-slate-500">
                          URL del webhook para recibir mensajes
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="autoResponse"
                    render={({ field }) => (
                      <FormItem
                        className={`flex flex-row items-center justify-between gap-3 rounded-xl border p-4 transition-colors duration-200 space-y-0 ${
                          field.value
                            ? "border-blue-200/70 bg-blue-50/50"
                            : "border-slate-200 bg-slate-50/50"
                        }`}
                      >
                        <div className="min-w-0">
                          <FormLabel className="block text-sm font-semibold text-slate-900">
                            Respuesta Automática
                          </FormLabel>
                          <FormDescription className="text-xs text-slate-600">
                            Activar respuestas automáticas para este canal
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
                    name="responseDelay"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={FIELD_LABEL}>Delay de Respuesta (segundos)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            max="60"
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                          />
                        </FormControl>
                        <FormDescription className="text-[11px] text-slate-500">
                          Tiempo de espera antes de enviar respuesta automática
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div>
                    <p className={`mb-2 ${FIELD_LABEL}`}>Horario de Atención</p>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name="businessHours.start"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[11px] font-medium text-slate-500">
                              Inicio
                            </FormLabel>
                            <FormControl>
                              <Input type="time" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="businessHours.end"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-[11px] font-medium text-slate-500">
                              Fin
                            </FormLabel>
                            <FormControl>
                              <Input type="time" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSaving}
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(59_130_246/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(59_130_246/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
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
                </form>
              </Form>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
