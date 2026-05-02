"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { OrderTimeline } from "@/components/orders/order-timeline";
import { api } from "@/lib/api/endpoints";
import type { Order } from "@/types";
import { OrderStatus, ORDER_STATUS_LABELS } from "@/types";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import EmailIcon from "@mui/icons-material/Email";
import InventoryIcon from "@mui/icons-material/Inventory";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import PersonIcon from "@mui/icons-material/Person";
import PhoneIcon from "@mui/icons-material/Phone";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import NotesIcon from "@mui/icons-material/Notes";
import { toast } from "sonner";
import { safeFormatDate } from "@/lib/date";
import { formatMoney, formatNumber } from "@/lib/format";

const SECTION_LABEL = "mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500";

export default function OrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = params.id as string;
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrier, setCarrier] = useState("");

  const fetchOrder = async () => {
    try {
      setIsLoading(true);
      const data = await api.orders.getById(orderId);
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
  }, [orderId]);

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

  if (isLoading || !order) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-36 rounded-full" />
        <Skeleton className="h-20 rounded-2xl" />
        <div className="grid gap-6 md:grid-cols-3">
          <div className="space-y-4 md:col-span-2">
            <Skeleton className="h-44 rounded-2xl" />
            <Skeleton className="h-56 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-72 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-44 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

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
      {/* TOP BAR */}
      <button
        type="button"
        onClick={() => router.push("/orders")}
        className="group inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900 active:scale-[0.97]"
      >
        <ArrowBackIcon
          sx={{ fontSize: 16 }}
          className="transition-transform duration-300 group-hover:-translate-x-0.5"
        />
        Volver a Pedidos
      </button>

      {/* IDENTITY ROW */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className="min-w-0 flex-1">
          <h1 className="font-mono text-2xl font-bold tracking-tight text-slate-900">
            #{order.orderNumber}
          </h1>
          <p className="text-sm text-slate-500">
            Creado el {safeFormatDate(order.createdAt, "PPP")}
          </p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      {/* MAIN GRID */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* LEFT — DETAILS */}
        <div className="space-y-4 md:col-span-2">
          {/* Customer Information */}
          <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <h3 className={SECTION_LABEL}>Información del Cliente</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <DetailRow icon={<PersonIcon sx={{ fontSize: 14 }} />} tint="bg-blue-50 text-blue-600" label="Nombre" value={order.contact?.name || "N/A"} />
              <DetailRow icon={<PhoneIcon sx={{ fontSize: 14 }} />} tint="bg-emerald-50 text-emerald-600" label="Teléfono" value={order.contact?.phone || "N/A"} />
              <DetailRow icon={<EmailIcon sx={{ fontSize: 14 }} />} tint="bg-violet-50 text-violet-600" label="Email" value={order.contact?.email || "N/A"} />
              <DetailRow icon={<LocalOfferIcon sx={{ fontSize: 14 }} />} tint="bg-amber-50 text-amber-600" label="Tipo" value={order.contact?.type || "N/A"} />
            </div>
          </div>

          {/* Products */}
          <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <h3 className={SECTION_LABEL}>Productos</h3>
            {Array.isArray(productsDisplay) ? (
              <div className="space-y-2">
                {productsDisplay.map((product: any, index: number) => (
                  <div
                    key={index}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white px-3 py-2.5 transition-colors duration-150 hover:border-emerald-200 hover:bg-emerald-50/30"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-green-500 to-emerald-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_4px_10px_-2px_rgb(34_197_94/0.45)]">
                        <InventoryIcon sx={{ fontSize: 16 }} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {product.name || product.product}
                        </p>
                        {product.qty && (
                          <p className="text-xs text-slate-500">
                            Cantidad: <span className="font-medium tabular-nums text-slate-700">{product.qty}</span>
                          </p>
                        )}
                      </div>
                    </div>
                    {product.price != null && (
                      <span className="shrink-0 rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold tabular-nums text-emerald-700">
                        ${formatNumber(product.price)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <pre className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50/50 p-3 font-mono text-xs leading-relaxed text-slate-700">
                {typeof productsDisplay === "string"
                  ? productsDisplay
                  : JSON.stringify(productsDisplay, null, 2)}
              </pre>
            )}
          </div>

          {/* Order Details */}
          <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <h3 className={SECTION_LABEL}>Detalles del Pedido</h3>
            <div className="space-y-4">
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Monto Total
                </p>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-green-500 to-emerald-400 px-3 py-1 text-base font-bold tabular-nums text-white shadow-[0_4px_12px_-2px_rgb(34_197_94/0.45)]">
                  {formatMoney(order.amount, order.currency)}
                </span>
              </div>
              {order.notes && (
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Notas
                  </p>
                  <div className="flex gap-2.5 rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                      <NotesIcon sx={{ fontSize: 14 }} />
                    </span>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {order.notes}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT — STATUS & ACTIONS */}
        <div className="space-y-4">
          {/* Status Timeline */}
          <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <h3 className={SECTION_LABEL}>Línea de Tiempo</h3>
            <OrderTimeline
              currentStatus={order.status}
              dispatchedAt={order.dispatchedAt ? new Date(order.dispatchedAt) : null}
              deliveredAt={order.deliveredAt ? new Date(order.deliveredAt) : null}
              createdAt={new Date(order.createdAt)}
            />
          </div>

          {/* Change Status */}
          <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <h3 className={SECTION_LABEL}>Cambiar Estado</h3>
            <Select
              value={order.status}
              onValueChange={(value) => handleStatusChange(value as OrderStatus)}
            >
              <SelectTrigger className="w-full">
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
          </div>

          {/* Tracking */}
          <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <div className="mb-4 flex items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 text-white">
                <LocalShippingIcon sx={{ fontSize: 14 }} />
              </span>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Información de Envío
              </h3>
            </div>
            <div className="space-y-3">
              <div>
                <label htmlFor="trackingNumber" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Número de Tracking
                </label>
                <Input
                  id="trackingNumber"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="ABC123456789"
                />
              </div>
              <div>
                <label htmlFor="carrier" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Transportista
                </label>
                <Input
                  id="carrier"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  placeholder="DHL, FedEx, Correo Argentino..."
                />
              </div>
              <button
                type="button"
                onClick={handleTrackingUpdate}
                disabled={!trackingNumber || !carrier}
                className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-500 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(139_92_246/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(139_92_246/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              >
                Actualizar Tracking
              </button>
              {order.dispatchedAt && (
                <p className="text-[11px] text-slate-500">
                  Despachado: {safeFormatDate(order.dispatchedAt, "PPP")}
                </p>
              )}
            </div>
          </div>

          {/* Order Info */}
          <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <h3 className={SECTION_LABEL}>Información</h3>
            <div className="space-y-2 text-sm">
              <InfoRow label="ID" value={<span className="font-mono text-xs text-slate-700">{order.id.slice(0, 8)}</span>} />
              <InfoRow label="Creado" value={safeFormatDate(order.createdAt, "PP")} />
              <InfoRow label="Actualizado" value={safeFormatDate(order.updatedAt, "PP")} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  tint,
  label,
  value,
}: {
  icon: React.ReactNode;
  tint: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${tint}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="truncate text-sm font-medium text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="truncate text-xs font-medium text-slate-700">{value}</span>
    </div>
  );
}
