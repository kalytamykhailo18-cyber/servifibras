"use client";
// Version: 2.0 - Added comprehensive logging for debugging

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ConversationFiltersComponent } from "@/components/conversations/conversation-filters";
import { ConversationCard } from "@/components/conversations/conversation-card";
import { api } from "@/lib/api/endpoints";
import type { ConversationWithRelations, ConversationFilters, GetConversationsParams } from "@/types";
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<ConversationWithRelations[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [filters, setFilters] = useState<ConversationFilters>({
    status: "ALL",
    channel: "ALL",
    assignedTo: "ALL",
    search: "",
  });

  // ========================================================================
  // FETCH CONVERSATIONS
  // ========================================================================

  const fetchConversations = async (page: number = 1) => {

    try {
      setIsLoading(true);
      setError(null);

      const params: GetConversationsParams = {
        page,
        limit: 20,
      };

      // Apply filters
      if (filters.status && filters.status !== "ALL") {
        params.status = filters.status;
      }
      if (filters.channel && filters.channel !== "ALL") {
        params.channel = filters.channel;
      }
      if (filters.assignedTo && filters.assignedTo !== "ALL") {
        params.assignedTo = filters.assignedTo;
      }
      if (filters.search && filters.search.trim().length > 0) {
        params.search = filters.search.trim();
      }

      const response = await api.conversations.getAll(params);

      setConversations(response.conversations);
      setTotalCount(response.total);
      setCurrentPage(response.page);
      setTotalPages(response.totalPages);

    } catch (err: any) {
      console.error('[CONVERSATIONS PAGE] Error fetching conversations:', err);
      setError(err.message || "Error al cargar conversaciones");
    } finally {
      setIsLoading(false);
    }
  };

  // ========================================================================
  // EFFECTS
  // ========================================================================

  useEffect(() => {
    fetchConversations(1);
  }, [filters]);

  // ========================================================================
  // HANDLERS
  // ========================================================================

  const handleFilterChange = (newFilters: ConversationFilters) => {
    setFilters(newFilters);
    setCurrentPage(1);
  };

  const handleRefresh = () => {
    fetchConversations(currentPage);
  };

  const handlePageChange = (page: number) => {
    fetchConversations(page);
  };

  // ========================================================================
  // RENDER: LOADING STATE
  // ========================================================================

  if (isLoading && conversations.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
        </div>

        <Skeleton className="h-24" />

        <div className="grid gap-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  // ========================================================================
  // RENDER: MAIN CONTENT
  // ========================================================================

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* HEADER */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(59_130_246/0.45)]">
            <ChatBubbleOutlineIcon sx={{ fontSize: 22 }} />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Conversaciones</h1>
            <p className="text-sm text-muted-foreground">
              Gestiona todas las conversaciones con clientes
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={isLoading}
          className="group inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 hover:shadow-[0_8px_20px_-6px_rgb(59_130_246/0.25)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
        >
          <RefreshIcon
            sx={{ fontSize: 16 }}
            className={isLoading ? "animate-spin" : ""}
          />
          Actualizar
        </button>
      </div>

      {/* FILTERS */}
      <ConversationFiltersComponent
        filters={filters}
        onFilterChange={handleFilterChange}
        totalCount={totalCount}
      />

      {/* ERROR STATE */}
      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200/70 bg-red-50/80 px-4 py-3 text-sm text-red-700">
          <ErrorOutlineIcon sx={{ fontSize: 18 }} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* CONVERSATIONS LIST */}
      {conversations.length === 0 && !isLoading ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-16 text-center">
          <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-slate-200 to-slate-100 text-slate-400">
            <ChatBubbleOutlineIcon sx={{ fontSize: 28 }} />
          </span>
          <h3 className="text-base font-semibold text-slate-900">Sin resultados</h3>
          <p className="mt-1 max-w-sm text-sm text-slate-500">
            No se encontraron conversaciones con los filtros seleccionados.
            Probá ajustar los filtros o limpiarlos.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {conversations.map((conversation) => (
            <ConversationCard key={conversation.id} conversation={conversation} />
          ))}
        </div>
      )}

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
    </div>
  );
}
