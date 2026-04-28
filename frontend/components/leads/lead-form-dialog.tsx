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
import { Channel, CHANNEL_LABELS, type Lead, type Contact } from "@/types";
import { toast } from "sonner";

const leadSchema = z.object({
  contactId: z.string().min(1, "Contacto es requerido"),
  source: z.nativeEnum(Channel),
  productInterest: z.string().optional(),
  estimatedValue: z.number().min(0).optional().or(z.literal(0)),
  notes: z.string().optional(),
});

type LeadFormData = z.infer<typeof leadSchema>;

interface LeadFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead?: Lead;
  onSuccess?: () => void;
}

export function LeadFormDialog({
  open,
  onOpenChange,
  lead,
  onSuccess,
}: LeadFormDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const isEditing = !!lead;

  const form = useForm<LeadFormData>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      contactId: lead?.contactId || "",
      source: lead?.source || Channel.WHATSAPP,
      productInterest: lead?.productInterest || "",
      estimatedValue: lead?.estimatedValue || 0,
      notes: lead?.notes || "",
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
    if (open && lead) {
      form.reset({
        contactId: lead.contactId,
        source: lead.source,
        productInterest: lead.productInterest || "",
        estimatedValue: lead.estimatedValue || 0,
        notes: lead.notes || "",
      });
    } else if (!open) {
      form.reset({
        contactId: "",
        source: Channel.WHATSAPP,
        productInterest: "",
        estimatedValue: 0,
        notes: "",
      });
    }
  }, [open, lead, form]);

  const onSubmit = async (data: LeadFormData) => {
    try {
      setIsLoading(true);

      if (isEditing) {
        await api.leads.update(lead.id, {
          productInterest: data.productInterest,
          estimatedValue: data.estimatedValue,
          notes: data.notes,
        });
        toast.success("Oportunidad actualizada correctamente");
      } else {
        await api.leads.create({
          contactId: data.contactId,
          source: data.source,
          productInterest: data.productInterest,
          estimatedValue: data.estimatedValue,
          notes: data.notes,
        });
        toast.success("Oportunidad creada correctamente");
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      toast.error(error.message || "Error al guardar oportunidad");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Editar Oportunidad" : "Nueva Oportunidad"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Actualiza los datos de la oportunidad de venta"
              : "Crea una nueva oportunidad de venta en el pipeline"}
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
                  <FormLabel>Contacto *</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isEditing}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un contacto" />
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

            {/* Source Channel */}
            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Canal de Origen *</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isEditing}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona un canal" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(CHANNEL_LABELS).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Product Interest */}
            <FormField
              control={form.control}
              name="productInterest"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Producto de Interés</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="ej: Resina Epoxi 300ml"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Estimated Value */}
            <FormField
              control={form.control}
              name="estimatedValue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Valor Estimado (USD)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="0"
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

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Agrega detalles sobre esta oportunidad..."
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
