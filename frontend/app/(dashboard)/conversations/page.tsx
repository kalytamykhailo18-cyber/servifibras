"use client";
// Version: 2.0 - Added comprehensive logging for debugging

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConversationFiltersComponent } from "@/components/conversations/conversation-filters";
import { ConversationCard } from "@/components/conversations/conversation-card";
import { api } from "@/lib/api/endpoints";
import type { ConversationWithRelations, ConversationFilters, GetConversationsParams } from "@/types";
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
    console.log('[CONVERSATIONS PAGE] fetchConversations called with page:', page);
    console.log('[CONVERSATIONS PAGE] Current filters:', filters);

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

      console.log('[CONVERSATIONS PAGE] Calling API with params:', params);
      const response = await api.conversations.getAll(params);
      console.log('[CONVERSATIONS PAGE] API response:', response);

      setConversations(response.conversations);
      setTotalCount(response.total);
      setCurrentPage(response.page);
      setTotalPages(response.totalPages);

      console.log('[CONVERSATIONS PAGE] State updated successfully');
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Conversaciones</h1>
          <p className="text-muted-foreground">
            Gestiona todas las conversaciones con clientes
          </p>
        </div>

        <Button onClick={handleRefresh} variant="outline" size="sm">
          <RefreshIcon className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      {/* FILTERS */}
      <ConversationFiltersComponent
        filters={filters}
        onFilterChange={handleFilterChange}
        totalCount={totalCount}
      />

      {/* ERROR STATE */}
      {error && (
        <Alert variant="destructive">
          <ErrorOutlineIcon className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* CONVERSATIONS LIST */}
      {conversations.length === 0 && !isLoading ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            No se encontraron conversaciones con los filtros seleccionados
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {conversations.map((conversation) => (
            <ConversationCard key={conversation.id} conversation={conversation} />
          ))}
        </div>
      )}

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
    </div>
  );
}
