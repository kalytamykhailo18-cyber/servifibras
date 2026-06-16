"use client";

/**
 * Bloque B item 5 — Marcos 2026-06-08 ask: click-detail. From any
 * per-source cell on the ventas unificadas card, this dialog opens
 * with the underlying order list (newest first), so the operator
 * goes "ventas hoy 246" → "show me which 246" in one click.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api/endpoints";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import { safeFormatDate } from "@/lib/date";

type Range = "today" | "week" | "month";
type Source = "ML_CUENTA_1" | "ML_CUENTA_2" | "TIENDANUBE" | "MANUAL";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  range: Range;
  source: Source | null;
}

interface OrderRow {
  id: string;
  orderNumber: string;
  createdAt: string;
  customerName: string | null;
  amount: number;
  currency: string;
  carrier: string | null;
  itemsCount: number;
  itemsSummary: string;
}

const RANGE_LABEL: Record<Range, string> = {
  today: "Hoy",
  week: "Últimos 7 días",
  month: "Últimos 30 días",
};

export function VentasDetailDialog({ open, onOpenChange, range, source }: Props) {
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [label, setLabel] = useState<string>("");
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!source) return;
    setLoading(true);
    setError(null);
    try {
      const d = await api.analytics.getVentasUnificadasDetail(range, source);
      setRows(d.orders);
      setLabel(d.label);
      setTruncated(d.truncated);
    } catch (err: any) {
      setError(err?.message || "No se pudo cargar el detalle");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && source) void load();
    if (!open) {
      setRows(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source, range]);

  const totalAmount = (rows ?? []).reduce((s, r) => s + r.amount, 0);
  const currencies = Array.from(new Set((rows ?? []).map((r) => r.currency)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-200/70 bg-white/95 p-5 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150 sm:max-w-[840px]"
        data-testid="ventas-detail-dialog"
      >
        <DialogHeader className="mb-3 flex flex-row items-start gap-3 space-y-0">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              {label || "Detalle de ventas"}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              {RANGE_LABEL[range]} ·{" "}
              {rows ? (
                <>
                  <span className="font-semibold tabular-nums">{rows.length}</span>{" "}
                  venta{rows.length === 1 ? "" : "s"}
                  {currencies.length === 1
                    ? ` · ${currencies[0]} ${totalAmount.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`
                    : ""}
                  {truncated && (
                    <span className="ml-2 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                      mostrando primeras {rows.length}
                    </span>
                  )}
                </>
              ) : (
                "cargando…"
              )}
            </DialogDescription>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-60"
              aria-label="Refrescar"
              data-testid="ventas-detail-refresh"
            >
              <RefreshIcon sx={{ fontSize: 16 }} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Cerrar"
            >
              <CloseIcon sx={{ fontSize: 18 }} />
            </button>
          </div>
        </DialogHeader>

        {error && <p className="text-xs text-rose-600">{error}</p>}

        {!rows && !error && (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100/70" />
            ))}
          </div>
        )}

        {rows && rows.length === 0 && (
          <p className="text-xs text-slate-500">Sin ventas en este período.</p>
        )}

        {rows && rows.length > 0 && (
          <ul className="space-y-1.5" data-testid="ventas-detail-list">
            {rows.map((r) => (
              <li
                key={r.id}
                data-testid="ventas-detail-row"
                className="grid grid-cols-[100px_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2"
              >
                <div className="text-[10px] text-slate-500">
                  <p className="font-mono">{r.orderNumber}</p>
                  <p>{safeFormatDate(r.createdAt, "dd/MM HH:mm")}</p>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {r.customerName ?? "—"}
                  </p>
                  {r.carrier && (
                    <p className="truncate text-[10px] text-slate-400">{r.carrier}</p>
                  )}
                </div>
                <p className="truncate text-[11px] text-slate-600" title={r.itemsSummary}>
                  {r.itemsSummary || `${r.itemsCount} item${r.itemsCount === 1 ? "" : "s"}`}
                </p>
                <p className="text-right tabular-nums text-sm font-semibold text-slate-800">
                  {r.currency} {r.amount.toLocaleString("es-AR", { maximumFractionDigits: 0 })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
