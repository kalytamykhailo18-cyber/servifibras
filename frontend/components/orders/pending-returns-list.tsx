"use client";

/**
 * Marcos 2026-06-18: "Pendientes de regreso".
 *
 * DEVOLUCION rows — the courier (Andreani, JyJ, Baires, M2…) was
 * asked to pick up the wrong package from the buyer. The row stays
 * here until the operator confirms the package physically came back
 * (button "Volvió" → POST /admin/orders/:id/mark-returned). This
 * surface exists precisely so packages don't get silently lost in
 * the courier's network — every devolución has an open ticket until
 * it's closed by hand.
 */

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api/endpoints";
import { toast } from "sonner";
import RefreshIcon from "@mui/icons-material/Refresh";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";

type Row = {
  id: string;
  orderNumber: string;
  contact: { id: string; name: string | null };
  carrier: string | null;
  shippingZone: string | null;
  shippingCost: number | null;
  notes: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
};

function fmtAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86400_000);
  if (days >= 1) return `hace ${days} día${days === 1 ? '' : 's'}`;
  const hrs = Math.floor(diffMs / 3600_000);
  return `hace ${hrs}h`;
}

function fmtArs(n: number | null): string {
  if (n == null) return '—';
  return `ARS ${Math.round(n).toLocaleString('es-AR')}`;
}

export function PendingReturnsList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.orders.pendingReturns();
      setRows(list as Row[]);
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo cargar la lista de devoluciones");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onMarkReturned = async (id: string) => {
    setBusy((prev) => ({ ...prev, [id]: true }));
    try {
      await api.orders.markReturned(id, true);
      setRows((prev) => prev.filter((r) => r.id !== id));
      toast.success("Devolución cerrada — volvió el paquete");
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo marcar como vuelta");
    } finally {
      setBusy((prev) => ({ ...prev, [id]: false }));
    }
  };

  return (
    <div
      className="rounded-2xl border border-rose-200/70 bg-white p-4 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
      data-testid="orders-pending-returns"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-rose-500 to-pink-500 text-white">
            <AssignmentReturnIcon sx={{ fontSize: 18 }} />
          </span>
          <div>
            <h3 className="text-base font-semibold text-slate-900">Pendientes de regreso</h3>
            <p className="text-xs text-slate-500">
              Devoluciones que la mensajería tiene que traer de vuelta. Tildá "Volvió" cuando el paquete llegue al galpón.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          data-testid="pending-returns-refresh"
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshIcon sx={{ fontSize: 14 }} className={loading ? "animate-spin" : ""} />
          Recargar
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <ul className="space-y-2">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-14 animate-pulse rounded-xl bg-slate-100/70" />
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <p
          className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-6 text-center text-xs text-slate-500"
          data-testid="pending-returns-empty"
        >
          No hay devoluciones pendientes de regreso.
        </p>
      ) : (
        <ul className="space-y-2" data-testid="pending-returns-rows">
          {rows.map((r) => (
            <li
              key={r.id}
              data-testid={`pending-returns-row-${r.orderNumber}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-rose-200/70 bg-rose-50/30 p-3 hover:border-rose-300"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">
                  #{r.orderNumber} · {r.contact.name ?? "Cliente"}
                </p>
                <p className="truncate text-[11px] text-slate-600">
                  {r.carrier ? `${r.carrier} · ${r.shippingZone ?? 'sin zona'} · ${fmtArs(r.shippingCost)}` : 'sin mensajería asignada'}
                  {' · '}{fmtAge(r.createdAt)}
                  {r.createdBy?.name ? ` · por ${r.createdBy.name}` : ''}
                  {r.notes ? ` · ${r.notes.slice(0, 60)}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onMarkReturned(r.id)}
                disabled={!!busy[r.id]}
                data-testid={`pending-returns-mark-${r.orderNumber}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {busy[r.id] ? 'Guardando…' : 'Volvió'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
