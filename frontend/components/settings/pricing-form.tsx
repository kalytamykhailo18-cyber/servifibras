"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/endpoints";
import { toast } from "sonner";
import RefreshIcon from "@mui/icons-material/Refresh";
import SaveIcon from "@mui/icons-material/Save";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";

interface PricingConfig {
  currency: string;
  taxRate: number;
  discountRules: string;
  shippingRates: string;
}

const FIELD_LABEL = "text-xs font-medium uppercase tracking-wide text-slate-500";

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
      <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className="mb-5 flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <div className="space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(16_185_129/0.45)]">
          <AttachMoneyIcon sx={{ fontSize: 22 }} />
        </span>
        <div>
          <h2 className="text-base font-semibold text-slate-900">Configuración de Precios</h2>
          <p className="text-xs text-slate-500">
            Configura la moneda, impuestos, descuentos y tarifas de envío
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className={FIELD_LABEL}>Moneda Predeterminada</FormLabel>
                  <FormControl>
                    <Input placeholder="USD" {...field} />
                  </FormControl>
                  <FormDescription className="text-[11px] text-slate-500">
                    USD, ARS, EUR, etc.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="taxRate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className={FIELD_LABEL}>Tasa de Impuesto (%)</FormLabel>
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
                  <FormDescription className="text-[11px] text-slate-500">
                    IVA, sales tax, etc.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="discountRules"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={FIELD_LABEL}>Reglas de Descuento (JSON)</FormLabel>
                <FormControl>
                  <Textarea
                    className="resize-none font-mono text-[13px] leading-relaxed"
                    rows={6}
                    placeholder='[{"name":"Mayorista","percentage":15,"conditions":{}}]'
                    {...field}
                  />
                </FormControl>
                <FormDescription className="text-[11px] text-slate-500">
                  Array JSON con reglas de descuento automático
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="shippingRates"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={FIELD_LABEL}>Tarifas de Envío (JSON)</FormLabel>
                <FormControl>
                  <Textarea
                    className="resize-none font-mono text-[13px] leading-relaxed"
                    rows={6}
                    placeholder='{"CABA":500,"GBA":800,"Interior":1200}'
                    {...field}
                  />
                </FormControl>
                <FormDescription className="text-[11px] text-slate-500">
                  Objeto JSON con tarifas de envío por zona
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(16_185_129/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(16_185_129/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
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
              onClick={fetchPricingConfig}
              disabled={isLoading}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] disabled:opacity-60"
            >
              <RefreshIcon sx={{ fontSize: 16 }} className="text-blue-600" />
              Recargar
            </button>
          </div>
        </form>
      </Form>
    </div>
  );
}
