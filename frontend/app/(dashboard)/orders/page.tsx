"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
import { api } from "@/lib/api/endpoints";
import type { Order } from "@/types";
import { ORDER_STATUS_LABELS } from "@/types";
import AddIcon from "@mui/icons-material/Add";
import BarChartIcon from "@mui/icons-material/BarChart";
import DeleteIcon from "@mui/icons-material/Delete";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import FilterListIcon from "@mui/icons-material/FilterList";
import InventoryIcon from "@mui/icons-material/Inventory";
import RefreshIcon from "@mui/icons-material/Refresh";
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
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [deletingOrder, setDeletingOrder] = useState<Order | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const fetchOrders = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const params: any = { limit: 1000 };
      if (statusFilter !== "all") {
        params.status = statusFilter;
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
    fetchOrders();
  }, [statusFilter]);

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
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">Pedidos</h1>
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

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* PAGE HEADER */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-green-500 to-emerald-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(34_197_94/0.45)]">
            <InventoryIcon sx={{ fontSize: 22 }} />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Pedidos</h1>
            <p className="text-sm text-muted-foreground">
              Gestiona los pedidos confirmados y su cumplimiento
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => router.push("/orders/stats")}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-pink-300 hover:bg-pink-50 hover:text-pink-700 hover:shadow-[0_8px_20px_-6px_rgb(236_72_153/0.25)] active:translate-y-0 active:scale-[0.97]"
          >
            <BarChartIcon sx={{ fontSize: 16 }} />
            Estadísticas
          </button>

          <button
            type="button"
            onClick={fetchOrders}
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
            className="inline-flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-green-600 to-emerald-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(34_197_94/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(34_197_94/0.65)] active:translate-y-0 active:scale-[0.97]"
          >
            <AddIcon sx={{ fontSize: 18 }} />
            Nuevo Pedido
          </button>
        </div>
      </div>

      {/* FILTERS */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600">
          <FilterListIcon sx={{ fontSize: 16 }} className="text-slate-400" />
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
          <span className="font-semibold text-slate-900 tabular-nums">{orders.length}</span>
          pedido{orders.length !== 1 ? "s" : ""}
        </span>
      </div>

      <OrderTable orders={orders} onEdit={handleEdit} onDelete={handleDelete} />

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
