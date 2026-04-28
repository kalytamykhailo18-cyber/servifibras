"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api/endpoints";
import { Channel, CHANNEL_LABELS } from "@/types";
import { toast } from "sonner";
import SaveIcon from '@mui/icons-material/Save';

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
        businessHours: config.businessHours || {
          start: "09:00",
          end: "18:00",
        },
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
    <Card>
      <CardHeader>
        <CardTitle>Configuración de Canales</CardTitle>
        <CardDescription>
          Gestiona la configuración de cada canal de comunicación
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeChannel} onValueChange={(value) => setActiveChannel(value as Channel)}>
          <TabsList className="grid w-full grid-cols-5">
            {Object.entries(CHANNEL_LABELS).map(([key, label]) => (
              <TabsTrigger key={key} value={key}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          {Object.keys(CHANNEL_LABELS).map((channel) => (
            <TabsContent key={channel} value={channel} className="space-y-4 mt-6">
              {isLoading ? (
                <div className="space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-20" />
                  ))}
                </div>
              ) : (
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    {/* Enabled */}
                    <FormField
                      control={form.control}
                      name="enabled"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base">Canal Habilitado</FormLabel>
                            <FormDescription>
                              Activar o desactivar este canal de comunicación
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    {/* API Key */}
                    <FormField
                      control={form.control}
                      name="apiKey"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>API Key</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="••••••••••••" {...field} />
                          </FormControl>
                          <FormDescription>
                            Clave de API del canal
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* API Secret */}
                    <FormField
                      control={form.control}
                      name="apiSecret"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>API Secret</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="••••••••••••" {...field} />
                          </FormControl>
                          <FormDescription>
                            Secreto de API del canal
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Webhook URL */}
                    <FormField
                      control={form.control}
                      name="webhookUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Webhook URL</FormLabel>
                          <FormControl>
                            <Input placeholder="https://..." {...field} />
                          </FormControl>
                          <FormDescription>
                            URL del webhook para recibir mensajes
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Auto Response */}
                    <FormField
                      control={form.control}
                      name="autoResponse"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <FormLabel className="text-base">Respuesta Automática</FormLabel>
                            <FormDescription>
                              Activar respuestas automáticas para este canal
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    {/* Response Delay */}
                    <FormField
                      control={form.control}
                      name="responseDelay"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Delay de Respuesta (segundos)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min="0"
                              max="60"
                              {...field}
                              onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormDescription>
                            Tiempo de espera antes de enviar respuesta automática
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Business Hours */}
                    <div className="space-y-4">
                      <FormLabel>Horario de Atención</FormLabel>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="businessHours.start"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Inicio</FormLabel>
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
                              <FormLabel>Fin</FormLabel>
                              <FormControl>
                                <Input type="time" {...field} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    <Button type="submit" disabled={isSaving}>
                      <SaveIcon className="h-4 w-4 mr-2" />
                      {isSaving ? "Guardando..." : "Guardar Cambios"}
                    </Button>
                  </form>
                </Form>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
