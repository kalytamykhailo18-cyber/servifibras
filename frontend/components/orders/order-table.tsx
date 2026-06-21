"use client";

import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OrderStatusBadge } from "./order-status-badge";
import type { Order } from "@/types";
import { UserRole } from "@/types";
import { useAuthStore } from "@/lib/store/auth-store";
import DeleteIcon from "@mui/icons-material/Delete";
import CancelIcon from "@mui/icons-material/Cancel";
import EditIcon from "@mui/icons-material/Edit";
import InventoryIcon from "@mui/icons-material/Inventory";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import LocalPrintshopIcon from "@mui/icons-material/LocalPrintshop";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { ordersApi } from "@/lib/api/endpoints";
import { toast } from "sonner";
import { safeFormatDistanceToNow } from "@/lib/date";
import { formatMoney } from "@/lib/format";

interface OrderTableProps {
  orders: Order[];
  onEdit: (order: Order) => void;
  onDelete: (order: Order) => void;
  /**
   * Marcos 2026-06-21: cancelar (NO eliminar) un pedido. La pagina
   * padre abre un modal pidiendo motivo y dispara la mutacion. La
   * accion es visible para todos los roles operadores; eliminar
   * queda reservada a ADMIN.
   */
  onCancel: (order: Order) => void;
}

const AVATAR_GRADIENTS = [
  "from-blue-500 to-cyan-400",
  "from-emerald-500 to-teal-400",
  "from-purple-500 to-pink-400",
  "from-orange-500 to-amber-400",
  "from-indigo-500 to-violet-400",
  "from-rose-500 to-pink-400",
];

const initials = (name: string | null | undefined) => {
  if (!name) return "?";
  const parts = name.split(" ").filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
};

const gradientFor = (name: string | null | undefined) =>
  AVATAR_GRADIENTS[(name?.charCodeAt(0) ?? 0) % AVATAR_GRADIENTS.length];

const ADMIN_ONLY_DELETE_TOOLTIP = "Solo Administrador puede eliminar pedidos";

