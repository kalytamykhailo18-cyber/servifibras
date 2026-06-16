"use client";

/**
 * Sidebar panel listing the orders that were registered from this
 * conversation. Refreshes on demand via the `refreshKey` counter the
 * parent bumps after a successful "Registrar pedido" round-trip.
 *
 * Renders nothing while there are no linked orders — keeps the sidebar
 * clean for conversations that never produced a sale.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import { api } from "@/lib/api/endpoints";
import type { OrderWithRelations } from "@/types";

interface Props {
  conversationId: string;
  refreshKey: number;
}

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: "Confirmado",
  PROCESSING: "Procesando",
  DISPATCHED: "Despachado",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
};

const STATUS_TONE: Record<string, string> = {
  CONFIRMED:  "bg-blue-50 text-blue-700 ring-blue-200",
  PROCESSING: "bg-amber-50 text-amber-700 ring-amber-200",
  DISPATCHED: "bg-violet-50 text-violet-700 ring-violet-200",
  DELIVERED:  "bg-emerald-50 text-emerald-700 ring-emerald-200",
  CANCELLED:  "bg-rose-50 text-rose-700 ring-rose-200",
};

function fmtMoney(currency: string | null | undefined, amount: number): string {
  const c = (currency ?? "ARS").toUpperCase();
  const sym = c === "USD" ? "US$ " : "$ ";
  return `${sym}${amount.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ConversationOrdersPanel({ conversationId, refreshKey }: Props) {
  const [orders, setOrders] = useState<OrderWithRelations[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.orders
      .byConversation(conversationId)
      .then((rows) => {
        if (!cancelled) setOrders(rows);
      })
      .catch(() => {
        if (!cancelled) setOrders([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, refreshKey]);

  if (loading) return null;
  if (orders.length === 0) return null;

  return (
    <div
      className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
      data-testid="conversation-orders-panel"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
          <ReceiptLongIcon sx={{ fontSize: 14 }} />
        </span>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Pedidos de esta conversación ({orders.length})
        </h3>
      </div>
      <ul className="space-y-2">
        {orders.map((o) => {
          const tone = STATUS_TONE[o.status] ?? "bg-slate-100 text-slate-700 ring-slate-200";
          const label = STATUS_LABEL[o.status] ?? o.status;
          const itemCount = Array.isArray(o.products) ? o.products.length : 0;
          return (
            <li key={o.id}>
              <Link
                href={`/orders/${o.id}`}
                className="flex items-start justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3 transition-colors hover:border-emerald-300 hover:bg-emerald-50/40"
                data-testid="conversation-order-row"
                data-order-id={o.id}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-slate-900">
                      {o.orderNumber}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${tone}`}
                    >
                      {label}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {itemCount === 0
                      ? "sin productos"
                      : itemCount === 1
                        ? "1 producto"
                        : `${itemCount} productos`}
                    {" · "}
                    {new Date(o.createdAt).toLocaleString("es-AR")}
                  </div>
                </div>
                <span className="shrink-0 self-center font-mono text-sm font-semibold text-slate-900">
                  {fmtMoney(o.currency, o.amount)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
