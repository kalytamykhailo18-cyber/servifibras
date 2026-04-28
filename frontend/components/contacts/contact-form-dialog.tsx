"use client";

import { useEffect } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Contact, ContactFormData } from "@/types";
import { ContactType, Channel, CONTACT_TYPE_LABELS, CHANNEL_LABELS } from "@/types";

const contactSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  type: z.nativeEnum(ContactType),
  channel: z.nativeEnum(Channel).optional(),
});

interface ContactFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: Contact | null;
  onSubmit: (data: ContactFormData) => Promise<void>;
  isLoading?: boolean;
}

export function ContactFormDialog({
  open,
  onOpenChange,
  contact,
  onSubmit,
  isLoading = false,
}: ContactFormDialogProps) {
  const isEdit = !!contact;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      type: ContactType.MINORISTA,
      channel: undefined,
    },
  });

  const selectedType = watch("type");
  const selectedChannel = watch("channel");

  // Reset form when dialog opens/closes or contact changes
  useEffect(() => {
    if (open && contact) {
      reset({
        name: contact.name || "",
        phone: contact.phone || "",
        email: contact.email || "",
        type: contact.type,
        channel: contact.channel || undefined,
      });
    } else if (!open) {
      reset({
        name: "",
        phone: "",
        email: "",
        type: ContactType.MINORISTA,
        channel: undefined,
      });
    }
  }, [open, contact, reset]);

  const handleFormSubmit = async (data: ContactFormData) => {
    await onSubmit(data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Contacto" : "Nuevo Contacto"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Modifica la información del contacto"
              : "Crea un nuevo contacto en la base de datos"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Nombre</Label>
            <Input
              id="name"
              placeholder="Juan Pérez"
              {...register("name")}
              disabled={isLoading}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          {/* Phone */}
          <div className="space-y-2">
            <Label htmlFor="phone">Teléfono</Label>
            <Input
              id="phone"
              placeholder="+541112345678"
              {...register("phone")}
              disabled={isLoading}
            />
            {errors.phone && (
              <p className="text-sm text-destructive">{errors.phone.message}</p>
            )}
          </div>

          {/* Email */}
          <div className="space-y-2">
            <Label htmlFor="email">Email (opcional)</Label>
            <Input
              id="email"
              type="email"
              placeholder="contacto@email.com"
              {...register("email")}
              disabled={isLoading}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          {/* Type */}
          <div className="space-y-2">
            <Label>Tipo de Cliente</Label>
            <Select
              value={selectedType}
              onValueChange={(value) => setValue("type", value as ContactType)}
              disabled={isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona el tipo" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CONTACT_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.type && (
              <p className="text-sm text-destructive">{errors.type.message}</p>
            )}
          </div>

          {/* Channel */}
          <div className="space-y-2">
            <Label>Canal de Contacto (opcional)</Label>
            <Select
              value={selectedChannel || "NONE"}
              onValueChange={(value) =>
                setValue("channel", value === "NONE" ? undefined : (value as Channel))
              }
              disabled={isLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona el canal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Sin canal específico</SelectItem>
                {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Guardando..." : isEdit ? "Actualizar" : "Crear"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