export function OrderTable({ orders, onEdit, onDelete, onCancel }: OrderTableProps) {
  const router = useRouter();
  // Backend matrix: DELETE /admin/orders/:id is ADMIN-only. All other
  // CRUD is open to LOGISTICA/VENTAS/ATENCION at their respective
  // scopes. Mirror that here so non-admins see Eliminar disabled
  // rather than clicking and silently 403-ing.
  const role = useAuthStore((s) => s.user?.role);
  const canDelete = role === UserRole.ADMIN;

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-16 text-center">
        <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-green-100 to-emerald-50 text-green-400">
          <InventoryIcon sx={{ fontSize: 28 }} />
        </span>
        <h3 className="text-base font-semibold text-slate-900">Sin pedidos</h3>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          Crea un nuevo pedido para comenzar.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <Table className="min-w-[820px]">
        <TableHeader>
          <TableRow className="border-b border-slate-200/70 bg-slate-50/50 hover:bg-slate-50/50">
            <TableHead className="h-11 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Número
            </TableHead>
            <TableHead className="h-11 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Cliente
            </TableHead>
            <TableHead className="h-11 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Monto
            </TableHead>
            <TableHead className="h-11 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Estado
            </TableHead>
            <TableHead className="h-11 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Tracking
            </TableHead>
            <TableHead className="h-11 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Creado
            </TableHead>
            <TableHead className="h-11 px-4 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Acciones
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow
              key={order.id}
              className="cursor-pointer border-b border-slate-100 transition-colors duration-150 last:border-b-0 hover:bg-emerald-50/30"
              onClick={() => router.push(`/orders/${order.id}`)}
            >
              <TableCell className="px-4 py-3 font-mono text-sm font-semibold tracking-tight text-slate-900">
                {order.orderNumber}
              </TableCell>

              <TableCell className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br ${gradientFor(order.contact?.name)} text-[11px] font-semibold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_2px_8px_-2px_rgb(15_23_42/0.18)]`}
                  >
                    {initials(order.contact?.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {order.contact?.name || "Sin nombre"}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {order.contact?.phone || order.contact?.email || ""}
                    </p>
                  </div>
                </div>
              </TableCell>

              <TableCell className="px-4 py-3">
                <span className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-400 px-2 py-1 text-xs font-semibold tabular-nums text-white shadow-[0_2px_8px_-2px_rgb(16_185_129/0.45)]">
                  {formatMoney(order.amount, order.currency)}
                </span>
              </TableCell>

              <TableCell className="px-4 py-3">
                <OrderStatusBadge status={order.status} />
              </TableCell>

              <TableCell className="px-4 py-3">
                {order.trackingNumber ? (
                  <div>
                    <p className="font-mono text-xs font-medium text-slate-900">
                      {order.trackingNumber}
                    </p>
                    <p className="text-[11px] text-slate-500">{order.carrier}</p>
                  </div>
                ) : (
                  <span className="text-xs text-slate-400">—</span>
                )}
              </TableCell>

              <TableCell className="px-4 py-3 text-xs text-slate-500">
                <div>{safeFormatDistanceToNow(order.createdAt)}</div>
                {(order as any).createdBy?.name && (
                  <div
                    className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                    title={`Cargado por ${(order as any).createdBy.name}`}
                    data-testid="order-row-created-by"
                  >
                    por {(order as any).createdBy.name}
                  </div>
                )}
              </TableCell>

              <TableCell className="px-4 py-3 text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    onClick={(e) => e.stopPropagation()}
                    render={
                      <button
                        type="button"
                        aria-label="Abrir menú de acciones"
                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900"
                      />
                    }
                  >
                    <MoreVertIcon sx={{ fontSize: 18 }} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-52 overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 p-1.5 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.18)] backdrop-blur-xl backdrop-saturate-150"
                  >
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/orders/${order.id}`);
                      }}
                      className="group cursor-pointer rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 focus:bg-blue-50 focus:text-blue-700"
                    >
                      <span className="mr-2.5 grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-blue-500 to-cyan-400 text-white">
                        <VisibilityIcon sx={{ fontSize: 14 }} />
                      </span>
                      Ver detalles
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(order);
                      }}
                      className="group cursor-pointer rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 focus:bg-amber-50 focus:text-amber-700"
                    >
                      <span className="mr-2.5 grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-amber-500 to-orange-400 text-white">
                        <EditIcon sx={{ fontSize: 14 }} />
                      </span>
                      Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={async (e) => {
                        e.stopPropagation();
                        // Marcos 2026-06-20: avisar al armador si la
                        // etiqueta ya se imprimió. Si ya hay un
                        // labelPrintedAt registrado, le pedimos
                        // confirmación explícita antes de re-emitirla.
                        // Sirve para evitar el caso que Marcos contó —
                        // un paquete volvió de Armados a Pendientes y
                        // el operador re-armó pensando que era nuevo,
                        // sin saber que la etiqueta ya había salido.
                        let status: { printed: boolean; printCount: number; printedAt: string | null } | null = null;
                        try {
                          status = await ordersApi.getEtiquetaStatus(order.id);
                        } catch { /* status es best-effort — no rompe el flow */ }
                        if (status?.printed) {
                          const cuando = status.printedAt
                            ? new Date(status.printedAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
                            : '';
                          const ok = window.confirm(
                            `⚠️ Esta etiqueta ya fue impresa ${status.printCount === 1 ? 'una vez' : `${status.printCount} veces`}`
                            + (cuando ? ` (última: ${cuando}).` : '.')
                            + `\n\nEl pedido posiblemente ya esté armado y despachado. ¿Querés RE-IMPRIMIR la etiqueta?`,
                          );
                          if (!ok) return;
                        }
                        // Marcos 2026-06-17: prompt for bulto count so the
                        // PDF emits N labelled pages (BULTO 1/N, …, N/N).
                        const raw = window.prompt('¿Cuántos bultos para este pedido?', '1');
                        if (raw === null) return;
                        const bultos = parseInt(raw, 10);
                        if (!Number.isFinite(bultos) || bultos < 1 || bultos > 50) {
                          toast.error('Cantidad de bultos inválida (1 a 50)');
                          return;
                        }
                        try {
                          const url = await ordersApi.getEtiquetaBlobUrl(order.id, bultos);
                          window.open(url, '_blank', 'noopener');
                        } catch (err: any) {
                          toast.error(err?.response?.data?.error || 'No se pudo generar la etiqueta');
                        }
                      }}
                      data-testid={`order-row-${order.id}-etiqueta`}
                      className="group cursor-pointer rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 focus:bg-pink-50 focus:text-pink-700"
                    >
                      <span className="mr-2.5 grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-pink-500 to-rose-400 text-white">
                        <LocalPrintshopIcon sx={{ fontSize: 14 }} />
                      </span>
                      Etiqueta envío (10×15)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          const url = await ordersApi.getPdfBlobUrl(order.id);
                          window.open(url, '_blank', 'noopener');
                        } catch (err: any) {
                          toast.error(err?.response?.data?.error || 'No se pudo generar el PDF');
                        }
                      }}
                      data-testid={`order-row-${order.id}-pdf`}
                      className="group cursor-pointer rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 focus:bg-purple-50 focus:text-purple-700"
                    >
                      <span className="mr-2.5 grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-purple-500 to-fuchsia-400 text-white">
                        <PictureAsPdfIcon sx={{ fontSize: 14 }} />
                      </span>
                      Descargar PDF
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="my-1.5 bg-slate-200/70" />
                    {/* Marcos 2026-06-21: cancelar es la accion
                       primaria para operadores. Eliminar se queda
                       reservada a ADMIN. Si el pedido ya esta
                       CANCELLED, el item de cancelar se esconde para
                       no permitir re-cancelar accidentalmente. */}
                    {order.status !== 'CANCELLED' && (
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          onCancel(order);
                        }}
                        data-testid={`order-row-${order.id}-cancel`}
                        className="group cursor-pointer rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 focus:bg-amber-50 focus:text-amber-800"
                      >
                        <span className="mr-2.5 grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-amber-500 to-orange-500 text-white">
                          <CancelIcon sx={{ fontSize: 14 }} />
                        </span>
                        Cancelar pedido
                      </DropdownMenuItem>
                    )}
                    {/* Marcos 2026-06-21: Eliminar solo se renderiza
                       para ADMIN. El operador no debe ver el boton
                       siquiera (antes salia disabled+tooltip; ahora
                       se oculta para evitar confusion). */}
                    {canDelete && (
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(order);
                        }}
                        className="group cursor-pointer rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 focus:bg-red-50 focus:text-red-700"
                      >
                        <span className="mr-2.5 grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-red-500 to-rose-500 text-white">
                          <DeleteIcon sx={{ fontSize: 14 }} />
                        </span>
                        Eliminar
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
