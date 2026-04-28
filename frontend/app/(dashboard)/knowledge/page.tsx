"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>

        <Skeleton className="h-20" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  // ========================================================================
  // RENDER: MAIN CONTENT
  // ========================================================================

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Base de Conocimiento</h1>
          <p className="text-muted-foreground">
            Gestiona el contenido utilizado por la IA para responder consultas
          </p>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleRefresh} variant="outline" size="sm">
            <RefreshIcon className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
          <Button onClick={handleCreateClick}>
            <AddIcon className="h-4 w-4 mr-2" />
            Nuevo Artículo
          </Button>
        </div>
      </div>

      {/* FILTERS */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar en títulos y contenido..."
            value={filters.search || ""}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Category Filter */}
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

        {/* Active Filter */}
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

        {/* Results Count */}
        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <MenuBookIcon className="h-4 w-4" />
          <span>{totalCount} artículos</span>
        </div>
      </div>

      {/* ERROR STATE */}
      {error && (
        <Alert variant="destructive">
          <ErrorOutlineIcon className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
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
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1 || isLoading}
          >
            Anterior
          </Button>

          <span className="text-sm text-muted-foreground">
            Página {currentPage} de {totalPages}
          </span>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages || isLoading}
          >
            Siguiente
          </Button>
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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar artículo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminará permanentemente el artículo{" "}
              <strong>{deleteItem?.title}</strong> de la base de conocimiento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
