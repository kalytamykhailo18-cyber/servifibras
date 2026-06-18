"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useRealtimeEvent } from "@/lib/realtime/use-realtime";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OrderTable } from "@/components/orders/order-table";
import { OrderFormDialog } from "@/components/orders/order-form-dialog";
import { PendingInvoicingList } from "@/components/orders/pending-invoicing-list";
import { PendingReturnsList } from "@/components/orders/pending-returns-list";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/endpoints";
import type { Order } from "@/types";
import { ORDER_STATUS_LABELS, UserRole } from "@/types";
import { useRoleGuard } from "@/lib/hooks/use-role-guard";
import { useClientPagination } from "@/lib/hooks/use-client-pagination";
import { Pagination } from "@/components/ui/pagination";

const ORDERS_ROLES = [UserRole.ADMIN, UserRole.LOGISTICA];
import AddIcon from "@mui/icons-material/Add";
import BarChartIcon from "@mui/icons-material/BarChart";
import DeleteIcon from "@mui/icons-material/Delete";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import FilterListIcon from "@mui/icons-material/FilterList";
import InventoryIcon from "@mui/icons-material/Inventory";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
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

export default function OrdersPage() {
  const router = useRouter();
  const { isAllowed } = useRoleGuard(ORDERS_ROLES);
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [deletingOrder, setDeletingOrder] = useState<Order | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  // Marcos 2026-06-18: free-text search por número de pedido o
  // nombre de cliente. El input renderiza inmediato; el fetch
  // arranca 300 ms después de que el operador deja de tipear, así
  // no martillamos la API por cada tecla.
  const [searchInput, setSearchInput] = useState<string>("");
  const [searchDebounced, setSearchDebounced] = useState<string>("");
  // Marcos 2026-06-12: top-level view toggle on the page.
  // Marcos 2026-06-18 PM: "todos" se partió en TIENDANUBE / OTROS
  // MEDIOS para que el operador no tenga que escanear cientos de TN
  // mezcladas con los manuales. "Otros medios" = manuales + ML (y
  // cualquier source futuro que no sea TN).
  const [view, setView] = useState<'tiendanube' | 'otros' | 'pendientes-facturacion' | 'pendientes-regreso'>('tiendanube');
  // Filtra por canal en memoria — el fetch ya trae los 1000 más
  // recientes, partirlos client-side es instantáneo y evita un
  // re-fetch por cada cambio de tab.
  const filteredBySource = useMemo(() => {
    if (view === 'tiendanube') {
      return orders.filter((o) => (o as any).source === 'TIENDANUBE');
    }
    if (view === 'otros') {
      return orders.filter((o) => (o as any).source !== 'TIENDANUBE');
    }
    return orders;
  }, [orders, view]);
  const pg = useClientPagination(filteredBySource, { storageKey: `orders-${view}`, defaultPageSize: 25 });

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const fetchOrders = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const params: any = { limit: 1000 };
      if (statusFilter !== "all") {
        params.status = statusFilter;
      }
      if (searchDebounced.length > 0) {
        params.search = searchDebounced;
      }
      const response = await api.orders.list(params);
      setOrders(response.data);
    } catch (err: any) {
      setError(err.message || "Error al cargar pedidos");
      toast.error("Error al cargar pedidos");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAllowed) fetchOrders();
  }, [statusFilter, searchDebounced, isAllowed]);

  // Silent refresh when a new wholesale order lands while the page is open.
  // No toast here — RealtimeNotifications already surfaces it globally.
  const onOrderCreated = useCallback(() => {
    if (isAllowed) fetchOrders();
  }, [isAllowed, statusFilter]);
  useRealtimeEvent("order:created", onOrderCreated);

  if (!isAllowed) return null;

  const handleEdit = (order: Order) => {
    setEditingOrder(order);
    setIsFormOpen(true);
  };

  const handleDelete = (order: Order) => {
    setDeletingOrder(order);
  };

  const confirmDelete = async () => {
    if (!deletingOrder) return;
    try {
      await api.orders.delete(deletingOrder.id);
      toast.success("Pedido eliminado correctamente");
      fetchOrders();
    } catch (error: any) {
      toast.error(error.message || "Error al eliminar pedido");
    } finally {
      setDeletingOrder(null);
    }
  };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setEditingOrder(null);
  };

  if (isLoading && orders.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-4 w-72" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-32 rounded-full" />
            <Skeleton className="h-10 w-28 rounded-full" />
            <Skeleton className="h-10 w-36 rounded-full" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-11 w-52 rounded-xl" />
        </div>
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-green-500 to-emerald-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(34_197_94/0.45)]">
              <InventoryIcon sx={{ fontSize: 22 }} />
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight sm:text-3xl text-slate-900">Pedidos</h1>
              <p className="text-sm text-muted-foreground">
                Gestiona los pedidos confirmados y su cumplimiento
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={fetchOrders}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:translate-y-0 active:scale-[0.97]"
          >
            <RefreshIcon sx={{ fontSize: 16 }} className="text-blue-600" />
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

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* PAGE HEADER */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-green-500 to-emerald-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(34_197_94/0.45)] sm:h-11 sm:w-11">
            <InventoryIcon sx={{ fontSize: 20 }} className="sm:[font-size:22px]" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-3xl text-slate-900">Pedidos</h1>
            <p className="hidden text-sm text-muted-foreground sm:block">
              Gestiona los pedidos confirmados y su cumplimiento
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => router.push("/orders/stats")}
            aria-label="Estadísticas"
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-pink-300 hover:bg-pink-50 hover:text-pink-700 hover:shadow-[0_8px_20px_-6px_rgb(236_72_153/0.25)] active:translate-y-0 active:scale-[0.97] sm:px-4"
          >
            <BarChartIcon sx={{ fontSize: 16 }} className="text-pink-600" />
            <span className="hidden sm:inline">Estadísticas</span>
          </button>

          <button
            type="button"
            onClick={fetchOrders}
            disabled={isLoading}
            aria-label="Actualizar"
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 hover:shadow-[0_8px_20px_-6px_rgb(59_130_246/0.25)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 sm:px-4"
          >
            <RefreshIcon
              sx={{ fontSize: 16 }}
              className={isLoading ? "animate-spin" : ""}
            />
            <span className="hidden sm:inline">Actualizar</span>
          </button>

          <button
            type="button"
            onClick={() => setIsFormOpen(true)}
            aria-label="Nuevo pedido"
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-gradient-to-r from-green-600 to-emerald-500 px-3 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(34_197_94/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(34_197_94/0.65)] active:translate-y-0 active:scale-[0.97] sm:px-5"
          >
            <AddIcon sx={{ fontSize: 18 }} />
            <span className="hidden sm:inline">Nuevo Pedido</span>
            <span className="sm:hidden">Nuevo</span>
          </button>
        </div>
      </div>

      {/* VIEW TABS — Marcos 2026-06-12; partidos en TN / Otros 2026-06-18 PM */}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="orders-view-tabs">
        {([
          { id: 'tiendanube' as const,               label: 'Tienda Nube' },
          { id: 'otros' as const,                    label: 'Otros medios' },
          { id: 'pendientes-facturacion' as const,   label: 'Pendientes de facturación' },
          { id: 'pendientes-regreso' as const,       label: 'Pendientes de regreso' },
        ]).map((t) => {
          // Conteos por canal — el operador lee el peso de cada tab
          // sin tener que abrirlo. Sólo aplica a las dos tabs de
          // listado (las otras son listas dedicadas).
          let count: number | null = null;
          if (t.id === 'tiendanube') count = orders.filter((o) => (o as any).source === 'TIENDANUBE').length;
          else if (t.id === 'otros') count = orders.filter((o) => (o as any).source !== 'TIENDANUBE').length;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              data-testid={`orders-view-tab-${t.id}`}
              aria-pressed={view === t.id}
              className={
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition-colors " +
                (view === t.id
                  ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
              }
            >
              {t.label}
              {count != null && (
                <span className={
                  "inline-flex h-5 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] tabular-nums " +
                  (view === t.id ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600")
                }>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {view === 'pendientes-facturacion' ? (
        <PendingInvoicingList />
      ) : view === 'pendientes-regreso' ? (
        <PendingReturnsList />
      ) : (<>
      {/* SEARCH — Marcos 2026-06-18 */}
      <div className="relative max-w-md">
        <SearchIcon sx={{ fontSize: 16 }} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por número de pedido o nombre de cliente…"
          className="h-10 pl-9 pr-9"
          data-testid="orders-search"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => setSearchInput("")}
            aria-label="Limpiar búsqueda"
            data-testid="orders-search-clear"
            className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <CloseIcon sx={{ fontSize: 14 }} />
          </button>
        )}
      </div>

      {/* FILTERS */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600">
          <FilterListIcon sx={{ fontSize: 16 }} className="text-blue-600" />
          Filtrar por estado:
        </div>
        <Select value={statusFilter} onValueChange={(value) => value && setStatusFilter(value)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(ORDER_STATUS_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span className="font-semibold text-slate-900 tabular-nums">{filteredBySource.length}</span>
          pedido{filteredBySource.length !== 1 ? "s" : ""}
        </span>
      </div>

      <Pagination
        position="top"
        page={pg.page}
        totalPages={pg.totalPages}
        totalItems={pg.totalItems}
        pageSize={pg.pageSize}
        onPageChange={pg.setPage}
        onPageSizeChange={pg.setPageSize}
      />

      <OrderTable orders={pg.slice} onEdit={handleEdit} onDelete={handleDelete} />

      <div className="mt-3">
        <Pagination
          position="bottom"
          page={pg.page}
          totalPages={pg.totalPages}
          totalItems={pg.totalItems}
          pageSize={pg.pageSize}
          onPageChange={pg.setPage}
          onPageSizeChange={pg.setPageSize}
        />
      </div>
      </>)}

      <OrderFormDialog
        open={isFormOpen}
        onOpenChange={handleFormClose}
        order={editingOrder || undefined}
        onSuccess={() => {
          fetchOrders();
          handleFormClose();
        }}
      />

      <AlertDialog
        open={!!deletingOrder}
        onOpenChange={() => setDeletingOrder(null)}
      >
        <AlertDialogContent className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150">
          <AlertDialogHeader className="space-y-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-red-500 to-rose-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(239_68_68/0.45)]">
              <DeleteIcon sx={{ fontSize: 22 }} />
            </span>
            <AlertDialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              ¿Eliminar pedido?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-slate-600">
              Esta acción no se puede deshacer. El pedido{" "}
              <strong className="font-semibold text-slate-900">
                {deletingOrder?.orderNumber}
              </strong>{" "}
              será eliminado permanentemente.
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
