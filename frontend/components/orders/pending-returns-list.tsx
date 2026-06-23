"use client";

/**
 * Marcos 2026-06-18: "Pendientes de regreso".
 *
 * Originalmente sólo DEVOLUCION rows. Marcos 2026-06-23: ahora también
 * REPOSICION con devolución (toggle CON DEVOLUCION en el form). El
 * panel cierra cada fila con uno de dos botones:
 *   • "Volvió" → POST /admin/orders/:id/mark-returned (reingresa a stock)
 *   • "No volvió / Perdido" → POST /admin/orders/:id/mark-lost
 *      (el valor del producto queda como monto a cobrar al carrier;
 *      la fila queda visible con badge PERDIDO).
 *
 * Para REPOSICION con devolución la mensajería relevante es
 * `returnCarrier` (la que trae el producto de vuelta), no `carrier`
 * (la que llevó la reposición). Agrupamos por la mensajería de retorno.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import { api } from "@/lib/api/endpoints";
import { toast } from "sonner";
import RefreshIcon from "@mui/icons-material/Refresh";
import AssignmentReturnIcon from "@mui/icons-material/AssignmentReturn";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
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

type Row = {
  id: string;
  orderNumber: string;
  orderType: 'SALE' | 'REPOSICION' | 'DEVOLUCION';
  returnState: 'PENDING' | 'LOST';
  contact: { id: string; name: string | null };
  carrier: string | null;
  shippingZone: string | null;
  shippingCost: number | null;
  returnCarrier: string | null;
  returnShippingCost: number | null;
  productCost: number | null;
  productLabel: string | null;
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

// Marcos 2026-06-23: la mensajería responsable del retorno depende del
// orderType. REPOSICION con devolución usa returnCarrier; DEVOLUCION
// pura usa carrier (la única — es la que tenía que traer el paquete).
function carrierFor(r: Row): string | null {
  return r.orderType === 'REPOSICION' ? r.returnCarrier : r.carrier;
}
function shippingFor(r: Row): number | null {
  return r.orderType === 'REPOSICION' ? r.returnShippingCost : r.shippingCost;
}

export function PendingReturnsList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [lostConfirm, setLostConfirm] = useState<Row | null>(null);

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

  const onMarkLost = async (r: Row) => {
    setBusy((prev) => ({ ...prev, [r.id]: true }));
    try {
      await api.orders.markLost(r.id);
      // No filtramos — LOST sigue visible en el mismo panel con badge,
      // para que el operador vea cuánto cobrar a cada mensajería.
      setRows((prev) => prev.map((row) => (row.id === r.id ? { ...row, returnState: 'LOST' as const } : row)));
      const c = carrierFor(r);
      toast.success(c ? `Marcado como perdido — cobrar ${fmtArs(r.productCost)} a ${c}` : 'Marcado como perdido');
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo marcar como perdido");
    } finally {
      setBusy((prev) => ({ ...prev, [r.id]: false }));
      setLostConfirm(null);
    }
  };

  // Marcos 2026-06-18: segmentación por mensajería de retorno.
  const grouped = useMemo(() => {
    const map = new Map<string, { rows: Row[]; totalShipping: number; totalProduct: number; lostCount: number; lostValue: number }>();
    for (const r of rows) {
      const key = (carrierFor(r) ?? '').trim() || 'Sin mensajería';
      if (!map.has(key)) map.set(key, { rows: [], totalShipping: 0, totalProduct: 0, lostCount: 0, lostValue: 0 });
      const g = map.get(key)!;
      g.rows.push(r);
      g.totalShipping += typeof shippingFor(r) === 'number' ? (shippingFor(r) as number) : 0;
      g.totalProduct += typeof r.productCost === 'number' ? r.productCost : 0;
      if (r.returnState === 'LOST') {
        g.lostCount++;
        g.lostValue += typeof r.productCost === 'number' ? r.productCost : 0;
      }
    }
    // Orden: PENDING-only carriers primero, después los que tienen LOST,
    // alfabético dentro de cada grupo. "Sin mensajería" al final.
    const sorted = Array.from(map.entries()).sort((a, b) => {
      if (a[0] === 'Sin mensajería') return 1;
      if (b[0] === 'Sin mensajería') return -1;
      return a[0].localeCompare(b[0]);
    });
    return sorted;
  }, [rows]);

  const grandTotal = useMemo(() => ({
    count: rows.length,
    pending: rows.filter((r) => r.returnState === 'PENDING').length,
    lost: rows.filter((r) => r.returnState === 'LOST').length,
    shipping: rows.reduce((sum, r) => sum + (typeof shippingFor(r) === 'number' ? (shippingFor(r) as number) : 0), 0),
    product: rows.reduce((sum, r) => sum + (typeof r.productCost === 'number' ? r.productCost : 0), 0),
    lostValue: rows.filter((r) => r.returnState === 'LOST').reduce((sum, r) => sum + (typeof r.productCost === 'number' ? r.productCost : 0), 0),
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
              Devoluciones + reposiciones con devolución. "Volvió" reingresa a stock; "No volvió / Perdido" deja el monto a cobrar al courier.
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
          <div
            className="grid gap-2 rounded-xl border border-rose-200/70 bg-gradient-to-r from-rose-50 to-pink-50 px-3 py-2 sm:grid-cols-[1fr_auto] sm:items-center"
            data-testid="pending-returns-grand-total"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-rose-800">
              Total pendientes de regreso
            </span>
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-0.5 text-xs text-rose-900 sm:text-right">
              <span className="text-[10px] uppercase tracking-wider text-rose-600">Paquetes</span>
              <strong className="text-sm tabular-nums">{grandTotal.count}{grandTotal.lost > 0 && ` (${grandTotal.lost} perdidos)`}</strong>
              <span className="text-[10px] uppercase tracking-wider text-rose-600">Costo logística</span>
              <strong className="tabular-nums">{fmtArs(grandTotal.shipping)}</strong>
              <span className="text-[10px] uppercase tracking-wider text-rose-600">Costo producto</span>
              <strong
                className="tabular-nums"
                data-testid="pending-returns-grand-total-product"
              >{fmtArs(grandTotal.product)}</strong>
              {grandTotal.lost > 0 && (
                <>
                  <span className="text-[10px] uppercase tracking-wider text-amber-700">A cobrar (perdidos)</span>
                  <strong
                    className="tabular-nums text-amber-700"
                    data-testid="pending-returns-grand-total-lost"
                  >{fmtArs(grandTotal.lostValue)}</strong>
                </>
              )}
            </div>
          </div>

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
                  {g.lostCount > 0 && (
                    <span
                      data-testid={`pending-returns-group-${carrier}-lost`}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800"
                    >
                      <ReportProblemOutlinedIcon sx={{ fontSize: 11 }} />
                      a cobrar
                      <strong className="tabular-nums text-amber-900">{fmtArs(g.lostValue)}</strong>
                    </span>
                  )}
                </div>
              </div>
              <ul className="space-y-2" data-testid={`pending-returns-rows-${carrier}`}>
                {g.rows.map((r) => {
                  const lost = r.returnState === 'LOST';
                  return (
                  <li
                    key={r.id}
                    data-testid={`pending-returns-row-${r.orderNumber}`}
                    className={
                      "flex items-center justify-between gap-3 rounded-xl border p-3 " +
                      (lost ? "border-amber-300 bg-amber-50/50" : "border-rose-200/70 bg-white hover:border-rose-300")
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        #{r.orderNumber} · {r.contact.name ?? "Cliente"}
                        {r.orderType === 'REPOSICION' && (
                          <span className="ml-2 inline-flex h-4 items-center rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">
                            reposición
                          </span>
                        )}
                        {lost && (
                          <span className="ml-2 inline-flex h-4 items-center gap-0.5 rounded-full bg-amber-600 px-1.5 text-[10px] font-semibold text-white">
                            <ReportProblemOutlinedIcon sx={{ fontSize: 10 }} />
                            PERDIDO
                          </span>
                        )}
                      </p>
                      <p className="truncate text-[11px] text-slate-600">
                        {r.productLabel ? <><span className="font-medium text-slate-800">{r.productLabel}</span>{' · '}</> : null}
                        {r.shippingZone ?? 'sin zona'}
                        {' · log '}<span className="tabular-nums">{fmtArs(shippingFor(r))}</span>
                        {' · prod '}<span className="tabular-nums">{fmtArs(r.productCost)}</span>
                        {' · '}{fmtAge(r.createdAt)}
                        {r.createdBy?.name ? ` · por ${r.createdBy.name}` : ''}
                        {r.notes ? ` · ${r.notes.slice(0, 60)}` : ''}
                      </p>
                    </div>
                    {!lost && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setLostConfirm(r)}
                        disabled={!!busy[r.id]}
                        data-testid={`pending-returns-mark-lost-${r.orderNumber}`}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                        title="La mensajería no trajo el paquete — el valor del producto queda como monto a cobrar al courier"
                      >
                        <ReportProblemOutlinedIcon sx={{ fontSize: 14 }} />
                        No volvió
                      </button>
                      <button
                        type="button"
                        onClick={() => void onMarkReturned(r.id)}
                        disabled={!!busy[r.id]}
                        data-testid={`pending-returns-mark-${r.orderNumber}`}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {busy[r.id] ? 'Guardando…' : 'Volvió'}
                      </button>
                    </div>
                    )}
                  </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <AlertDialog open={!!lostConfirm} onOpenChange={(open) => { if (!open) setLostConfirm(null); }}>
        <AlertDialogContent
          data-testid="pending-returns-lost-dialog"
          className="rounded-2xl border border-amber-200/70 bg-white/95 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150"
        >
          <AlertDialogHeader className="space-y-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(245_158_11/0.45)]">
              <ReportProblemOutlinedIcon sx={{ fontSize: 22 }} />
            </span>
            <AlertDialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              ¿Marcar como perdido?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-slate-600">
              {lostConfirm && (
                <>
                  La mensajería <strong className="text-slate-900">{carrierFor(lostConfirm) ?? 'asignada'}</strong> no
                  trajo el paquete del pedido <strong className="text-slate-900">{lostConfirm.orderNumber}</strong>.
                  El valor del producto (<strong className="text-amber-700">{fmtArs(lostConfirm.productCost)}</strong>)
                  queda registrado como monto a cobrar al courier. La fila se mantiene visible con badge PERDIDO.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="pending-returns-lost-confirm"
              onClick={() => { if (lostConfirm) void onMarkLost(lostConfirm); }}
              className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
            >
              Sí, perdido
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
