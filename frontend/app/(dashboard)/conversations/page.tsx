"use client";
// Marcos 2026-07-21: layout tipo WhatsApp Web. Antes: página vertical
// grande con header + tabs + filtros + cards altas de conversación
// (entraban ~4 en pantalla). Ahora: 2 columnas en desktop — lista
// densa a la izquierda (~10-12 filas por pantalla), detalle
// embedded a la derecha. Selección persistida en `?id=`. En mobile
// cae a la ruta /conversations/[id] tradicional para preservar la
// navegación de una-columna.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore, selectUserRole } from "@/lib/store/auth-store";
import { UserRole } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import { ConversationFiltersComponent } from "@/components/conversations/conversation-filters";
import { ConversationListItem } from "@/components/conversations/conversation-list-item";
import { ConversationDetailPanel } from "@/components/conversations/conversation-detail-panel";
import { MercadolibreQaList } from "@/components/conversations/mercadolibre-qa-list";
import { Pagination } from "@/components/ui/pagination";
import { api } from "@/lib/api/endpoints";
import { useRealtimeEvent } from "@/lib/realtime/use-realtime";
import type { ConversationWithRelations, ConversationFilters, GetConversationsParams } from "@/types";
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import StorefrontIcon from '@mui/icons-material/Storefront';
import FilterListIcon from '@mui/icons-material/FilterList';
import MarkChatUnreadIcon from '@mui/icons-material/MarkChatUnread';
import StarIcon from '@mui/icons-material/Star';

type ConversationsTab = "all" | "unread" | "favorites" | "mercadolibre";

const ML_TAB_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.ATENCION,
  UserRole.VENTAS,
  UserRole.ENCARGADO,
];

const PAGE_SIZE = 40;

