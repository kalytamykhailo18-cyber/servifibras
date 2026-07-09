"use client";

import React, { useEffect, useState } from "react";
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
import { OrderStatus, ORDER_STATUS_LABELS, UserRole } from "@/types";
import { useRoleGuard } from "@/lib/hooks/use-role-guard";
import { useAuthStore } from "@/lib/store/auth-store";

// Backend matrix for /admin/orders/:id:
//   GET  → ADMIN + LOGISTICA + VENTAS  (VENTAS reads orders linked to its leads/quotes)
//   PUT  /:id/status   → ADMIN + LOGISTICA
//   PUT  /:id/tracking → ADMIN + LOGISTICA
//   DELETE             → ADMIN only
// So we open the route to VENTAS but disable status/tracking writes for them.
// Marcos 2026-06-23: ENCARGADO supervisa logística — incluido explícito.
// Marcos 2026-07-08: ATENCION crea pedidos desde el hilo y salta al
// detalle recién guardado. Sin este rol el detalle la rebota a "no
// autorizado" (write-actions siguen con su propio gate abajo).
const ORDERS_DETAIL_ROLES = [UserRole.ADMIN, UserRole.LOGISTICA, UserRole.VENTAS, UserRole.ENCARGADO, UserRole.ATENCION];
const ORDERS_ROLES = ORDERS_DETAIL_ROLES;
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import EmailIcon from "@mui/icons-material/Email";
import InventoryIcon from "@mui/icons-material/Inventory";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import PersonIcon from "@mui/icons-material/Person";
import PhoneIcon from "@mui/icons-material/Phone";
import LocalOfferIcon from "@mui/icons-material/LocalOffer";
import NotesIcon from "@mui/icons-material/Notes";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import CancelIcon from "@mui/icons-material/Cancel";
import { OrderFormDialog } from "@/components/orders/order-form-dialog";
import { toast } from "sonner";
import { safeFormatDate } from "@/lib/date";
import { formatMoney, formatNumber } from "@/lib/format";

const SECTION_LABEL = "mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500";

