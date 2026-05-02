"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api/endpoints";
import type { Order, Contact } from "@/types";
import { toast } from "sonner";
import EditIcon from "@mui/icons-material/Edit";
import InventoryIcon from "@mui/icons-material/Inventory";

const orderSchema = z.object({
  contactId: z.string().min(1, "Contacto es requerido"),
  amount: z.number().min(0, "El monto debe ser mayor a 0"),
  currency: z.string().min(1),
  products: z.string().min(1, "Productos son requeridos"),
  notes: z.string().optional(),
});

type OrderFormData = z.infer<typeof orderSchema>;

interface OrderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order?: Order;
  onSuccess?: () => void;
}

export function OrderFormDialog({
  open,
  onOpenChange,
  order,
  onSuccess,
}: OrderFormDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const isEditing = !!order;

  const form = useForm<OrderFormData>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      contactId: order?.contactId || "",
      amount: order?.amount || 0,
      currency: order?.currency || "USD",
      products:
        typeof order?.products === "string"
          ? order.products
          : JSON.stringify(order?.products || [], null, 2),
      notes: order?.notes || "",
    },
  });

  useEffect(() => {
    const fetchContacts = async () => {
      try {
        const response = await api.contacts.list({ limit: 100 });
        setContacts(response.contacts);
      } catch (error) {
        console.error("Error fetching contacts:", error);
      }
    };

    if (open) {
      fetchContacts();
    }
  }, [open]);

  useEffect(() => {
    if (open && order) {
      form.reset({
        contactId: order.contactId,
        amount: order.amount,
        currency: order.currency,
        products:
          typeof order.products === "string"
            ? order.products
            : JSON.stringify(order.products || [], null, 2),
        notes: order.notes || "",
      });
    } else if (!open) {
      form.reset({
        contactId: "",
        amount: 0,
        currency: "USD",
        products: "",
        notes: "",
      });
    }
  }, [open, order, form]);

  const onSubmit = async (data: OrderFormData) => {
    try {
      setIsLoading(true);

      let productsData;
      try {
        productsData = JSON.parse(data.products);
      } catch {
        productsData = data.products;
      }

      if (isEditing) {
        await api.orders.update(order.id, {
          amount: data.amount,
          currency: data.currency,
          products: productsData,
          notes: data.notes,
        });
        toast.success("Pedido actualizado correctamente");
      } else {
        await api.orders.create({
          contactId: data.contactId,
          amount: data.amount,
          currency: data.currency,
          products: productsData,
          notes: data.notes,
        });
        toast.success("Pedido creado correctamente");
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      toast.error(error.message || "Error al guardar pedido");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150 sm:max-w-[600px]">
        <DialogHeader className="flex flex-row items-center gap-3 space-y-0">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-green-500 to-emerald-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(34_197_94/0.45)]">
            {isEditing ? <EditIcon sx={{ fontSize: 22 }} /> : <InventoryIcon sx={{ fontSize: 22 }} />}
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              {isEditing ? "Editar Pedido" : "Nuevo Pedido"}
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              {isEditing
                ? "Actualiza los datos del pedido"
                : "Crea un nuevo pedido confirmado"}
            </DialogDescription>
          </div>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-2 space-y-4">
            <FormField
              control={form.control}
              name="contactId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Cliente <span className="text-emerald-600">*</span>
                  </FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isEditing}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Selecciona un cliente" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {contacts.map((contact) => (
                        <SelectItem key={contact.id} value={contact.id}>
                          {contact.name || contact.phone || contact.email || "Sin nombre"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Monto <span className="text-emerald-600">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...field}
                        onChange={(e) =>
                          field.onChange(parseFloat(e.target.value) || 0)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Moneda
                    </FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="ARS">ARS</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="products"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Productos <span className="text-emerald-600">*</span>
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder='Ej: [{"name":"Resina Epoxi","qty":2,"price":500}] o texto libre'
                      rows={4}
                      className="resize-none font-mono text-[13px]"
                      {...field}
                    />
                  </FormControl>
                  <p className="mt-1 text-xs text-slate-500">
                    JSON o texto descriptivo de los productos.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Notas
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Instrucciones de entrega, observaciones..."
                      rows={3}
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-3">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-green-600 to-emerald-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(34_197_94/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(34_197_94/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
              >
                {isLoading ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Guardando...
                  </>
                ) : isEditing ? (
                  "Actualizar"
                ) : (
                  "Crear"
                )}
              </button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
