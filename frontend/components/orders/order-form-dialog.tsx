"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/endpoints";
import type { Order, Contact } from "@/types";
import { toast } from "sonner";

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
      products: typeof order?.products === "string"
        ? order.products
        : JSON.stringify(order?.products || [], null, 2),
      notes: order?.notes || "",
    },
  });

  // Fetch contacts for dropdown
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

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open && order) {
      form.reset({
        contactId: order.contactId,
        amount: order.amount,
        currency: order.currency,
        products: typeof order.products === "string"
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

      // Parse products JSON
      let productsData;
      try {
        productsData = JSON.parse(data.products);
      } catch {
        productsData = data.products; // Use as string if not valid JSON
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
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Editar Pedido" : "Nuevo Pedido"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Actualiza los datos del pedido"
              : "Crea un nuevo pedido confirmado"}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Contact */}
            <FormField
              control={form.control}
              name="contactId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cliente *</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isEditing}
                  >
                    <FormControl>
                      <SelectTrigger>
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

            {/* Amount and Currency */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monto *</FormLabel>
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
                    <FormLabel>Moneda</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
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

            {/* Products */}
            <FormField
              control={form.control}
              name="products"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Productos *</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder='Ej: [{"name":"Resina Epoxi","qty":2,"price":500}] o texto libre'
                      rows={4}
                      className="font-mono text-xs"
                      {...field}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    JSON o texto descriptivo de los productos
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Instrucciones de entrega, observaciones..."
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? "Guardando..." : isEditing ? "Actualizar" : "Crear"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
