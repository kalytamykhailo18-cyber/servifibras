"use client";
// Version: 2.0 - Added comprehensive logging for debugging

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore, selectUserRole } from "@/lib/store/auth-store";
import { UserRole } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import { ConversationFiltersComponent } from "@/components/conversations/conversation-filters";
import { ConversationCard } from "@/components/conversations/conversation-card";
import { MercadolibreQaList } from "@/components/conversations/mercadolibre-qa-list";
import { Pagination } from "@/components/ui/pagination";
import { api } from "@/lib/api/endpoints";
import { useRealtimeEvent } from "@/lib/realtime/use-realtime";
import type { ConversationWithRelations, ConversationFilters, GetConversationsParams } from "@/types";
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import StorefrontIcon from '@mui/icons-material/Storefront';

type ConversationsTab = "all" | "mercadolibre";

const ML_TAB_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.ATENCION,
  UserRole.VENTAS,
];

export default function ConversationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const role = useAuthStore(selectUserRole);
  // Only ADMIN / ATENCION / VENTAS can see the ML tab — LOGISTICA stays on
  // the regular conversations view. The backend endpoint enforces the
  // same gate (returns 403), so this is just to keep the UI clean.
  const mlTabAllowed = role != null && ML_TAB_ROLES.includes(role);
  // Marcos 2026-06-04: ML view lives as a sub-tab inside Conversaciones
  // instead of a top-level sidebar entry. URL-driven so it persists
  // across reloads + can be linked to.
  const tabFromUrl = (mlTabAllowed && searchParams.get("view") === "mercadolibre" ? "mercadolibre" : "all") as ConversationsTab;
  const [activeTab, setActiveTab] = useState<ConversationsTab>(tabFromUrl);

  const switchTab = (tab: ConversationsTab) => {
    setActiveTab(tab);
    const sp = new URLSearchParams(searchParams.toString());
    if (tab === "mercadolibre") sp.set("view", "mercadolibre");
    else sp.delete("view");
    router.replace(`/conversations${sp.toString() ? `?${sp.toString()}` : ""}`, { scroll: false });
  };

  // Marcos 2026-06-17: small red badge next to the Mercado Libre tab
  // showing the count of pending drafts (questions + messages +
  // claims). Polls every 30s — light query, just a length. Falls
  // silent on errors so a transient hiccup doesn't break the page.
  const [mlPendingCount, setMlPendingCount] = useState<number>(0);
  useEffect(() => {
    if (!mlTabAllowed) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const drafts = await api.mercadolibre.pendingDrafts(200);
        if (!cancelled) setMlPendingCount(Array.isArray(drafts) ? drafts.length : 0);
      } catch { /* non-fatal */ }
    };
    void tick();
    const h = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(h); };
  }, [mlTabAllowed]);

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

  // `silent=true` skips the skeleton flash — used for realtime ticks and
  // for refreshes that follow user actions (we keep the rendered list in
  // place and just swap data when it lands).
  const fetchConversations = async (page: number = 1, silent: boolean = false) => {

    try {
      if (!silent) setIsLoading(true);
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
      // Silent refreshes shouldn't replace the rendered list with an error.
      if (!silent) setError(err.message || "Error al cargar conversaciones");
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  // ========================================================================
  // EFFECTS
  // ========================================================================

  useEffect(() => {
    fetchConversations(1);
  }, [filters]);

  // Keep the inbox fresh when the backend signals new activity. Coalesce
  // bursts to one refresh per second so a spike of 50 messages doesn't fire
  // 50 fetches.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onTick = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      fetchConversations(1, true);
    }, 600);
  }, [filters]);
  useRealtimeEvent("metrics:tick", onTick);
  useRealtimeEvent("conversation:needs_human", onTick);
  useRealtimeEvent("conversation:transferred", onTick);

  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);

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
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(59_130_246/0.45)] sm:h-11 sm:w-11">
            <ChatBubbleOutlineIcon sx={{ fontSize: 20 }} className="sm:[font-size:22px]" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl lg:text-3xl">Conversaciones</h1>
            <p className="hidden text-sm text-muted-foreground sm:block">
              Gestiona todas las conversaciones con clientes
            </p>
          </div>
        </div>

        {activeTab === "all" && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isLoading}
            aria-label="Actualizar"
            className="group inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 hover:shadow-[0_8px_20px_-6px_rgb(59_130_246/0.25)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 sm:px-4"
          >
            <RefreshIcon
              sx={{ fontSize: 16 }}
              className={(isLoading ? "animate-spin " : "") + "text-blue-600"}
            />
            <span className="hidden sm:inline">Actualizar</span>
          </button>
        )}
      </div>

      {/* TABS — main "Todas" + ML sub-view (Marcos 2026-06-04) */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => switchTab("all")}
          data-testid="conversations-tab-all"
          aria-pressed={activeTab === "all"}
          className={
            "inline-flex h-10 items-center gap-2 border-b-2 px-4 text-sm font-medium transition-colors " +
            (activeTab === "all"
              ? "border-blue-600 text-blue-700"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800")
          }
        >
          <ChatBubbleOutlineIcon sx={{ fontSize: 16 }} />
          Conversaciones
        </button>
        {mlTabAllowed && (
          <button
            type="button"
            onClick={() => switchTab("mercadolibre")}
            data-testid="conversations-tab-mercadolibre"
            aria-pressed={activeTab === "mercadolibre"}
            className={
              "inline-flex h-10 items-center gap-2 border-b-2 px-4 text-sm font-medium transition-colors " +
              (activeTab === "mercadolibre"
                ? "border-yellow-600 text-yellow-700"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800")
            }
          >
            <StorefrontIcon sx={{ fontSize: 16 }} />
            Mercado Libre
            {mlPendingCount > 0 && (
              <span
                data-testid="conversations-tab-mercadolibre-count"
                title={`${mlPendingCount} pendiente${mlPendingCount === 1 ? '' : 's'} de revisión`}
                className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-600 px-1.5 text-[10px] font-bold tabular-nums text-white"
              >
                {mlPendingCount}
              </span>
            )}
          </button>
        )}
      </div>

      {activeTab === "mercadolibre" ? (
        <MercadolibreQaList />
      ) : (
        <>
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

      {/* PAGINATION TOP */}
      <Pagination
        position="top"
        page={currentPage}
        totalPages={totalPages}
        totalItems={totalCount}
        pageSize={20}
        onPageChange={handlePageChange}
        disabled={isLoading}
      />

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
        <div className="grid grid-cols-1 gap-3">
          {conversations.map((conversation) => (
            <ConversationCard key={conversation.id} conversation={conversation} />
          ))}
        </div>
      )}

      {/* PAGINATION BOTTOM */}
      <div className="mt-3">
        <Pagination
          position="bottom"
          page={currentPage}
          totalPages={totalPages}
          totalItems={totalCount}
          pageSize={20}
          onPageChange={handlePageChange}
          disabled={isLoading}
        />
      </div>
        </>
      )}
    </div>
  );
}
