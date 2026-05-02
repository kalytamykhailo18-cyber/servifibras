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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { KnowledgeBase, KnowledgeFormData } from "@/types";
import { PRODUCT_CATEGORIES } from "@/types";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import EditIcon from "@mui/icons-material/Edit";

const knowledgeSchema = z.object({
  category: z.string().min(1, "La categoría es requerida"),
  subcategory: z.string().optional(),
  title: z.string().min(1, "El título es requerido"),
  content: z.string().min(1, "El contenido es requerido"),
  active: z.boolean(),
});

interface KnowledgeFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  knowledge?: KnowledgeBase | null;
  onSubmit: (data: KnowledgeFormData) => Promise<void>;
  isLoading?: boolean;
}

export function KnowledgeFormDialog({
  open,
  onOpenChange,
  knowledge,
  onSubmit,
  isLoading = false,
}: KnowledgeFormDialogProps) {
  const isEdit = !!knowledge;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<KnowledgeFormData>({
    resolver: zodResolver(knowledgeSchema),
    defaultValues: {
      category: "",
      subcategory: "",
      title: "",
      content: "",
      active: true,
    },
  });

  const selectedCategory = watch("category");
  const isActive = watch("active");

  useEffect(() => {
    if (open && knowledge) {
      reset({
        category: knowledge.category,
        subcategory: knowledge.subcategory || "",
        title: knowledge.title,
        content: knowledge.content,
        active: knowledge.active,
      });
    } else if (!open) {
      reset({
        category: "",
        subcategory: "",
        title: "",
        content: "",
        active: true,
      });
    }
  }, [open, knowledge, reset]);

  const handleFormSubmit = async (data: KnowledgeFormData) => {
    await onSubmit(data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150 sm:max-w-[600px]">
        <DialogHeader className="flex flex-row items-center gap-3 space-y-0">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(139_92_246/0.45)]">
            {isEdit ? <EditIcon sx={{ fontSize: 22 }} /> : <MenuBookIcon sx={{ fontSize: 22 }} />}
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              {isEdit ? "Editar Conocimiento" : "Nuevo Conocimiento"}
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500">
              {isEdit
                ? "Modifica la información del artículo de conocimiento"
                : "Agrega nuevo contenido a la base de conocimiento"}
            </DialogDescription>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="mt-2 space-y-4">
          {/* Category */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Categoría
            </label>
            <Select
              value={selectedCategory}
              onValueChange={(value) => value && setValue("category", value)}
              disabled={isLoading}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecciona la categoría" />
              </SelectTrigger>
              <SelectContent>
                {PRODUCT_CATEGORIES.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
                <SelectItem value="General">General</SelectItem>
                <SelectItem value="FAQ">Preguntas Frecuentes</SelectItem>
                <SelectItem value="Tutoriales">Tutoriales</SelectItem>
              </SelectContent>
            </Select>
            {errors.category && (
              <p className="mt-1 text-xs text-red-600">{errors.category.message}</p>
            )}
          </div>

          {/* Subcategory */}
          <div>
            <label htmlFor="subcategory" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Subcategoría <span className="font-normal normal-case text-slate-400">(opcional)</span>
            </label>
            <Input
              id="subcategory"
              placeholder="Ej: Poliéster, Epoxi, etc."
              {...register("subcategory")}
              disabled={isLoading}
            />
          </div>

          {/* Title */}
          <div>
            <label htmlFor="title" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Título
            </label>
            <Input
              id="title"
              placeholder="Título descriptivo del artículo"
              {...register("title")}
              disabled={isLoading}
            />
            {errors.title && (
              <p className="mt-1 text-xs text-red-600">{errors.title.message}</p>
            )}
          </div>

          {/* Content */}
          <div>
            <label htmlFor="content" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Contenido
            </label>
            <Textarea
              id="content"
              placeholder="Escribe el contenido completo del artículo..."
              rows={8}
              {...register("content")}
              disabled={isLoading}
              className="resize-none font-mono text-[13px] leading-relaxed"
            />
            {errors.content && (
              <p className="mt-1 text-xs text-red-600">{errors.content.message}</p>
            )}
            <p className="mt-1.5 text-xs text-slate-500">
              El contenido será utilizado por la IA para responder consultas.
            </p>
          </div>

          {/* Active Toggle */}
          <div
            className={`flex items-center justify-between gap-3 rounded-xl border p-4 transition-colors duration-200 ${
              isActive
                ? "border-emerald-200/70 bg-emerald-50/50"
                : "border-slate-200 bg-slate-50/50"
            }`}
          >
            <div className="min-w-0">
              <label htmlFor="active" className="block text-sm font-semibold text-slate-900">
                Estado
              </label>
              <p className="text-xs text-slate-600">
                {isActive
                  ? "Activo — la IA usará este artículo para responder."
                  : "Inactivo — la IA no lo tendrá en cuenta."}
              </p>
            </div>
            <Switch
              id="active"
              checked={isActive}
              onCheckedChange={(checked) => setValue("active", checked)}
              disabled={isLoading}
            />
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
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(139_92_246/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(139_92_246/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
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
