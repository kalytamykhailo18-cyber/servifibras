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
import {
  loadOrdersSnapshot,
  saveOrdersSnapshot,
} from "@/lib/cache/orders-cache";
import type { Order } from "@/types";
import { ORDER_STATUS_LABELS, UserRole } from "@/types";
import { useRoleGuard } from "@/lib/hooks/use-role-guard";
import { useAuthStore } from "@/lib/store/auth-store";
import { useClientPagination } from "@/lib/hooks/use-client-pagination";
import { Pagination } from "@/components/ui/pagination";

// Marcos 2026-06-23: ENCARGADO supervisa logística — explicit en la lista
// para que la lectura del código matchee el comportamiento (el useRoleGuard
// igual lo auto-expandiría a partir de LOGISTICA, pero preferimos ser
// explícitos para que no haya dudas). Marcos 2026-06-23 (segundo pedido):
// VENTAS también carga pedidos (normales y laminados PRFV) — el botón
// "Nuevo pedido" vive en esta página, así que VENTAS necesita entrar.
// El backend POST /admin/orders ya admite VENTAS; sólo faltaba el gate
// del listado. Las acciones de cambiar estado / tracking siguen
// disabled para VENTAS desde el detalle (gate aparte en [id]/page.tsx).
// Marcos 2026-07-08: agregado ATENCION. Brenda (atención) crea pedidos
// desde el hilo de WhatsApp; el gate viejo la mandaba a "no autorizado"
// al entrar a /orders. Backend POST/GET admin/orders también se abre a
// ATENCION en el mismo push.
const ORDERS_ROLES = [UserRole.ADMIN, UserRole.LOGISTICA, UserRole.ENCARGADO, UserRole.VENTAS, UserRole.ATENCION];
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
  // Marcos 2026-06-27 (audit fix): backend gate de Pendientes-facturación
  // es ADMIN+VENTAS+ATENCION; el rol-inheritance no agrega LOGISTICA ni
  // ENCARGADO porque no hay ATENCION-or-LOGISTICA en la lista. Antes la
  // tab era visible para LOGISTICA/ENCARGADO y al clickearla daba 403
  // silencioso. Acá hideamos la tab para roles que no pueden ver el
  // contenido. (Pendientes-regreso allows ENCARGADO así que ese sigue
  // visible.)
  const currentRole = useAuthStore((s) => s.user?.role ?? null);
  const canSeeBillingTab =
    currentRole === UserRole.ADMIN
    || currentRole === UserRole.VENTAS
    || currentRole === UserRole.ATENCION;
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Marcos 2026-06-26 (mitigación caché): cuando la API se cae y hay
  // un snapshot en localStorage, mostramos esos datos en vez de la
  // pantalla de error. staleSnapshotAt marca el timestamp del snapshot
  // que se está mostrando — cuando es non-null el banner amarillo
  // "Datos del [hora], reconectando…" se renderiza arriba de la tabla.
  // El reintento en background (cada 30s) lo limpia cuando la API
  // vuelve. Pensado para Pedidos por el incidente del 06-25.
  const [staleSnapshotAt, setStaleSnapshotAt] = useState<Date | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [deletingOrder, setDeletingOrder] = useState<Order | null>(null);
  // Marcos 2026-06-21: cancelar es la accion primaria para
  // operadores. Modal aparte del delete porque pide un motivo
  // obligatorio que queda registrado en la auditoria.
  const [cancellingOrder, setCancellingOrder] = useState<Order | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSaving, setCancelSaving] = useState(false);
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

  // Marcos 2026-06-26: el fetch ahora tiene 3 caminos:
  //   1. OK → renderiza data fresca + guarda snapshot (solo la vista
  //      default sin filtros, para no pisar la cache con resultados
  //      filtrados).
  //   2. Falla con cache válido → renderiza cache + activa banner
  //      stale + (en silencio) el caller arranca el reintento en
  //      background.
  //   3. Falla sin cache → cae al bloque de error pleno como antes.
  const fetchOrders = async (opts?: { background?: boolean }) => {
    const isBackground = opts?.background === true;
    try {
      if (!isBackground) {
        setIsLoading(true);
        setError(null);
      }
      const params: any = { limit: 1000 };
      if (statusFilter !== "all") {
        params.status = statusFilter;
      }
      if (searchDebounced.length > 0) {
        params.search = searchDebounced;
      }
      const response = await api.orders.list(params);
      setOrders(response.data);
      // Cache solo cuando estamos en la vista default (sin filtros).
      // Una vista filtrada no debe pisar el snapshot completo.
      if (statusFilter === "all" && searchDebounced.length === 0) {
        saveOrdersSnapshot(response.data as unknown[], response.total ?? response.data.length);
      }
      setStaleSnapshotAt(null);
      setError(null);
    } catch (err: any) {
      const msg = err?.message || "Error al cargar pedidos";
      // Solo intentamos hidratar desde cache si NO estamos filtrando
      // (la cache solo guardó la vista default). Cuando hay filtros,
      // mostramos el error de toda la vida.
      const canTryCache = statusFilter === "all" && searchDebounced.length === 0;
      const snapshot = canTryCache ? loadOrdersSnapshot() : null;
      if (snapshot) {
        setOrders(snapshot.data as Order[]);
        setStaleSnapshotAt(snapshot.savedAt);
        setError(null);
        if (!isBackground) {
          toast.warning("La API no respondió. Mostrando últimos datos guardados localmente.");
        }
      } else if (!isBackground) {
        setError(msg);
        toast.error("Error al cargar pedidos");
      }
    } finally {
      if (!isBackground) setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAllowed) fetchOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, searchDebounced, isAllowed]);

  // Marcos 2026-06-26: reintento automático cuando estamos en modo
  // stale (banner amarillo). Cada 30s tratamos de recuperar la data
  // fresca; el primer éxito limpia staleSnapshotAt y vuelve todo a
  // normal. No spamea toasts — el background flag silencia ambos.
  useEffect(() => {
    if (!staleSnapshotAt || !isAllowed) return;
    const id = window.setInterval(() => {
      void fetchOrders({ background: true });
    }, 30_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staleSnapshotAt, isAllowed]);

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

  // Marcos 2026-06-21: cancel handlers — el modal pide motivo
  // obligatorio (min 5 chars; mismo gating que el backend para que el
  // boton se vea consistentemente disabled hasta tener uno escrito).
  const handleCancel = (order: Order) => {
    setCancellingOrder(order);
    setCancelReason("");
  };
  const confirmCancel = async () => {
    if (!cancellingOrder) return;
    const reason = cancelReason.trim();
    if (reason.length < 5) {
      toast.error("Escribí el motivo de cancelación (mínimo 5 caracteres)");
      return;
    }
    setCancelSaving(true);
    try {
      await api.orders.cancel(cancellingOrder.id, reason);
      toast.success(`Pedido ${cancellingOrder.orderNumber} cancelado`);
      setCancellingOrder(null);
      setCancelReason("");
      fetchOrders();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "No se pudo cancelar el pedido");
    } finally {
      setCancelSaving(false);
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
            onClick={() => void fetchOrders()}
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
            onClick={() => void fetchOrders()}
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

      {/* Marcos 2026-06-26 (mitigación): cuando la API se cayó y el
          componente está mostrando datos guardados localmente, el banner
          amarillo arriba avisa cuán viejos son los datos + reintenta en
          background cada 30s. Si la API vuelve, desaparece solo. */}
      {staleSnapshotAt && (
        <div
          data-testid="orders-stale-banner"
          className="flex items-start gap-2.5 rounded-xl border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-sm text-amber-900"
        >
          <ErrorOutlineIcon sx={{ fontSize: 18 }} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="space-y-0.5">
            <p className="font-semibold">Mostrando datos guardados localmente</p>
            <p className="text-[12px] text-amber-800">
              Última sincronización: {staleSnapshotAt.toLocaleString("es-AR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}. La API no respondió — reintentando en background cada 30s.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchOrders()}
            disabled={isLoading}
            className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-amber-400 bg-white px-3 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
          >
            <RefreshIcon sx={{ fontSize: 14 }} className={isLoading ? "animate-spin" : ""} />
            Reintentar ahora
          </button>
        </div>
      )}

      {/* VIEW TABS — Marcos 2026-06-12; partidos en TN / Otros 2026-06-18 PM */}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="orders-view-tabs">
        {([
          { id: 'tiendanube' as const,               label: 'Tienda Nube' },
          { id: 'otros' as const,                    label: 'Otros medios' },
          // Marcos 2026-06-27: hide billing tab from LOGISTICA/ENCARGADO
          // (backend rejects them — silent 403).
          ...(canSeeBillingTab
            ? [{ id: 'pendientes-facturacion' as const, label: 'Pendientes de facturación' }]
            : []),
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

      <OrderTable orders={pg.slice} onEdit={handleEdit} onDelete={handleDelete} onCancel={handleCancel} />

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

      {/* Marcos 2026-06-21: cancel modal — motivo obligatorio (min
         5 chars), boton 'Confirmar cancelación' disabled hasta tener
         uno escrito. La accion stampea cancelledAt + cancelledById +
         cancellationReason + status=CANCELLED en el backend. */}
      <AlertDialog
        open={!!cancellingOrder}
        onOpenChange={(open) => { if (!open && !cancelSaving) { setCancellingOrder(null); setCancelReason(""); } }}
      >
        <AlertDialogContent
          data-testid="order-cancel-dialog"
          className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150"
        >
          <AlertDialogHeader className="space-y-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(245_158_11/0.45)]">
              <DeleteIcon sx={{ fontSize: 22 }} />
            </span>
            <AlertDialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              ¿Cancelar pedido?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-slate-600">
              Vas a cancelar el pedido{" "}
              <strong className="font-semibold text-slate-900">{cancellingOrder?.orderNumber}</strong>.
              Queda registrado quién lo canceló, cuándo y el motivo — el pedido NO se borra, sólo cambia el estado a Cancelado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="mt-2 space-y-2">
            <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Motivo (obligatorio)
            </label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              maxLength={500}
              disabled={cancelSaving}
              data-testid="order-cancel-reason"
              placeholder='Ej: "Cliente arrepentido", "Pago rechazado", "Sin stock confirmado", "Error de carga"…'
              className="w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-sm leading-relaxed placeholder:text-slate-400 outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-500/15 disabled:opacity-60"
            />
            <p className="text-[10px] text-slate-400">
              Mínimo 5 caracteres. Va al panel de auditoría con tu usuario.
            </p>
          </div>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel
              disabled={cancelSaving}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
            >
              Volver
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void confirmCancel(); }}
              disabled={cancelSaving || cancelReason.trim().length < 5}
              data-testid="order-cancel-confirm"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(245_158_11/0.5)] transition-all duration-300 hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
            >
              {cancelSaving ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : null}
              Confirmar cancelación
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
