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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Contact, ContactFormData } from "@/types";
import { ContactType, Channel, CONTACT_TYPE_LABELS, CHANNEL_LABELS } from "@/types";
import PersonIcon from "@mui/icons-material/Person";
import PhoneIcon from "@mui/icons-material/Phone";
import MailOutlineIcon from "@mui/icons-material/MailOutlined";
import EditIcon from "@mui/icons-material/Edit";
import PersonAddIcon from "@mui/icons-material/PersonAdd";

const contactSchema = z
  .object({
    name: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    type: z.nativeEnum(ContactType),
    channel: z.nativeEnum(Channel).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.email)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Email inválido",
        path: ["email"],
      });
    }
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

  const fieldClass = (hasError: boolean) =>
    `h-11 w-full rounded-xl border bg-white pl-10 pr-3.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all duration-200 focus:bg-white focus:ring-4 ${
      hasError
        ? "border-red-400 focus:border-red-500 focus:ring-red-500/15"
        : "border-slate-200 focus:border-blue-500 focus:ring-blue-500/15"
    }`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150">
        <DialogHeader className="flex flex-row items-center gap-3 space-y-0">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(16_185_129/0.45)]">
            {isEdit ? <EditIcon sx={{ fontSize: 22 }} /> : <PersonAddIcon sx={{ fontSize: 22 }} />}
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              {isEdit ? "Editar Contacto" : "Nuevo Contacto"}
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              {isEdit
                ? "Modifica la información del contacto"
                : "Crea un nuevo contacto en la base de datos"}
            </DialogDescription>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} noValidate className="mt-2 space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="name" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Nombre
            </label>
            <div className="group relative">
              <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-slate-400 transition-colors duration-200 group-focus-within:text-blue-600">
                <PersonIcon sx={{ fontSize: 18 }} />
              </span>
              <input
                id="name"
                placeholder="Juan Pérez"
                disabled={isLoading}
                {...register("name")}
                className={fieldClass(!!errors.name)}
              />
            </div>
            {errors.name && (
              <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>
            )}
          </div>

          {/* Phone */}
          <div>
            <label htmlFor="phone" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Teléfono
            </label>
            <div className="group relative">
              <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-slate-400 transition-colors duration-200 group-focus-within:text-blue-600">
                <PhoneIcon sx={{ fontSize: 18 }} />
              </span>
              <input
                id="phone"
                placeholder="+541112345678"
                disabled={isLoading}
                {...register("phone")}
                className={fieldClass(!!errors.phone)}
              />
            </div>
            {errors.phone && (
              <p className="mt-1 text-xs text-red-600">{errors.phone.message}</p>
            )}
          </div>

          {/* Email */}
          <div>
            <label htmlFor="email" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Email <span className="font-normal normal-case text-slate-400">(opcional)</span>
            </label>
            <div className="group relative">
              <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-slate-400 transition-colors duration-200 group-focus-within:text-blue-600">
                <MailOutlineIcon sx={{ fontSize: 18 }} />
              </span>
              <input
                id="email"
                type="email"
                placeholder="contacto@email.com"
                disabled={isLoading}
                {...register("email")}
                className={fieldClass(!!errors.email)}
              />
            </div>
            {errors.email && (
              <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
            )}
          </div>

          {/* Type */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Tipo de Cliente
            </label>
            <Select
              value={selectedType}
              onValueChange={(value) => setValue("type", value as ContactType)}
              disabled={isLoading}
            >
              <SelectTrigger className="w-full">
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
              <p className="mt-1 text-xs text-red-600">{errors.type.message}</p>
            )}
          </div>

          {/* Channel */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Canal de Contacto <span className="font-normal normal-case text-slate-400">(opcional)</span>
            </label>
            <Select
              value={selectedChannel || "NONE"}
              onValueChange={(value) =>
                setValue("channel", value === "NONE" ? undefined : (value as Channel))
              }
              disabled={isLoading}
            >
              <SelectTrigger className="w-full">
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
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(16_185_129/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(16_185_129/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
            >
              {isLoading ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Guardando...
                </>
              ) : isEdit ? (
                "Actualizar"
              ) : (
                "Crear"
              )}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
