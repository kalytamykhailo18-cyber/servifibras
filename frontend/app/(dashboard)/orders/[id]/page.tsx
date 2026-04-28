"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { OrderTimeline } from "@/components/orders/order-timeline";
import { api } from "@/lib/api/endpoints";
import type { Order } from "@/types";
import { OrderStatus, ORDER_STATUS_LABELS } from "@/types";
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import InventoryIcon from '@mui/icons-material/Inventory';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export default function OrderDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrier, setCarrier] = useState("");

  // ========================================================================
  // FETCH ORDER
  // ========================================================================

  const fetchOrder = async () => {
    try {
      setIsLoading(true);
      const data = await api.orders.getById(params.id);
      setOrder(data);
      setTrackingNumber(data.trackingNumber || "");
      setCarrier(data.carrier || "");
    } catch (error: any) {
      toast.error(error.message || "Error al cargar pedido");
      router.push("/orders");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrder();
  }, [params.id]);

  // ========================================================================
  // HANDLERS
  // ========================================================================

  const handleStatusChange = async (status: OrderStatus) => {
    if (!order) return;

    try {
      await api.orders.updateStatus(order.id, { status });
      toast.success("Estado actualizado correctamente");
      fetchOrder();
    } catch (error: any) {
      toast.error(error.message || "Error al actualizar estado");
    }
  };

  const handleTrackingUpdate = async () => {
    if (!order || !trackingNumber || !carrier) {
      toast.error("Completa el número de tracking y transportista");
      return;
    }

    try {
      await api.orders.updateTracking(order.id, { trackingNumber, carrier });
      toast.success("Información de tracking actualizada");
      fetchOrder();
    } catch (error: any) {
      toast.error(error.message || "Error al actualizar tracking");
    }
  };

  // ========================================================================
  // RENDER: LOADING STATE
  // ========================================================================

  if (isLoading || !order) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  // ========================================================================
  // RENDER: MAIN CONTENT
  // ========================================================================

  // Parse products
  let productsDisplay: any = order.products;
  if (typeof order.products === "string") {
    try {
      productsDisplay = JSON.parse(order.products);
    } catch {
      productsDisplay = order.products;
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* HEADER */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/orders")}>
          <ArrowBackIcon className="h-4 w-4 mr-2" />
          Volver a Pedidos
        </Button>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-mono">
            #{order.orderNumber}
          </h1>
          <p className="text-muted-foreground">
            Creado el {format(new Date(order.createdAt), "PPP", { locale: es })}
          </p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      {/* MAIN GRID */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* LEFT COLUMN - Order Details */}
        <div className="md:col-span-2 space-y-6">
          {/* Customer Information */}
          <Card>
            <CardHeader>
              <CardTitle>Información del Cliente</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label>Nombre</Label>
                  <p className="text-sm font-medium">
                    {order.contact?.name || "N/A"}
                  </p>
                </div>
                <div>
                  <Label>Teléfono</Label>
                  <p className="text-sm font-medium">
                    {order.contact?.phone || "N/A"}
                  </p>
                </div>
                <div>
                  <Label>Email</Label>
                  <p className="text-sm font-medium">
                    {order.contact?.email || "N/A"}
                  </p>
                </div>
                <div>
                  <Label>Tipo</Label>
                  <p className="text-sm font-medium">
                    {order.contact?.type || "N/A"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Products */}
          <Card>
            <CardHeader>
              <CardTitle>Productos</CardTitle>
            </CardHeader>
            <CardContent>
              {Array.isArray(productsDisplay) ? (
                <div className="space-y-3">
                  {productsDisplay.map((product: any, index: number) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <InventoryIcon className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{product.name || product.product}</p>
                          {product.qty && (
                            <p className="text-sm text-muted-foreground">
                              Cantidad: {product.qty}
                            </p>
                          )}
                        </div>
                      </div>
                      {product.price && (
                        <span className="font-semibold text-green-600">
                          ${product.price.toLocaleString("es-AR")}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 bg-muted rounded-lg">
                  <pre className="text-sm whitespace-pre-wrap font-mono">
                    {typeof productsDisplay === "string"
                      ? productsDisplay
                      : JSON.stringify(productsDisplay, null, 2)}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Order Details */}
          <Card>
            <CardHeader>
              <CardTitle>Detalles del Pedido</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label>Monto Total</Label>
                  <p className="text-2xl font-bold text-green-600">
                    {order.currency} ${order.amount.toLocaleString("es-AR")}
                  </p>
                </div>
                <div>
                  <Label>Moneda</Label>
                  <p className="text-sm font-medium">{order.currency}</p>
                </div>
              </div>
              {order.notes && (
                <div>
                  <Label>Notas</Label>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {order.notes}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT COLUMN - Status & Actions */}
        <div className="space-y-6">
          {/* Status Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Línea de Tiempo</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderTimeline
                currentStatus={order.status}
                dispatchedAt={order.dispatchedAt ? new Date(order.dispatchedAt) : null}
                deliveredAt={order.deliveredAt ? new Date(order.deliveredAt) : null}
                createdAt={new Date(order.createdAt)}
              />
            </CardContent>
          </Card>

          {/* Change Status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Cambiar Estado</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={order.status} onValueChange={(value) => handleStatusChange(value as OrderStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ORDER_STATUS_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Tracking Information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <LocalShippingIcon className="h-4 w-4" />
                Información de Envío
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="trackingNumber">Número de Tracking</Label>
                <Input
                  id="trackingNumber"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="ABC123456789"
                />
              </div>
              <div>
                <Label htmlFor="carrier">Transportista</Label>
                <Input
                  id="carrier"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  placeholder="DHL, FedEx, Correo Argentino..."
                />
              </div>
              <Button
                onClick={handleTrackingUpdate}
                className="w-full"
                size="sm"
                disabled={!trackingNumber || !carrier}
              >
                Actualizar Tracking
              </Button>
              {order.dispatchedAt && (
                <p className="text-xs text-muted-foreground">
                  Despachado: {format(new Date(order.dispatchedAt), "PPP", { locale: es })}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Order Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Información</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">ID</span>
                <span className="font-mono text-xs">{order.id.slice(0, 8)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Creado</span>
                <span>{format(new Date(order.createdAt), "PP", { locale: es })}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Actualizado</span>
                <span>{format(new Date(order.updatedAt), "PP", { locale: es })}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