export default function ConversationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const role = useAuthStore(selectUserRole);
  const mlTabAllowed = role != null && ML_TAB_ROLES.includes(role);
  const rawView = searchParams.get("view");
  const tabFromUrl: ConversationsTab =
    mlTabAllowed && rawView === "mercadolibre" ? "mercadolibre"
      : rawView === "unread" ? "unread"
      : rawView === "favorites" ? "favorites"
      : "all";
  const [activeTab, setActiveTab] = useState<ConversationsTab>(tabFromUrl);
  const [showFilters, setShowFilters] = useState(false);

  const switchTab = (tab: ConversationsTab) => {
    setActiveTab(tab);
    const sp = new URLSearchParams(searchParams.toString());
    if (tab === "mercadolibre") sp.set("view", "mercadolibre");
    else if (tab === "unread") sp.set("view", "unread");
    else if (tab === "favorites") sp.set("view", "favorites");
    else sp.delete("view");
    router.replace(`/conversations${sp.toString() ? `?${sp.toString()}` : ""}`, { scroll: false });
  };

  // Selected conversation id — driven from URL `?id=` so deep-links
  // and browser back/forward work.
  const selectedId = searchParams.get("id");
  const setSelectedId = useCallback((id: string | null) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (id) sp.set("id", id);
    else sp.delete("id");
    router.replace(`/conversations${sp.toString() ? `?${sp.toString()}` : ""}`, { scroll: false });
  }, [router, searchParams]);

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

  // Marcos 2026-07-21: buscador siempre visible en el header (antes
  // estaba adentro del panel de filtros y "desapareció" al colapsar).
  // Debounce 250ms para no disparar un fetch por cada tecla.
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const h = setTimeout(() => {
      setFilters((f) => (f.search === searchInput.trim() ? f : { ...f, search: searchInput.trim() }));
    }, 250);
    return () => clearTimeout(h);
  }, [searchInput]);

  const fetchConversations = async (page: number = 1, silent: boolean = false) => {
    try {
      if (!silent) setIsLoading(true);
      setError(null);
      const params: GetConversationsParams = { page, limit: PAGE_SIZE };
      if (filters.status && filters.status !== "ALL") params.status = filters.status;
      if (filters.channel && filters.channel !== "ALL") params.channel = filters.channel;
      if (filters.assignedTo && filters.assignedTo !== "ALL") params.assignedTo = filters.assignedTo;
      if (filters.search && filters.search.trim().length > 0) params.search = filters.search.trim();
      // Tab "No leídos" → filter server-side por needsHumanAttention=true.
      if (activeTab === "unread") params.needsHumanAttention = true;
      // Tab "Favoritas" → filter server-side por favorite=true.
      if (activeTab === "favorites") params.favorite = true;
      const response = await api.conversations.getAll(params);
      setConversations(response.conversations);
      setTotalCount(response.total);
      setCurrentPage(response.page);
      setTotalPages(response.totalPages);
    } catch (err: any) {
      if (!silent) setError(err.message || "Error al cargar conversaciones");
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations(1);
  }, [filters, activeTab]);

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

  // Marcos 2026-07-21 (complaint 16:45 AR): el socket se cayó y el
  // inbox quedó congelado — los mensajes entraban al backend pero
  // Marcos no los veía en la pantalla. Poll de fallback cada 15s
  // cuando la tab está visible. Silent refresh: no muestra skeleton
  // ni parpadea la lista, sólo actualiza data. Coalesce con el tick
  // de socket usando el mismo refreshTimer así una ráfaga de socket
  // events + un tick de poll no dispara dos fetches.
  useEffect(() => {
    let paused = document.visibilityState !== "visible";
    const onVis = () => {
      const wasVisible = !paused;
      paused = document.visibilityState !== "visible";
      // Al volver a la tab, refrescamos inmediatamente (podríamos
      // haber perdido 15+ minutos de eventos por WebSocket dormido).
      if (!wasVisible && !paused) onTick();
    };
    document.addEventListener("visibilitychange", onVis);
    const iv = setInterval(() => {
      if (paused) return;
      onTick();
    }, 15_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(iv);
    };
  }, [onTick]);

  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);

  const handleFilterChange = (newFilters: ConversationFilters) => {
    setFilters(newFilters);
    setCurrentPage(1);
  };
  const handleRefresh = () => fetchConversations(currentPage);
  const handlePageChange = (page: number) => fetchConversations(page);

  // Selection behavior: click a row.
  //   Desktop (md+): update `?id=` and render detail on the right.
  //   Mobile:        push to /conversations/[id] so the detail takes
  //                  the full screen; the split doesn't fit sub-md.
  const handleSelect = useCallback((id: string) => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      router.push(`/conversations/${id}`);
      return;
    }
    setSelectedId(id);
  }, [router, setSelectedId]);

  // ML tab still gets its own full-width layout — the split-pane
  // applies only to the regular conversations tab.
  if (activeTab === "mercadolibre") {
    return (
      <div className="space-y-3 animate-in fade-in duration-300">
        <CompactHeader
          onRefresh={handleRefresh}
          isLoading={isLoading}
          activeTab={activeTab}
          switchTab={switchTab}
          mlTabAllowed={mlTabAllowed}
          mlPendingCount={mlPendingCount}
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          searchValue={searchInput}
          onSearchChange={setSearchInput}
        />
        <MercadolibreQaList />
      </div>
    );
  }

  return (
    <div className="animate-in fade-in duration-300">
      <CompactHeader
        onRefresh={handleRefresh}
        isLoading={isLoading}
        activeTab={activeTab}
        switchTab={switchTab}
        mlTabAllowed={mlTabAllowed}
        mlPendingCount={mlPendingCount}
        showFilters={showFilters}
        setShowFilters={setShowFilters}
        searchValue={searchInput}
        onSearchChange={setSearchInput}
      />

      {showFilters && (
        <div className="mb-2">
          <ConversationFiltersComponent
            filters={filters}
            onFilterChange={handleFilterChange}
            totalCount={totalCount}
          />
        </div>
      )}

      {error && (
        <div className="mb-2 flex items-start gap-2.5 rounded-lg border border-red-200/70 bg-red-50/80 px-3 py-2 text-sm text-red-700">
          <ErrorOutlineIcon sx={{ fontSize: 16 }} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Split pane: list left, detail right on md+. On mobile the
          list takes full width and a row tap navigates to the detail
          route (fullscreen). */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[360px_1fr] md:gap-3">
        {/* LEFT — list */}
        <div className="flex h-[calc(100dvh-160px)] min-h-[420px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex-1 overflow-y-auto">
            {isLoading && conversations.length === 0 ? (
              <div className="p-2 space-y-1">
                {[...Array(10)].map((_, i) => (<Skeleton key={i} className="h-14" />))}
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <span className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-slate-200 to-slate-100 text-slate-400">
                  <ChatBubbleOutlineIcon sx={{ fontSize: 22 }} />
                </span>
                <p className="text-sm font-medium text-slate-900">Sin resultados</p>
                <p className="mt-1 text-xs text-slate-500">Ajustá o limpiá los filtros.</p>
              </div>
            ) : (
              conversations.map((c) => (
                <ConversationListItem
                  key={c.id}
                  conversation={c}
                  selected={selectedId === c.id}
                  onSelect={handleSelect}
                  onFavoriteChange={(id, fav) => {
                    // Actualizamos la lista optimistamente. Si estamos
                    // en la tab Favoritas y desmarcamos, la fila
                    // desaparece; en Todas/No leídas, sólo cambia el
                    // ícono. Un fetch silencioso confirma el estado.
                    setConversations((prev) => {
                      if (activeTab === "favorites" && !fav) {
                        return prev.filter((p) => p.id !== id);
                      }
                      return prev.map((p) => (p.id === id ? { ...p, favorite: fav } : p));
                    });
                    // Silent re-sync so page count / server view stays honest.
                    fetchConversations(currentPage, true);
                  }}
                />
              ))
            )}
          </div>
          {totalPages > 1 && (
            <div className="border-t border-slate-100 p-1">
              <Pagination
                position="bottom"
                page={currentPage}
                totalPages={totalPages}
                totalItems={totalCount}
                pageSize={PAGE_SIZE}
                onPageChange={handlePageChange}
                disabled={isLoading}
              />
            </div>
          )}
        </div>

        {/* RIGHT — detail (only visible md+). Contenedor con altura de
            viewport para que el detalle jamás fuerce a scrollear la
            página; adentro el panel maneja sus paneles con scroll
            interno. Alineado con la altura de la columna izquierda. */}
        <div className="hidden md:block md:h-[calc(100dvh-160px)] md:min-h-[420px] md:overflow-hidden">
          {selectedId ? (
            <ConversationDetailPanel
              key={selectedId}
              conversationId={selectedId}
              embedded
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/40 text-center">
              <span className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-slate-200 to-slate-100 text-slate-400">
                <ChatBubbleOutlineIcon sx={{ fontSize: 24 }} />
              </span>
              <p className="text-sm font-medium text-slate-900">Elegí una conversación</p>
              <p className="mt-1 text-xs text-slate-500">Se abre acá a la derecha, como en WhatsApp.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface CompactHeaderProps {
  onRefresh: () => void;
  isLoading: boolean;
  activeTab: ConversationsTab;
  switchTab: (t: ConversationsTab) => void;
  mlTabAllowed: boolean;
  mlPendingCount: number;
  showFilters: boolean;
  setShowFilters: (v: boolean) => void;
  searchValue: string;
  onSearchChange: (v: string) => void;
}
function CompactHeader({
  onRefresh, isLoading, activeTab, switchTab, mlTabAllowed, mlPendingCount,
  showFilters, setShowFilters, searchValue, onSearchChange,
}: CompactHeaderProps) {
  return (
    <div className="mb-2 border-b border-slate-200 pb-1">
      {/* Row 1: tabs + acciones */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => switchTab("all")}
            className={
              "inline-flex h-9 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors " +
              (activeTab === "all" ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800")
            }
          >
            <ChatBubbleOutlineIcon sx={{ fontSize: 15 }} />
            Todas
          </button>
          <button
            type="button"
            onClick={() => switchTab("unread")}
            className={
              "inline-flex h-9 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors " +
              (activeTab === "unread" ? "border-rose-600 text-rose-700" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800")
            }
          >
            <MarkChatUnreadIcon sx={{ fontSize: 15 }} />
            No leídas
          </button>
          <button
            type="button"
            onClick={() => switchTab("favorites")}
            className={
              "inline-flex h-9 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors " +
              (activeTab === "favorites" ? "border-amber-600 text-amber-700" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800")
            }
          >
            <StarIcon sx={{ fontSize: 15 }} />
            Favoritas
          </button>
          {mlTabAllowed && (
            <button
              type="button"
              onClick={() => switchTab("mercadolibre")}
              className={
                "inline-flex h-9 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors " +
                (activeTab === "mercadolibre" ? "border-yellow-600 text-yellow-700" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800")
              }
            >
              <StorefrontIcon sx={{ fontSize: 15 }} />
              Mercado Libre
              {mlPendingCount > 0 && (
                <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-bold tabular-nums text-white">
                  {mlPendingCount}
                </span>
              )}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {activeTab !== "mercadolibre" && (
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              aria-pressed={showFilters}
              title="Filtros avanzados (canal, estado, asignado)"
              className={
                "inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors " +
                (showFilters
                  ? "border-blue-300 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700")
              }
            >
              <FilterListIcon sx={{ fontSize: 14 }} />
              Filtros
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="Actualizar"
            className="inline-flex h-8 items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition-colors hover:border-blue-300 hover:text-blue-700 disabled:opacity-60"
          >
            <RefreshIcon sx={{ fontSize: 14 }} className={isLoading ? "animate-spin" : ""} />
            Actualizar
          </button>
        </div>
      </div>
      {/* Row 2: buscador SIEMPRE visible en las tabs de chat.
          Marcos 2026-07-21: pidió que el buscador vuelva a estar
          arriba, sin necesidad de abrir Filtros. Debounce en el
          componente padre. */}
      {activeTab !== "mercadolibre" && (
        <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1">
          <SearchIcon sx={{ fontSize: 16 }} className="text-slate-400" />
          <input
            type="search"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar por nombre, número, o texto del mensaje…"
            className="min-w-0 flex-1 border-none bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="text-[11px] font-medium text-slate-400 hover:text-slate-700"
            >
              Limpiar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
