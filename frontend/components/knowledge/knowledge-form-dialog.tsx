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
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { KnowledgeBase, KnowledgeFormData } from "@/types";
import { PRODUCT_CATEGORIES } from "@/types";

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

  // Reset form when dialog opens/closes or knowledge changes
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
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar Conocimiento" : "Nuevo Conocimiento"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Modifica la información del artículo de conocimiento"
              : "Agrega nuevo contenido a la base de conocimiento"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
          {/* Category */}
          <div className="space-y-2">
            <Label>Categoría</Label>
            <Select
              value={selectedCategory}
              onValueChange={(value) => value && setValue("category", value)}
              disabled={isLoading}
            >
              <SelectTrigger>
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
              <p className="text-sm text-destructive">{errors.category.message}</p>
            )}
          </div>

          {/* Subcategory */}
          <div className="space-y-2">
            <Label htmlFor="subcategory">Subcategoría (opcional)</Label>
            <Input
              id="subcategory"
              placeholder="Ej: Poliéster, Epoxi, etc."
              {...register("subcategory")}
              disabled={isLoading}
            />
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              placeholder="Título descriptivo del artículo"
              {...register("title")}
              disabled={isLoading}
            />
            {errors.title && (
              <p className="text-sm text-destructive">{errors.title.message}</p>
            )}
          </div>

          {/* Content */}
          <div className="space-y-2">
            <Label htmlFor="content">Contenido</Label>
            <Textarea
              id="content"
              placeholder="Escribe el contenido completo del artículo..."
              rows={8}
              {...register("content")}
              disabled={isLoading}
              className="font-mono text-sm"
            />
            {errors.content && (
              <p className="text-sm text-destructive">{errors.content.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Puedes usar formato de texto plano. El contenido será utilizado por la IA para responder consultas.
            </p>
          </div>

          {/* Active Toggle */}
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-0.5">
              <Label htmlFor="active">Estado</Label>
              <p className="text-sm text-muted-foreground">
                {isActive
                  ? "Este artículo está activo y será usado por la IA"
                  : "Este artículo está inactivo y no será usado"}
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
