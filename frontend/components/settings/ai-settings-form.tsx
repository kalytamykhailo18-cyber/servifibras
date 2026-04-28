"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/endpoints";
import { toast } from "sonner";
import { Save, RefreshCw } from "lucide-react";

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuración de IA</CardTitle>
        <CardDescription>
          Configura el comportamiento del asistente virtual y el modelo de IA
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Model */}
            <FormField
              control={form.control}
              name="model"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Modelo de IA</FormLabel>
                  <FormControl>
                    <Input placeholder="gpt-4" {...field} />
                  </FormControl>
                  <FormDescription>
                    Modelo de lenguaje a utilizar (ej: gpt-4, gpt-3.5-turbo)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              {/* Temperature */}
              <FormField
                control={form.control}
                name="temperature"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Temperatura (0-2)</FormLabel>
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
                    <FormDescription>Creatividad de las respuestas</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Max Tokens */}
              <FormField
                control={form.control}
                name="maxTokens"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Tokens</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        max="4000"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value))}
                      />
                    </FormControl>
                    <FormDescription>Longitud máxima de respuesta</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* System Prompt */}
            <FormField
              control={form.control}
              name="systemPrompt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Prompt del Sistema</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={6}
                      placeholder="Eres un asistente virtual especializado en..."
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Instrucciones base para el comportamiento de la IA
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Auto Response Enabled */}
            <FormField
              control={form.control}
              name="autoResponseEnabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Respuesta Automática</FormLabel>
                    <FormDescription>
                      Permite que la IA responda automáticamente a los mensajes
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            {/* Confidence Threshold */}
            <FormField
              control={form.control}
              name="confidenceThreshold"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Umbral de Confianza (0-1)</FormLabel>
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
                  <FormDescription>
                    Nivel mínimo de confianza para responder automáticamente
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Escalation Keywords */}
            <FormField
              control={form.control}
              name="escalationKeywords"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Palabras Clave de Escalación</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="urgente, problema, error, reclamo (separados por comas)"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Palabras que activan la derivación a un humano
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-2">
              <Button type="submit" disabled={isSaving}>
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? "Guardando..." : "Guardar Cambios"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={fetchAIConfig}
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