export default function OrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { isAllowed } = useRoleGuard(ORDERS_ROLES);
  const role = useAuthStore((s) => s.user?.role);
  // VENTAS can read this page (they may have created the order from a quote)
  // but cannot change status or tracking — those are LOGISTICA's
  // responsibility per the backend matrix. Marcos 2026-06-23: ENCARGADO
  // es supervisor de Logística y necesita las mismas acciones que LOGISTICA
  // sobre pedidos (cambiar estado, cargar tracking, marcar facturado).
  const canChangeStatus =
    role === UserRole.ADMIN || role === UserRole.LOGISTICA || role === UserRole.ENCARGADO;
  const canEditTracking = canChangeStatus;
  const orderId = params.id as string;
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrier, setCarrier] = useState("");
  // Marcos 2026-06-18: dispara el formulario de devolución pre-cargado
  // con los datos de este pedido — el operador no re-tipea nada,
  // sólo confirma y crea la fila DEVOLUCION.
  const [devolucionOpen, setDevolucionOpen] = useState(false);

  // Initial load — shows skeleton on first render of the page.
  const loadOrder = async () => {
    try {
      setIsLoading(true);
      const data = await api.orders.getById(orderId);
      // The backend returns HTTP 200 with `{ success:false, error:"Order
      // not found" }` for missing rows (legacy contract — the rest of the
      // codebase relies on it). The axios interceptor only auto-unwraps
      // shapes with exactly `{success, data}`, so the error body lands in
      // `data` as-is. Detect that and redirect instead of trying to render
      // a non-Order object, which crashes on the first `.id.slice(...)`.
      if (!data || !(data as any).id) {
        toast.error((data as any)?.error || "Pedido no encontrado");
        router.push("/orders");
        return;
      }
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

  // Silent refresh — used after mutations. No skeleton flash; the existing
  // page stays mounted while we sync any server-derived fields the
  // optimistic update may have missed (e.g. dispatchedAt, deliveredAt
  // timestamps that the backend stamps on status transitions).
  const refreshOrder = async () => {
    try {
      const data = await api.orders.getById(orderId);
      // Same defensive guard as loadOrder — a server tick that returns
      // success:false (e.g. order was deleted in another tab) shouldn't
      // overwrite the in-memory order with a malformed object.
      if (!data || !(data as any).id) return;
      setOrder(data);
      if (data.trackingNumber && !trackingNumber) setTrackingNumber(data.trackingNumber);
      if (data.carrier && !carrier) setCarrier(data.carrier);
    } catch (error: any) {
      toast.error(error.message || "Error al recargar pedido");
    }
  };

  useEffect(() => {
    if (isAllowed) loadOrder();
  }, [orderId, isAllowed]);

  if (!isAllowed) return null;

  const handleStatusChange = async (status: OrderStatus) => {
    if (!order) return;
    // Optimistic update so the status pill flips immediately. The silent
    // refresh below reconciles any server-derived fields (dispatchedAt /
    // deliveredAt timestamps the backend may stamp). On error we revert
    // by re-reading from the server.
    const previous = order;
    setOrder({ ...order, status });
    try {
      await api.orders.updateStatus(order.id, { status });
      toast.success("Estado actualizado correctamente");
      void refreshOrder();
    } catch (error: any) {
      setOrder(previous);
      toast.error(error.message || "Error al actualizar estado");
    }
  };

  const handleTrackingUpdate = async () => {
    if (!order || !trackingNumber || !carrier) {
      toast.error("Completa el número de tracking y transportista");
      return;
    }
    const previous = order;
    setOrder({ ...order, trackingNumber, carrier });
    try {
      await api.orders.updateTracking(order.id, { trackingNumber, carrier });
      toast.success("Información de tracking actualizada");
      void refreshOrder();
    } catch (error: any) {
      setOrder(previous);
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

  // Marcos 2026-06-18: la solapa "Registrar devolución" sale para
  // pedidos ya entregados que el comprador rechazó o cuya entrega
  // falló. Filtramos para no ofrecerla sobre reposiciones / devoluciones
  // existentes (no tiene sentido devolver una devolución).
  const canRegisterDevolucion =
    canChangeStatus
    && order
    && (order as any).orderType !== 'DEVOLUCION'
    && (order as any).orderType !== 'REPOSICION';

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* TOP BAR */}
      <div className="flex flex-wrap items-center justify-between gap-2">
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

        {canRegisterDevolucion && (
          <button
            type="button"
            onClick={() => setDevolucionOpen(true)}
            data-testid="order-register-devolucion"
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-700 hover:border-rose-300 hover:bg-rose-100 transition"
          >
            <AssignmentReturnIcon sx={{ fontSize: 16 }} />
            Registrar devolución de este pedido
          </button>
        )}
      </div>

      {/* IDENTITY ROW */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className="min-w-0 flex-1">
          <h1 className="font-mono text-lg font-bold tracking-tight sm:text-2xl text-slate-900">
            #{order.orderNumber}
          </h1>
          <p className="text-sm text-slate-500">
            Creado el {safeFormatDate(order.createdAt, "PPP")}
          </p>
          {order.conversationId && (
            <a
              href={`/conversations/${order.conversationId}`}
              data-testid="order-conversation-backlink"
              className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-cyan-50 px-2 py-0.5 text-[11px] font-medium text-cyan-700 ring-1 ring-inset ring-cyan-200 transition-colors hover:bg-cyan-100"
            >
              <ChatBubbleOutlineIcon sx={{ fontSize: 12 }} />
              Ver conversación origen
            </a>
          )}
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      {/* Marcos 2026-06-21: banner de cancelación con audit completo
         cuando el pedido está cancelado por accion del operador
         (cancelledAt populated). Si está cancelado por TN-sync u otra
         fuente sin audit, el banner igual marca el estado pero sin
         los campos opcionales. */}
      {order.status === 'CANCELLED' && (order.cancelledAt || order.cancellationReason) && (
        <div
          data-testid="order-cancelled-banner"
          className="rounded-2xl border border-rose-200/70 bg-rose-50/60 p-4 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
        >
          <div className="mb-1 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-rose-600 text-white">
              <CancelIcon sx={{ fontSize: 14 }} />
            </span>
            <h4 className="text-sm font-semibold text-rose-900">Pedido cancelado</h4>
            <span className="ml-auto text-[11px] text-rose-700">
              {order.cancelledAt ? safeFormatDate(order.cancelledAt, "PPP p") : ''}
              {order.cancelledBy?.name ? ` · por ${order.cancelledBy.name}` : ''}
            </span>
          </div>
          {order.cancellationReason && (
            <p className="rounded-lg bg-white/60 px-3 py-2 text-xs leading-relaxed text-rose-950">
              <span className="font-semibold">Motivo:</span> {order.cancellationReason}
            </p>
          )}
        </div>
      )}

      {/* Marcos 2026-06-21: trazabilidad de quien dio de alta el
         pedido (cuando vino por el flow MANUAL — TN/ML sync no
         tienen createdBy). Pill chiquito para no saturar el header.
         Marcos 2026-06-25: junto al "Cargado por", el "Armado por"
         para tener trazabilidad operador → pedido. Si un cliente
         reclama, en el detail del pedido se ve quién lo cargó y
         quién lo armó/pasó a Listas. */}
      <div className="flex flex-wrap items-center gap-2">
        {order.createdBy?.name && (
          <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <PersonIcon sx={{ fontSize: 12 }} className="text-emerald-600" />
            Cargado por <span className="font-semibold text-slate-900">{order.createdBy.name}</span>
          </div>
        )}
        {(order as any).armadoInfo?.armadoBy?.name && (
          <div
            data-testid="order-armado-by"
            className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
            title={(() => {
              const a = (order as any).armadoInfo;
              const parts: string[] = [`Estado: ${a.state}`];
              if (a.armadoAt) parts.push(`Armado: ${safeFormatDate(a.armadoAt, 'dd/MM/yy HH:mm')}`);
              if (a.listoAt) parts.push(`Listo: ${safeFormatDate(a.listoAt, 'dd/MM/yy HH:mm')}`);
              if (a.flexCourier) parts.push(`Courier: ${a.flexCourier}`);
              if (a.itemsExpected) parts.push(`Items: ${a.itemsChecked}/${a.itemsExpected}`);
              return parts.join(' · ');
            })()}
          >
            <PersonIcon sx={{ fontSize: 12 }} className="text-violet-600" />
            Armado por <span className="font-semibold text-violet-900">{(order as any).armadoInfo.armadoBy.name}</span>
            {(order as any).armadoInfo?.flexCourier && (
              <span className="ml-1 text-[10px] text-violet-600/80">→ {(order as any).armadoInfo.flexCourier}</span>
            )}
          </div>
        )}
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

          {/* Marcos 2026-07-03: bloque "Datos de la reposición" para
              REPOSICION — mensajería + zona + costo de ida, responsable,
              motivo del error, producto/valor, y (si hay devolución)
              mensajería + costo del retorno. Total al final. Sólo se
              renderiza cuando orderType es REPOSICION. */}
          {(order as any).orderType === 'REPOSICION' && (
            <div
              className="rounded-2xl border border-amber-300/70 bg-amber-50/40 p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
              data-testid="order-detail-reposicion-block"
            >
              <h3 className={SECTION_LABEL}>Datos de la reposición</h3>
              {(() => {
                const REASON_LABELS: Record<string, string> = {
                  PRODUCTO_EQUIVOCADO: 'Producto equivocado',
                  PRODUCTO_FALTANTE: 'Producto faltante',
                  ROTO_MAL_EMBALADO: 'Roto / mal embalado',
                  DIRECCION_MAL_CARGADA: 'Dirección mal cargada',
                  OTRO: 'Otro',
                };
                const o: any = order;
                const ida = typeof o.shippingCost === 'number' ? o.shippingCost : 0;
                const retorno = typeof o.returnShippingCost === 'number' ? o.returnShippingCost : 0;
                const valor =
                  o.returnState === 'NONE' && typeof o.productValue === 'number' ? o.productValue : 0;
                const totalRep = ida + retorno + valor;
                const withReturn = o.returnState && o.returnState !== 'NONE';
                const reasonLabel = o.errorReason ? REASON_LABELS[o.errorReason] ?? o.errorReason : null;
                const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
                  <div className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-amber-900/80">
                      {label}
                    </span>
                    <span className="text-sm text-slate-800">{value ?? <span className="text-slate-400">—</span>}</span>
                  </div>
                );
                return (
                  <div className="divide-y divide-amber-200/60">
                    <Row label="Responsable del error" value={o.responsible?.name ?? null} />
                    <Row
                      label="Motivo del error"
                      value={
                        reasonLabel ? (
                          <>
                            {reasonLabel}
                            {o.errorReason === 'OTRO' && o.errorReasonNote && (
                              <span className="ml-1 text-slate-500">— {o.errorReasonNote}</span>
                            )}
                          </>
                        ) : null
                      }
                    />
                    <Row label="Mensajería (ida)" value={o.carrier ?? null} />
                    <Row label="Zona" value={o.shippingZone ?? null} />
                    <Row
                      label="Costo logística de ida"
                      value={ida > 0 ? formatMoney(ida, order.currency) : null}
                    />
                    <Row label="Producto involucrado" value={o.productLabel ?? null} />
                    <Row
                      label="Valor del paquete"
                      value={typeof o.productValue === 'number' && o.productValue > 0 ? formatMoney(o.productValue, order.currency) : null}
                    />
                    {withReturn ? (
                      <>
                        <Row label="Mensajería del retorno" value={o.returnCarrier ?? null} />
                        <Row
                          label="Costo del retorno"
                          value={retorno > 0 ? formatMoney(retorno, order.currency) : null}
                        />
                      </>
                    ) : (
                      <Row label="Retorno" value={<span className="text-slate-500">Sin devolución</span>} />
                    )}
                    <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-amber-300/70 pt-3">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-900">
                        Costo total de la reposición
                      </span>
                      <span className="inline-flex items-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-400 px-3 py-1 text-sm font-bold tabular-nums text-white shadow-[0_4px_12px_-2px_rgb(245_158_11/0.45)]" data-testid="order-detail-reposicion-total">
                        {formatMoney(totalRep, order.currency)}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

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
          <div
            className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
            title={canChangeStatus ? undefined : "Solo Administrador o Logística pueden cambiar el estado de un pedido"}
          >
            <h3 className={SECTION_LABEL}>
              Cambiar Estado
              {!canChangeStatus && (
                <span className="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-slate-500">
                  Solo Logística
                </span>
              )}
            </h3>
            <Select
              value={order.status}
              onValueChange={(value) => canChangeStatus && handleStatusChange(value as OrderStatus)}
              disabled={!canChangeStatus}
            >
              <SelectTrigger className="w-full" disabled={!canChangeStatus}>
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
          <div
            className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
            title={canEditTracking ? undefined : "Solo Administrador o Logística pueden actualizar el envío"}
          >
            <div className="mb-4 flex items-center gap-2">
              <span className={
                "grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white " +
                (canEditTracking ? "bg-gradient-to-br from-violet-500 to-purple-500" : "bg-slate-300")
              }>
                <LocalShippingIcon sx={{ fontSize: 14 }} />
              </span>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Información de Envío
                {!canEditTracking && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-slate-500">
                    Solo Logística
                  </span>
                )}
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
                  disabled={!canEditTracking}
                  readOnly={!canEditTracking}
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
                  disabled={!canEditTracking}
                  readOnly={!canEditTracking}
                />
              </div>
              <button
                type="button"
                onClick={canEditTracking ? handleTrackingUpdate : undefined}
                disabled={!canEditTracking || !trackingNumber || !carrier}
                className={
                  "inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-medium text-white transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 " +
                  (canEditTracking
                    ? "bg-gradient-to-r from-violet-600 to-purple-500 shadow-[0_8px_20px_-6px_rgb(139_92_246/0.5)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(139_92_246/0.65)]"
                    : "bg-slate-300")
                }
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

      {/* Devolución pre-cargada — Marcos 2026-06-18 */}
      {order && (
        <OrderFormDialog
          open={devolucionOpen}
          onOpenChange={setDevolucionOpen}
          seedFromOrder={order}
          initialModeOverride="DEVOLUCION"
          onSuccess={() => {
            setDevolucionOpen(false);
            toast.success("Devolución registrada — la encontrás en Pendientes de regreso");
          }}
        />
      )}
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
