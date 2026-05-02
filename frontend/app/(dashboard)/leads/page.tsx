"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { PipelineBoard } from "@/components/leads/pipeline-board";
import { LeadFormDialog } from "@/components/leads/lead-form-dialog";
import { api } from "@/lib/api/endpoints";
import type { Lead, LeadStatus } from "@/types";
import AddIcon from '@mui/icons-material/Add';
import BarChartIcon from '@mui/icons-material/BarChart';
import DeleteIcon from '@mui/icons-material/Delete';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import { toast } from "sonner";
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

export default function LeadsPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [deletingLead, setDeletingLead] = useState<Lead | null>(null);

  // ========================================================================
  // FETCH LEADS
  // ========================================================================

  // Initial load — shows the pipeline skeleton
  const loadLeads = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await api.leads.list({ limit: 1000 });
      setLeads(response.data);
    } catch (err: any) {
      setError(err.message || "Error al cargar oportunidades");
      toast.error("Error al cargar oportunidades");
    } finally {
      setIsLoading(false);
    }
  };

  // Silent refresh — no skeleton flash, used after edits/deletes/drag-drop
  const refreshLeads = async () => {
    try {
      const response = await api.leads.list({ limit: 1000 });
      setLeads(response.data);
    } catch (err: any) {
      toast.error(err.message || "Error al recargar oportunidades");
    }
  };

  // Optimistic single-lead status update — used by drag-drop in PipelineBoard
  const handleLeadStatusChanged = (leadId: string, status: LeadStatus) => {
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, status } : l)));
  };

  useEffect(() => {
    loadLeads();
  }, []);

  // ========================================================================
  // HANDLERS
  // ========================================================================

  const handleViewLead = (lead: Lead) => {
    router.push(`/leads/${lead.id}`);
  };

  const handleEditLead = (lead: Lead) => {
    setEditingLead(lead);
    setIsFormOpen(true);
  };

  const handleDeleteLead = (lead: Lead) => {
    setDeletingLead(lead);
  };

  const confirmDelete = async () => {
    if (!deletingLead) return;

    try {
      await api.leads.delete(deletingLead.id);
      toast.success("Oportunidad eliminada correctamente");
      refreshLeads();
    } catch (error: any) {
      toast.error(error.message || "Error al eliminar oportunidad");
    } finally {
      setDeletingLead(null);
    }
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setEditingLead(null);
  };

  // ========================================================================
  // RENDER: LOADING STATE
  // ========================================================================

  if (isLoading) {
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
            <Skeleton className="h-10 w-32 rounded-full" />
            <Skeleton className="h-10 w-28 rounded-full" />
            <Skeleton className="h-10 w-44 rounded-full" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[600px] rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  // ========================================================================
  // RENDER: ERROR STATE
  // ========================================================================

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-red-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(249_115_22/0.45)]">
              <TrendingUpIcon sx={{ fontSize: 22 }} />
            </span>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                Pipeline de Ventas
              </h1>
              <p className="text-sm text-muted-foreground">
                Gestiona las oportunidades de venta en el pipeline
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadLeads}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:translate-y-0 active:scale-[0.97]"
          >
            <RefreshIcon sx={{ fontSize: 16 }} />
            Reintentar
          </button>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-red-200/70 bg-red-50/80 px-4 py-3 text-sm text-red-700">
          <ErrorOutlineIcon sx={{ fontSize: 18 }} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
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
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-red-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(249_115_22/0.45)]">
            <TrendingUpIcon sx={{ fontSize: 22 }} />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              Pipeline de Ventas
            </h1>
            <p className="text-sm text-muted-foreground">
              Gestiona las oportunidades de venta arrastrando entre columnas
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => router.push("/leads/stats")}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-pink-300 hover:bg-pink-50 hover:text-pink-700 hover:shadow-[0_8px_20px_-6px_rgb(236_72_153/0.25)] active:translate-y-0 active:scale-[0.97]"
          >
            <BarChartIcon sx={{ fontSize: 16 }} />
            Estadísticas
          </button>

          <button
            type="button"
            onClick={refreshLeads}
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
            onClick={() => setIsFormOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-orange-600 to-red-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(249_115_22/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(249_115_22/0.65)] active:translate-y-0 active:scale-[0.97]"
          >
            <AddIcon sx={{ fontSize: 18 }} />
            Nueva Oportunidad
          </button>
        </div>
      </div>

      {/* PIPELINE BOARD */}
      <PipelineBoard
        leads={leads}
        onLeadsChange={refreshLeads}
        onLeadStatusChanged={handleLeadStatusChanged}
        onViewLead={handleViewLead}
        onEditLead={handleEditLead}
        onDeleteLead={handleDeleteLead}
      />

      {/* CREATE/EDIT DIALOG */}
      <LeadFormDialog
        open={isFormOpen}
        onOpenChange={handleFormClose}
        lead={editingLead || undefined}
        onSuccess={() => {
          refreshLeads();
          handleFormClose();
        }}
      />

      {/* DELETE CONFIRMATION */}
      <AlertDialog
        open={!!deletingLead}
        onOpenChange={() => setDeletingLead(null)}
      >
        <AlertDialogContent className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150">
          <AlertDialogHeader className="space-y-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-red-500 to-rose-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(239_68_68/0.45)]">
              <DeleteIcon sx={{ fontSize: 22 }} />
            </span>
            <AlertDialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              ¿Eliminar oportunidad?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-slate-600">
              Esta acción no se puede deshacer. La oportunidad será eliminada
              permanentemente del pipeline.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(239_68_68/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(239_68_68/0.65)] active:translate-y-0 active:scale-[0.97]"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
