"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PipelineBoard } from "@/components/leads/pipeline-board";
import { LeadFormDialog } from "@/components/leads/lead-form-dialog";
import { api } from "@/lib/api/endpoints";
import type { Lead } from "@/types";
import AddIcon from '@mui/icons-material/Add';
import BarChartIcon from '@mui/icons-material/BarChart';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
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

  const fetchLeads = async () => {
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

  useEffect(() => {
    fetchLeads();
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
      fetchLeads();
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
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-64 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
        <Skeleton className="h-[600px]" />
      </div>
    );
  }

  // ========================================================================
  // RENDER: ERROR STATE
  // ========================================================================

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Pipeline de Ventas</h1>
            <p className="text-muted-foreground">
              Gestiona las oportunidades de venta en el pipeline
            </p>
          </div>
          <Button onClick={fetchLeads} variant="outline" size="sm">
            <RefreshIcon className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>

        <Alert variant="destructive">
          <ErrorOutlineIcon className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
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
          <h1 className="text-3xl font-bold tracking-tight">Pipeline de Ventas</h1>
          <p className="text-muted-foreground">
            Gestiona las oportunidades de venta arrastrando entre columnas
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => router.push("/leads/stats")}
            variant="outline"
            size="sm"
          >
            <BarChartIcon className="h-4 w-4 mr-2" />
            Estadísticas
          </Button>

          <Button onClick={fetchLeads} variant="outline" size="sm">
            <RefreshIcon
              className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`}
            />
            Actualizar
          </Button>

          <Button onClick={() => setIsFormOpen(true)} size="sm">
            <AddIcon className="h-4 w-4 mr-2" />
            Nueva Oportunidad
          </Button>
        </div>
      </div>

      {/* PIPELINE BOARD */}
      <PipelineBoard
        leads={leads}
        onLeadsChange={fetchLeads}
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
          fetchLeads();
          handleFormClose();
        }}
      />

      {/* DELETE CONFIRMATION */}
      <AlertDialog
        open={!!deletingLead}
        onOpenChange={() => setDeletingLead(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar oportunidad?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. La oportunidad será eliminada
              permanentemente del pipeline.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600">
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
