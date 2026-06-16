"use client";

/**
 * Marcos 2026-06-12: "Pendientes de facturación" list.
 *
 * Manual + TN orders that have been armed but not yet invoiced. Each
 * row has a checkbox: tick → POST /admin/orders/:id/mark-invoiced →
 * row disappears from this list. Un-tick (from elsewhere) walks it
 * back via the same endpoint with `{ invoiced: false }`. Rendered
 * as a side tab on /orders.
 */

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/endpoints";
import { toast } from "sonner";
import RefreshIcon from "@mui/icons-material/Refresh";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

type Row = {
  id: string;
  orderNumber: string;
  contact: { id: string; name: string | null };
  amount: number;
  currency: string;
  sectionOverride: string | null;
  carrier: string | null;
  createdAt: string;
  notes: string | null;
};

function fmtMoney(amount: number, currency: string): string {
  const cur = currency || "ARS";
  return `${cur} ${amount.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
}

export function PendingInvoicingList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.orders.pendingInvoicing();
      setRows(list as Row[]);
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo cargar la lista");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onMark = async (id: string) => {
    setBusy((prev) => ({ ...prev, [id]: true }));
    try {
      await api.orders.markInvoiced(id, true);
      setRows((prev) => prev.filter((r) => r.id !== id));
      toast.success("Pedido marcado como facturado");
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo marcar como facturado");
    } finally {
      setBusy((prev) => ({ ...prev, [id]: false }));
    }
  };

  return (
    <div
      className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
      data-testid="orders-pending-invoicing"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Pendientes de facturación</h3>
          <p className="text-xs text-slate-500">
            Pedidos armados que todavía no fueron facturados. Tildalos a medida que cargás la factura en el CRM.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          data-testid="pending-invoicing-refresh"
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshIcon sx={{ fontSize: 14 }} className={loading ? "animate-spin" : ""} />
          Recargar
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <ul className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="h-12 animate-pulse rounded-xl bg-slate-100/70" />
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <p
          className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-6 text-center text-xs text-slate-500"
          data-testid="pending-invoicing-empty"
        >
          No hay pedidos pendientes de facturación.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="pending-invoicing-rows">
          {rows.map((r) => (
            <li
              key={r.id}
              data-testid={`pending-invoicing-row-${r.orderNumber}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 hover:border-emerald-300"
            >
              <label className="flex flex-1 items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => void onMark(r.id)}
                  disabled={!!busy[r.id]}
                  data-testid={`pending-invoicing-check-${r.orderNumber}`}
                  className="h-5 w-5 cursor-pointer rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    #{r.orderNumber} · {r.contact.name ?? "Cliente"}
                  </p>
                  <p className="truncate text-[11px] text-slate-500">
                    {fmtMoney(r.amount, r.currency)}
                    {r.sectionOverride ? ` · ${r.sectionOverride}` : ''}
                    {r.notes ? ` · ${r.notes.slice(0, 60)}` : ''}
                  </p>
                </div>
              </label>
              {busy[r.id] && (
                <CheckCircleIcon sx={{ fontSize: 18 }} className="animate-pulse text-emerald-500" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
