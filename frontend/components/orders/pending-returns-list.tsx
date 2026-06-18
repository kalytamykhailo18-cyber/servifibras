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

import { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "@/lib/api/endpoints";
import { toast } from "sonner";
import RefreshIcon from "@mui/icons-material/Refresh";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";

type Row = {
  id: string;
  orderNumber: string;
  contact: { id: string; name: string | null };
  carrier: string | null;
  shippingZone: string | null;
  shippingCost: number | null;
  /** Marcos 2026-06-18 PM: valor del producto (suma de línea). */
  productCost: number | null;
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

  // Marcos 2026-06-18: segmentación por mensajería. La logística es
  // quien tiene que traer el paquete de vuelta — necesita ver
  // separado por carrier cuántos paquetes le falta retornar y por
  // cuánta plata. "Sin mensajería" agrupa devoluciones cargadas sin
  // carrier (caso raro pero pasa) así no se pierden en un grupo
  // vacío. Orden alfabético + "Sin mensajería" al final.
  const grouped = useMemo(() => {
    const map = new Map<string, { rows: Row[]; totalShipping: number; totalProduct: number }>();
    for (const r of rows) {
      const key = (r.carrier ?? '').trim() || 'Sin mensajería';
      if (!map.has(key)) map.set(key, { rows: [], totalShipping: 0, totalProduct: 0 });
      const g = map.get(key)!;
      g.rows.push(r);
      g.totalShipping += typeof r.shippingCost === 'number' ? r.shippingCost : 0;
      g.totalProduct += typeof r.productCost === 'number' ? r.productCost : 0;
    }
    const sorted = Array.from(map.entries()).sort((a, b) => {
      if (a[0] === 'Sin mensajería') return 1;
      if (b[0] === 'Sin mensajería') return -1;
      return a[0].localeCompare(b[0]);
    });
    return sorted;
  }, [rows]);

  const grandTotal = useMemo(() => ({
    count: rows.length,
    shipping: rows.reduce((sum, r) => sum + (typeof r.shippingCost === 'number' ? r.shippingCost : 0), 0),
    product: rows.reduce((sum, r) => sum + (typeof r.productCost === 'number' ? r.productCost : 0), 0),
  }), [rows]);

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
        <div className="space-y-4" data-testid="pending-returns-grouped">
          {/* TOTALES GLOBALES — Marcos 2026-06-18 (+ producto 2026-06-18 PM) */}
          <div
            className="grid gap-2 rounded-xl border border-rose-200/70 bg-gradient-to-r from-rose-50 to-pink-50 px-3 py-2 sm:grid-cols-[1fr_auto] sm:items-center"
            data-testid="pending-returns-grand-total"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-800">
              Total pendientes de regreso
            </span>
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-0.5 text-xs text-rose-900 sm:text-right">
              <span className="text-[10px] uppercase tracking-wider text-rose-600">Paquetes</span>
              <strong className="text-sm tabular-nums">{grandTotal.count}</strong>
              <span className="text-[10px] uppercase tracking-wider text-rose-600">Costo logística</span>
              <strong className="tabular-nums">{fmtArs(grandTotal.shipping)}</strong>
              <span className="text-[10px] uppercase tracking-wider text-rose-600">Costo producto</span>
              <strong
                className="tabular-nums"
                data-testid="pending-returns-grand-total-product"
              >{fmtArs(grandTotal.product)}</strong>
            </div>
          </div>

          {/* SEGMENTOS POR MENSAJERÍA */}
          {grouped.map(([carrier, g]) => (
            <section
              key={carrier}
              data-testid={`pending-returns-group-${carrier}`}
              className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 text-white">
                    <LocalShippingIcon sx={{ fontSize: 14 }} />
                  </span>
                  <span className="text-sm font-semibold text-slate-900">{carrier}</span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-slate-600">
                  <span
                    data-testid={`pending-returns-group-${carrier}-count`}
                    className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full border border-rose-200/70 bg-rose-100 px-1.5 text-rose-700"
                  >
                    {g.rows.length}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px]">
                    logística
                    <strong
                      data-testid={`pending-returns-group-${carrier}-total-shipping`}
                      className="tabular-nums text-slate-800"
                    >
                      {fmtArs(g.totalShipping)}
                    </strong>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-800">
                    producto
                    <strong
                      data-testid={`pending-returns-group-${carrier}-total-product`}
                      className="tabular-nums text-emerald-900"
                    >
                      {fmtArs(g.totalProduct)}
                    </strong>
                  </span>
                </div>
              </div>
              <ul className="space-y-2" data-testid={`pending-returns-rows-${carrier}`}>
                {g.rows.map((r) => (
                  <li
                    key={r.id}
                    data-testid={`pending-returns-row-${r.orderNumber}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-rose-200/70 bg-white p-3 hover:border-rose-300"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        #{r.orderNumber} · {r.contact.name ?? "Cliente"}
                      </p>
                      <p className="truncate text-[11px] text-slate-600">
                        {r.shippingZone ?? 'sin zona'}
                        {' · log '}<span className="tabular-nums">{fmtArs(r.shippingCost)}</span>
                        {' · prod '}<span className="tabular-nums">{fmtArs(r.productCost)}</span>
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
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
