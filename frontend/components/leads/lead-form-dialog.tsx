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
import { Channel, CHANNEL_LABELS, type Lead, type Contact } from "@/types";
import { toast } from "sonner";
import EditIcon from "@mui/icons-material/Edit";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";

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
      <DialogContent className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150 sm:max-w-[520px]">
        <DialogHeader className="flex flex-row items-center gap-3 space-y-0">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-red-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(249_115_22/0.45)]">
            {isEditing ? <EditIcon sx={{ fontSize: 22 }} /> : <TrendingUpIcon sx={{ fontSize: 22 }} />}
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              {isEditing ? "Editar Oportunidad" : "Nueva Oportunidad"}
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              {isEditing
                ? "Actualiza los datos de la oportunidad de venta"
                : "Crea una nueva oportunidad de venta en el pipeline"}
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
                    Contacto <span className="text-orange-600">*</span>
                  </FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isEditing}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
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

            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Canal de Origen <span className="text-orange-600">*</span>
                  </FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isEditing}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
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

            <FormField
              control={form.control}
              name="productInterest"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Producto de Interés
                  </FormLabel>
                  <FormControl>
                    <Input placeholder="ej: Resina Epoxi 300ml" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="estimatedValue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Valor Estimado <span className="font-normal normal-case text-slate-400">(USD)</span>
                  </FormLabel>
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
                      placeholder="Agrega detalles sobre esta oportunidad..."
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
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-600 to-red-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(249_115_22/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(249_115_22/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
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
