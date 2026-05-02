"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/endpoints";
import { toast } from "sonner";
import RefreshIcon from "@mui/icons-material/Refresh";
import SaveIcon from "@mui/icons-material/Save";
import SmartToyIcon from "@mui/icons-material/SmartToy";

const aiSettingsSchema = z.object({
  model: z.string().min(1, "Modelo es requerido"),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().min(1).max(4000),
  systemPrompt: z.string().min(1, "Prompt del sistema es requerido"),
  autoResponseEnabled: z.boolean(),
  confidenceThreshold: z.number().min(0).max(1),
  escalationKeywords: z.string(),
});

type AISettingsData = z.infer<typeof aiSettingsSchema>;

const FIELD_LABEL = "text-xs font-medium uppercase tracking-wide text-slate-500";

export function AISettingsForm() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<AISettingsData>({
    resolver: zodResolver(aiSettingsSchema),
    defaultValues: {
      model: "gpt-4",
      temperature: 0.7,
      maxTokens: 2000,
      systemPrompt: "",
      autoResponseEnabled: true,
      confidenceThreshold: 0.8,
      escalationKeywords: "",
    },
  });

  const fetchAIConfig = async () => {
    try {
      setIsLoading(true);
      const config = await api.config.getAI();
      form.reset({
        model: config.model || "gpt-4",
        temperature: config.temperature || 0.7,
        maxTokens: config.maxTokens || 2000,
        systemPrompt: config.systemPrompt || "",
        autoResponseEnabled: config.autoResponseEnabled !== false,
        confidenceThreshold: config.confidenceThreshold || 0.8,
        escalationKeywords: config.escalationKeywords?.join(", ") || "",
      });
    } catch (error: any) {
      toast.error(error.message || "Error al cargar configuración");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAIConfig();
  }, []);

  const onSubmit = async (data: AISettingsData) => {
    try {
      setIsSaving(true);

      const keywords = data.escalationKeywords
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0);

      await api.config.updateAI({
        model: data.model,
        temperature: data.temperature,
        maxTokens: data.maxTokens,
        systemPrompt: data.systemPrompt,
        autoResponseEnabled: data.autoResponseEnabled,
        confidenceThreshold: data.confidenceThreshold,
        escalationKeywords: keywords,
      });

      toast.success("Configuración de IA actualizada correctamente");
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

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      {/* Section header */}
      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(139_92_246/0.45)]">
          <SmartToyIcon sx={{ fontSize: 22 }} />
        </span>
        <div>
          <h2 className="text-base font-semibold text-slate-900">Configuración de IA</h2>
          <p className="text-xs text-slate-500">
            Configura el comportamiento del asistente virtual y el modelo de IA
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <FormField
            control={form.control}
            name="model"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={FIELD_LABEL}>Modelo de IA</FormLabel>
                <FormControl>
                  <Input placeholder="gpt-4" {...field} />
                </FormControl>
                <FormDescription className="text-[11px] text-slate-500">
                  Modelo de lenguaje a utilizar (ej: gpt-4, gpt-3.5-turbo)
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="temperature"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className={FIELD_LABEL}>Temperatura (0-2)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      {...field}
                      onChange={(e) => field.onChange(parseFloat(e.target.value))}
                    />
                  </FormControl>
                  <FormDescription className="text-[11px] text-slate-500">
                    Creatividad de las respuestas
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="maxTokens"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className={FIELD_LABEL}>Max Tokens</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="1"
                      max="4000"
                      {...field}
                      onChange={(e) => field.onChange(parseInt(e.target.value))}
                    />
                  </FormControl>
                  <FormDescription className="text-[11px] text-slate-500">
                    Longitud máxima de respuesta
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="systemPrompt"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={FIELD_LABEL}>Prompt del Sistema</FormLabel>
                <FormControl>
                  <Textarea
                    rows={6}
                    className="resize-none font-mono text-[13px] leading-relaxed"
                    placeholder="Eres un asistente virtual especializado en..."
                    {...field}
                  />
                </FormControl>
                <FormDescription className="text-[11px] text-slate-500">
                  Instrucciones base para el comportamiento de la IA
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="autoResponseEnabled"
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
                    Respuesta Automática
                  </FormLabel>
                  <FormDescription className="text-xs text-slate-600">
                    {field.value
                      ? "Activa — la IA responderá automáticamente a los mensajes."
                      : "Desactivada — todos los mensajes requieren intervención humana."}
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
            name="confidenceThreshold"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={FIELD_LABEL}>Umbral de Confianza (0-1)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    {...field}
                    onChange={(e) => field.onChange(parseFloat(e.target.value))}
                  />
                </FormControl>
                <FormDescription className="text-[11px] text-slate-500">
                  Nivel mínimo de confianza para responder automáticamente
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="escalationKeywords"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={FIELD_LABEL}>Palabras Clave de Escalación</FormLabel>
                <FormControl>
                  <Textarea
                    rows={3}
                    className="resize-none"
                    placeholder="urgente, problema, error, reclamo (separados por comas)"
                    {...field}
                  />
                </FormControl>
                <FormDescription className="text-[11px] text-slate-500">
                  Palabras que activan la derivación a un humano
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(139_92_246/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(139_92_246/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
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
              onClick={fetchAIConfig}
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
