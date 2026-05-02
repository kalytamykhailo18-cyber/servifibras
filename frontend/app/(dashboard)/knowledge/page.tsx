"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { KnowledgeFormDialog } from "@/components/knowledge/knowledge-form-dialog";
import { KnowledgeTable } from "@/components/knowledge/knowledge-table";
import { api } from "@/lib/api/endpoints";
import type { KnowledgeBase, KnowledgeFormData, KnowledgeFilters, GetKnowledgeParams } from "@/types";
import { PRODUCT_CATEGORIES } from "@/types";
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { toast } from "sonner";

export default function KnowledgePage() {
  const [items, setItems] = useState<KnowledgeBase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [filters, setFilters] = useState<KnowledgeFilters>({
    category: "ALL",
    subcategory: "ALL",
    active: "ALL",
    search: "",
  });

  // Dialog states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<KnowledgeBase | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete confirmation
  const [deleteItem, setDeleteItem] = useState<KnowledgeBase | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ========================================================================
  // FETCH KNOWLEDGE ITEMS
  // ========================================================================

  const fetchKnowledge = async (page: number = 1) => {
    try {
      setIsLoading(true);
      setError(null);

      const params: GetKnowledgeParams = {
        page,
        limit: 20,
      };

      if (filters.category && filters.category !== "ALL") {
        params.category = filters.category;
      }
      if (filters.subcategory && filters.subcategory !== "ALL") {
        params.subcategory = filters.subcategory;
      }
      if (filters.active !== "ALL" && typeof filters.active === "boolean") {
        params.active = filters.active;
      }
      if (filters.search && filters.search.trim().length > 0) {
        params.search = filters.search.trim();
      }

      const response = await api.knowledge.getAll(params);

      setItems(response.items);
      setTotalCount(response.total);
      setCurrentPage(response.page);
      setTotalPages(response.totalPages);
    } catch (err: any) {
      setError(err.message || "Error al cargar base de conocimiento");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchKnowledge(1);
  }, [filters]);

  // ========================================================================
  // HANDLERS
  // ========================================================================

  const handleCreateClick = () => {
    setEditingItem(null);
    setIsFormOpen(true);
  };

  const handleEditClick = (item: KnowledgeBase) => {
    setEditingItem(item);
    setIsFormOpen(true);
  };

  const handleDeleteClick = (item: KnowledgeBase) => {
    setDeleteItem(item);
  };

  const handleFormSubmit = async (data: KnowledgeFormData) => {
    setIsSubmitting(true);
    try {
      if (editingItem) {
        await api.knowledge.update(editingItem.id, data);
        toast.success("Artículo actualizado correctamente");
      } else {
        await api.knowledge.create(data);
        toast.success("Artículo creado correctamente");
      }
      fetchKnowledge(currentPage);
    } catch (err: any) {
      toast.error(err.message || "Error al guardar artículo");
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteItem) return;

    setIsDeleting(true);
    try {
      await api.knowledge.delete(deleteItem.id);
      toast.success("Artículo eliminado correctamente");
      setDeleteItem(null);
      fetchKnowledge(currentPage);
    } catch (err: any) {
      toast.error(err.message || "Error al eliminar artículo");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggleActive = async (item: KnowledgeBase, active: boolean) => {
    try {
      await api.knowledge.update(item.id, { active });
      toast.success(active ? "Artículo activado" : "Artículo desactivado");
      fetchKnowledge(currentPage);
    } catch (err: any) {
      toast.error(err.message || "Error al cambiar estado");
    }
  };

  const handleRefresh = () => {
    fetchKnowledge(currentPage);
  };

  const handlePageChange = (page: number) => {
    fetchKnowledge(page);
  };

  const handleSearchChange = (value: string) => {
    setFilters({ ...filters, search: value });
    setCurrentPage(1);
  };

  const handleCategoryChange = (value: string | null) => {
    if (!value) return;
    setFilters({ ...filters, category: value });
    setCurrentPage(1);
  };

  const handleActiveChange = (value: string | null) => {
    if (!value) return;
    const activeValue = value === "ALL" ? "ALL" : value === "true";
    setFilters({ ...filters, active: activeValue });
    setCurrentPage(1);
  };

  // ========================================================================
  // RENDER: LOADING STATE
  // ========================================================================

  if (isLoading && items.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-56" />
              <Skeleton className="h-4 w-72" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-28 rounded-full" />
            <Skeleton className="h-10 w-40 rounded-full" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Skeleton className="h-11 w-72 rounded-xl" />
          <Skeleton className="h-11 w-44 rounded-xl" />
          <Skeleton className="h-11 w-36 rounded-xl" />
        </div>

        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  // ========================================================================
  // RENDER: MAIN CONTENT
  // ========================================================================

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* PAGE HEADER */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(139_92_246/0.45)]">
            <MenuBookIcon sx={{ fontSize: 22 }} />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Base de Conocimiento</h1>
            <p className="text-sm text-muted-foreground">
              Gestiona el contenido utilizado por la IA para responder consultas
            </p>
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isLoading}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 hover:shadow-[0_8px_20px_-6px_rgb(59_130_246/0.25)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
          >
            <RefreshIcon
              sx={{ fontSize: 16 }}
              className={isLoading ? "animate-spin" : ""}
            />
            Actualizar
          </button>

          <button
            type="button"
            onClick={handleCreateClick}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-purple-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(139_92_246/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(139_92_246/0.65)] active:translate-y-0 active:scale-[0.97]"
          >
            <AddIcon sx={{ fontSize: 18 }} />
            Nuevo Artículo
          </button>
        </div>
      </div>

      {/* FILTERS */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="group relative flex-1 min-w-[220px] max-w-sm">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors duration-200 group-focus-within:text-blue-600" />
          <Input
            placeholder="Buscar en títulos y contenido..."
            value={filters.search || ""}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>

        <Select value={filters.category || "ALL"} onValueChange={handleCategoryChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Categoría" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todas las categorías</SelectItem>
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

        <Select
          value={typeof filters.active === "boolean" ? String(filters.active) : "ALL"}
          onValueChange={handleActiveChange}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos</SelectItem>
            <SelectItem value="true">Activos</SelectItem>
            <SelectItem value="false">Inactivos</SelectItem>
          </SelectContent>
        </Select>

        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
          <span className="font-semibold text-slate-900">{totalCount}</span>
          artículos
        </span>
      </div>

      {/* ERROR STATE */}
      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200/70 bg-red-50/80 px-4 py-3 text-sm text-red-700">
          <ErrorOutlineIcon sx={{ fontSize: 18 }} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KNOWLEDGE TABLE */}
      <KnowledgeTable
        items={items}
        onEdit={handleEditClick}
        onDelete={handleDeleteClick}
        onToggleActive={handleToggleActive}
      />

      {/* PAGINATION */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-4">
          <button
            type="button"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1 || isLoading}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-700"
          >
            ← Anterior
          </button>

          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700">
            <span className="font-semibold text-slate-900">{currentPage}</span>
            <span className="text-slate-400">/</span>
            <span>{totalPages}</span>
          </span>

          <button
            type="button"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages || isLoading}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-700"
          >
            Siguiente →
          </button>
        </div>
      )}

      {/* FORM DIALOG */}
      <KnowledgeFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        knowledge={editingItem}
        onSubmit={handleFormSubmit}
        isLoading={isSubmitting}
      />

      {/* DELETE CONFIRMATION DIALOG */}
      <AlertDialog open={!!deleteItem} onOpenChange={() => setDeleteItem(null)}>
        <AlertDialogContent className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150">
          <AlertDialogHeader className="space-y-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-red-500 to-rose-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(239_68_68/0.45)]">
              <DeleteIcon sx={{ fontSize: 22 }} />
            </span>
            <AlertDialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              ¿Eliminar artículo?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-slate-600">
              Esta acción no se puede deshacer. Se eliminará permanentemente el artículo{" "}
              <strong className="font-semibold text-slate-900">
                {deleteItem?.title}
              </strong>{" "}
              de la base de conocimiento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel
              disabled={isDeleting}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] disabled:opacity-60"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(239_68_68/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(239_68_68/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
            >
              {isDeleting ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Eliminando...
                </>
              ) : (
                "Eliminar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
