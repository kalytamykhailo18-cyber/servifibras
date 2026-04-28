"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/endpoints";
import { toast } from "sonner";
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';

interface PricingConfig {
  currency: string;
  taxRate: number;
  discountRules: string;
  shippingRates: string;
}

export function PricingForm() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<PricingConfig>({
    defaultValues: {
      currency: "USD",
      taxRate: 0,
      discountRules: "[]",
      shippingRates: "{}",
    },
  });

  const fetchPricingConfig = async () => {
    try {
      setIsLoading(true);
      const config = await api.config.getPricing();

      form.reset({
        currency: config.currency || "USD",
        taxRate: config.taxRate || 0,
        discountRules: JSON.stringify(config.discountRules || [], null, 2),
        shippingRates: JSON.stringify(config.shippingRates || {}, null, 2),
      });
    } catch (error: any) {
      toast.error(error.message || "Error al cargar configuración de precios");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPricingConfig();
  }, []);

  const onSubmit = async (data: PricingConfig) => {
    try {
      setIsSaving(true);

      // Parse JSON fields
      let discountRules, shippingRates;
      try {
        discountRules = JSON.parse(data.discountRules);
        shippingRates = JSON.parse(data.shippingRates);
      } catch {
        toast.error("Error: JSON inválido en reglas de descuento o tarifas de envío");
        return;
      }

      await api.config.updatePricing({
        currency: data.currency,
        taxRate: data.taxRate,
        discountRules,
        shippingRates,
      });

      toast.success("Configuración de precios actualizada correctamente");
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
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuración de Precios</CardTitle>
        <CardDescription>
          Configura la moneda, impuestos, descuentos y tarifas de envío
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Currency */}
            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Moneda Predeterminada</FormLabel>
                  <FormControl>
                    <Input placeholder="USD" {...field} />
                  </FormControl>
                  <FormDescription>
                    Moneda base del sistema (USD, ARS, EUR, etc.)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Tax Rate */}
            <FormField
              control={form.control}
              name="taxRate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tasa de Impuesto (%)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      {...field}
                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                    />
                  </FormControl>
                  <FormDescription>
                    Tasa de impuesto aplicable a las ventas (IVA, sales tax, etc.)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Discount Rules */}
            <FormField
              control={form.control}
              name="discountRules"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reglas de Descuento (JSON)</FormLabel>
                  <FormControl>
                    <textarea
                      className="w-full min-h-[150px] p-3 border rounded-md font-mono text-sm"
                      placeholder='[{"name":"Mayorista","percentage":15,"conditions":{}}]'
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Array JSON con reglas de descuento automático
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Shipping Rates */}
            <FormField
              control={form.control}
              name="shippingRates"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tarifas de Envío (JSON)</FormLabel>
                  <FormControl>
                    <textarea
                      className="w-full min-h-[150px] p-3 border rounded-md font-mono text-sm"
                      placeholder='{"CABA":500,"GBA":800,"Interior":1200}'
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Objeto JSON con tarifas de envío por zona
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-2">
              <Button type="submit" disabled={isSaving}>
                <SaveIcon className="h-4 w-4 mr-2" />
                {isSaving ? "Guardando..." : "Guardar Cambios"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={fetchPricingConfig}
                disabled={isLoading}
              >
                <RefreshIcon className="h-4 w-4 mr-2" />
                Recargar
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
