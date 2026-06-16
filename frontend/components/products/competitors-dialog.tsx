"use client";

/**
 * Bloque A item 3 — ML competitor watch-list UI.
 *
 * Marcos 2026-06-12: backend was already serving GET/POST/DELETE
 * /admin/competitors, but there was no operator-visible surface, so
 * during the validation walkthrough this counted as "not in
 * production". This dialog opens from a product row in /products and
 * lets Marcos / Franco paste competing ML item IDs (MLA…), see the
 * live price + stock + sold quantity the backend fetches from
 * `/items/{id}`, and remove the ones that go stale.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, competitorRowId, type CompetitorWatch } from "@/lib/api/endpoints";
import VisibilityIcon from "@mui/icons-material/Visibility";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import LaunchIcon from "@mui/icons-material/Launch";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string | null;
  productName: string | null;
}

function fmtMoney(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  const cur = currency ?? "ARS";
  return `${cur} ${amount.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
}

export function CompetitorsDialog({ open, onOpenChange, productId, productName }: Props) {
  const [watches, setWatches] = useState<CompetitorWatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [itemId, setItemId] = useState("");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (opts?: { force?: boolean }) => {
    if (!productId) return;
    setError(null);
    if (opts?.force) setRefreshing(true); else setLoading(true);
    try {
      const res = await api.competitors.list(productId, opts);
      setWatches(res.watches ?? []);
    } catch (err: any) {
      setError(err?.message ?? "No se pudo cargar la lista");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!open || !productId) return;
    setItemId("");
    setLabel("");
    void load();
  }, [open, productId]);

  const onAdd = async () => {
    if (!productId) return;
    const id = itemId.trim();
    if (!id) { toast.error("Pegá el ID del item"); return; }
    setSubmitting(true);
    try {
      await api.competitors.add({ productId, itemId: id, label: label.trim() || undefined });
      toast.success("Competidor agregado");
      setItemId("");
      setLabel("");
      await load({ force: true });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo agregar");
    } finally {
      setSubmitting(false);
    }
  };

  const onRemove = async (watchId: string) => {
    try {
      await api.competitors.remove(watchId);
      setWatches((prev) => prev.filter((w) => competitorRowId(w) !== watchId));
      toast.success("Competidor eliminado");
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo eliminar");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-200/70 bg-white/95 p-4 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150 sm:max-w-[720px] sm:p-6"
        data-testid="competitors-dialog"
      >
        <DialogHeader className="flex flex-row items-center gap-3 space-y-0">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(245_158_11/0.45)] sm:h-11 sm:w-11">
            <VisibilityIcon sx={{ fontSize: 22 }} />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
              Competidores en ML
            </DialogTitle>
            <DialogDescription className="truncate text-xs text-slate-500 sm:text-sm">
              {productName ?? "Producto"}
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={() => void load({ force: true })}
            disabled={refreshing || loading}
            data-testid="competitors-refresh"
            className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 hover:border-slate-300 disabled:opacity-60"
          >
            <RefreshIcon sx={{ fontSize: 14 }} className={refreshing ? "animate-spin" : ""} />
            Refrescar
          </button>
        </DialogHeader>

        <div className="mt-3 space-y-4">
          {/* Add row */}
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-xl border border-slate-200 bg-slate-50/50 p-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
                MLA item ID <span className="text-orange-600">*</span>
              </label>
              <Input
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                placeholder="MLA1234567890"
                data-testid="competitors-itemid"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Etiqueta (opcional)
              </label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Quién es / por qué"
                data-testid="competitors-label"
              />
            </div>
            <button
              type="button"
              onClick={onAdd}
              disabled={submitting}
              data-testid="competitors-add"
              className="inline-flex h-10 items-center justify-center gap-1 rounded-xl bg-gradient-to-r from-orange-600 to-amber-500 px-4 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(245_158_11/0.5)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-6px_rgb(245_158_11/0.65)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              <AddIcon sx={{ fontSize: 16 }} />
              Agregar
            </button>
          </div>

          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700" data-testid="competitors-error">
              {error}
            </p>
          )}

          {/* List */}
          {loading ? (
            <ul className="space-y-2">
              {[0, 1, 2].map((i) => (
                <li key={i} className="h-16 animate-pulse rounded-xl bg-slate-100/70" />
              ))}
            </ul>
          ) : watches.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/40 px-4 py-6 text-center text-xs text-slate-500" data-testid="competitors-empty">
              Sin competidores cargados. Agregá un MLA item ID arriba.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="competitors-list">
              {watches.map((w) => {
                const rowId = competitorRowId(w);
                return (
                  <li
                    key={rowId || w.itemId}
                    data-testid={`competitor-${w.itemId}`}
                    className="rounded-xl border border-slate-200 bg-white p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1 truncate text-sm font-semibold text-slate-900">
                          <span className="font-mono text-[11px] text-slate-500">{w.itemId}</span>
                          {w.permalink && (
                            <a
                              href={w.permalink}
                              target="_blank"
                              rel="noopener noreferrer"
                              data-testid={`competitor-${w.itemId}-link`}
                              className="inline-flex h-4 w-4 items-center justify-center rounded text-slate-400 hover:text-orange-600"
                              title="Abrir en ML"
                            >
                              <LaunchIcon sx={{ fontSize: 12 }} />
                            </a>
                          )}
                        </p>
                        <p className="truncate text-xs text-slate-700">{w.title ?? w.label ?? "Sin título"}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                          <span className="font-mono">{fmtMoney(w.price ?? null, w.currencyId ?? null)}</span>
                          {w.soldQuantity != null && (
                            <span>· {w.soldQuantity} vendidas</span>
                          )}
                          {w.availableQuantity != null && (
                            <span>· {w.availableQuantity} en stock</span>
                          )}
                          {w.status && (
                            <span className={w.status === 'active' ? "text-emerald-700" : "text-amber-700"}>· {w.status}</span>
                          )}
                          {w.sellerNickname && <span>· {w.sellerNickname}</span>}
                          {w.error && <span className="text-rose-700">· {w.error}</span>}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void onRemove(rowId)}
                        aria-label="Eliminar"
                        data-testid={`competitor-${w.itemId}-remove`}
                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            >
              Cerrar
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
