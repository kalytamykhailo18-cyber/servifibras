"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { OrderStatus, ORDER_STATUS_LABELS } from "@/types";
import AddIcon from '@mui/icons-material/Add';
import BarChartIcon from '@mui/icons-material/BarChart';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import FilterListIcon from '@mui/icons-material/FilterList';
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

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [deletingOrder, setDeletingOrder] = useState<Order | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // ========================================================================
  // FETCH ORDERS
  // ========================================================================

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

  // ========================================================================
  // HANDLERS
  // ========================================================================

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

  // ========================================================================
  // RENDER: LOADING STATE
  // ========================================================================

  if (isLoading && orders.length === 0) {
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
            <h1 className="text-3xl font-bold tracking-tight">Pedidos</h1>
            <p className="text-muted-foreground">
              Gestiona los pedidos confirmados y su cumplimiento
            </p>
          </div>
          <Button onClick={fetchOrders} variant="outline" size="sm">
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
          <h1 className="text-3xl font-bold tracking-tight">Pedidos</h1>
          <p className="text-muted-foreground">
            Gestiona los pedidos confirmados y su cumplimiento
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => router.push("/orders/stats")}
            variant="outline"
            size="sm"
          >
            <BarChartIcon className="h-4 w-4 mr-2" />
            Estadísticas
          </Button>

          <Button onClick={fetchOrders} variant="outline" size="sm">
            <RefreshIcon
              className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`}
            />
            Actualizar
          </Button>

          <Button onClick={() => setIsFormOpen(true)} size="sm">
            <AddIcon className="h-4 w-4 mr-2" />
            Nuevo Pedido
          </Button>
        </div>
      </div>

      {/* FILTERS */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <FilterListIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Filtrar por estado:</span>
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
        <span className="text-sm text-muted-foreground">
          {orders.length} pedido{orders.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ORDERS TABLE */}
      <OrderTable
        orders={orders}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      {/* CREATE/EDIT DIALOG */}
      <OrderFormDialog
        open={isFormOpen}
        onOpenChange={handleFormClose}
        order={editingOrder || undefined}
        onSuccess={() => {
          fetchOrders();
          handleFormClose();
        }}
      />

      {/* DELETE CONFIRMATION */}
      <AlertDialog
        open={!!deletingOrder}
        onOpenChange={() => setDeletingOrder(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar pedido?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El pedido{" "}
              <strong>{deletingOrder?.orderNumber}</strong> será eliminado
              permanentemente.
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
