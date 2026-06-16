"use client";

/**
 * Marcos 2026-06-12: dispatch history grouped by mensajería.
 *
 * Use case Marcos described: when a package gets lost he needs to
 * pull which courier had it; he also pays couriers per package so
 * he wants weekly / quincenal / monthly counts at a glance. Card
 * lives under /analytics → "Métricas generales" (admin + logística).
 *
 * Presets snap the range without typing dates. The carrier list
 * sorts by count desc; clicking a carrier expands to the underlying
 * order rows so Marcos can drill straight from "Andreani: 89" to
 * "TN-14159 / Silvina Solange Estevez / 30.939".
 */

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api/endpoints";
import LocalShippingIcon from "@mui/icons-material/LocalShipping";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import RefreshIcon from "@mui/icons-material/Refresh";

type Preset = 'semana' | 'quincena' | 'mes' | 'custom';

function isoOf(d: Date): string {
  return d.toISOString();
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function presetRange(p: Exclude<Preset, 'custom'>): { from: Date; to: Date } {
  const now = new Date();
  const to = now;
  const days = p === 'semana' ? 7 : p === 'quincena' ? 15 : 30;
  const from = startOfDay(new Date(now.getTime() - (days - 1) * 86400000));
  return { from, to };
}
function fmtMoney(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  const c = currency ?? "ARS";
  return `${c} ${amount.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
}
function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
  } catch { return iso.slice(0, 10); }
}
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function DispatchStatsCard() {
  const [preset, setPreset] = useState<Preset>('semana');
  const [customFrom, setCustomFrom] = useState<string>(toLocalInput(presetRange('semana').from));
  const [customTo, setCustomTo] = useState<string>(toLocalInput(new Date()));
  const [data, setData] = useState<Awaited<ReturnType<typeof api.analytics.getDispatchStats>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const range = useMemo(() => {
    if (preset === 'custom') {
      const from = new Date(`${customFrom}T00:00:00`);
      const to = new Date(`${customTo}T23:59:59.999`);
      return { from, to };
    }
    return presetRange(preset);
  }, [preset, customFrom, customTo]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.analytics.getDispatchStats({ from: isoOf(range.from), to: isoOf(range.to) });
      setData(res);
    } catch (err: any) {
      setError(err?.message ?? "No se pudieron cargar las estadísticas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [preset, customFrom, customTo]);

  return (
    <div
      data-testid="dispatch-stats-card"
      className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LocalShippingIcon sx={{ fontSize: 20 }} className="text-amber-600" />
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Despachos por mensajería
          </h3>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          data-testid="dispatch-stats-refresh"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-medium text-slate-600 hover:border-slate-300 disabled:opacity-60"
        >
          <RefreshIcon sx={{ fontSize: 12 }} className={loading ? "animate-spin" : ""} />
          {loading ? "…" : "Refrescar"}
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="dispatch-stats-presets">
        {([
          { id: 'semana' as const,    label: 'Última semana' },
          { id: 'quincena' as const,  label: 'Quincena' },
          { id: 'mes' as const,       label: 'Último mes' },
          { id: 'custom' as const,    label: 'Personalizado' },
        ]).map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPreset(p.id)}
            data-testid={`dispatch-stats-preset-${p.id}`}
            aria-pressed={preset === p.id}
            className={
              "inline-flex h-7 items-center rounded-full border px-3 text-[11px] font-medium transition-colors " +
              (preset === p.id
                ? "border-amber-400 bg-amber-50 text-amber-800"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <label className="inline-flex items-center gap-1.5">
            Desde
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              data-testid="dispatch-stats-from"
              className="h-7 rounded-md border border-slate-200 px-2 text-xs"
            />
          </label>
          <label className="inline-flex items-center gap-1.5">
            Hasta
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              data-testid="dispatch-stats-to"
              className="h-7 rounded-md border border-slate-200 px-2 text-xs"
            />
          </label>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
      )}

      {!data && !error && (
        <ul className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="h-10 animate-pulse rounded-xl bg-slate-100/70" />
          ))}
        </ul>
      )}

      {data && (
        <div className="space-y-3">
          <div className="rounded-xl bg-amber-600 px-4 py-3 text-white shadow-sm">
            <p className="text-[10px] uppercase tracking-wider opacity-80">
              {fmtDate(data.fromIso)} – {fmtDate(data.toIso)}
            </p>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <p className="font-mono text-lg font-semibold" data-testid="dispatch-stats-total">
                {data.total} paquete{data.total === 1 ? '' : 's'} despachado{data.total === 1 ? '' : 's'}
              </p>
              {data.totalShippingCost > 0 && (
                <p className="font-mono text-base font-semibold" data-testid="dispatch-stats-total-cost">
                  Cobrado ARS {Math.round(data.totalShippingCost).toLocaleString("es-AR")}
                </p>
              )}
              {data.totalEstimatedCost != null && (
                <p className="font-mono text-base font-semibold opacity-95" data-testid="dispatch-stats-total-estimated">
                  Estimado ARS {Math.round(data.totalEstimatedCost).toLocaleString("es-AR")}
                </p>
              )}
            </div>
            <p className="text-[11px] opacity-90">
              {data.byCarrier.length} mensajería{data.byCarrier.length === 1 ? '' : 's'}
              {data.totalShippingCost > 0 ? ' · cobrado al cliente (TN/ML)' : ''}
              {data.totalEstimatedCost != null ? ' · estimado a pagar al courier (tarifas)' : ''}
              {data.rowsWithoutTariff > 0 ? ` · ${data.rowsWithoutTariff} fila${data.rowsWithoutTariff === 1 ? '' : 's'} sin tarifa cargada` : ''}
            </p>
          </div>

          {data.byCarrier.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-6 text-center text-xs text-slate-500" data-testid="dispatch-stats-empty">
              No hay despachos en este rango.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="dispatch-stats-carriers">
              {data.byCarrier.map((c) => {
                const isOpen = expanded === c.carrier;
                return (
                  <li
                    key={c.carrier}
                    data-testid={`dispatch-stats-carrier-${c.carrier.replace(/\s+/g, '-')}`}
                    className="rounded-xl border border-slate-200 bg-white"
                  >
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : c.carrier)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-slate-50"
                    >
                      <span className="flex items-center gap-2">
                        {isOpen
                          ? <ExpandMoreIcon sx={{ fontSize: 16 }} className="text-slate-500" />
                          : <ChevronRightIcon sx={{ fontSize: 16 }} className="text-slate-400" />}
                        <span className="text-sm font-semibold text-slate-900">{c.carrier}</span>
                      </span>
                      <span className="flex items-baseline gap-3 font-mono text-sm tabular-nums">
                        {c.totalShippingCost > 0 && (
                          <span className="text-[12px] text-amber-700" title="Cobrado al cliente (TN/ML)" data-testid={`dispatch-stats-carrier-cost-${c.carrier.replace(/\s+/g, '-')}`}>
                            ARS {Math.round(c.totalShippingCost).toLocaleString("es-AR")}
                          </span>
                        )}
                        {c.totalEstimatedCost != null && (
                          <span className="text-[12px] text-emerald-700" title="Estimado a pagar al courier (tarifas)" data-testid={`dispatch-stats-carrier-estimated-${c.carrier.replace(/\s+/g, '-')}`}>
                            ~ARS {Math.round(c.totalEstimatedCost).toLocaleString("es-AR")}
                          </span>
                        )}
                        <span className="text-slate-700">{c.count}</span>
                      </span>
                    </button>
                    {isOpen && (
                      <div className="border-t border-slate-100 divide-y divide-slate-100">
                        {c.byZone.length > 0 && c.totalShippingCost > 0 && (
                          <ul
                            className="bg-amber-50/40 divide-y divide-amber-100"
                            data-testid={`dispatch-stats-zones-${c.carrier.replace(/\s+/g, '-')}`}
                          >
                            {c.byZone.map((z) => (
                              <li key={z.zone} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-1.5 text-[11px] text-amber-900">
                                <span className="font-semibold">{z.zone}</span>
                                <span className="font-mono tabular-nums text-slate-700">{z.count}</span>
                                <span className="font-mono tabular-nums" title="Cobrado al cliente">
                                  {z.totalShippingCost > 0 ? `ARS ${Math.round(z.totalShippingCost).toLocaleString("es-AR")}` : '—'}
                                </span>
                                <span className="font-mono tabular-nums text-emerald-700" title={z.tariffPerPackage != null ? `Tarifa ARS ${Math.round(z.tariffPerPackage).toLocaleString("es-AR")} × ${z.count}` : 'Sin tarifa cargada'}>
                                  {z.estimatedCost != null ? `~ARS ${Math.round(z.estimatedCost).toLocaleString("es-AR")}` : '—'}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <ul className="divide-y divide-slate-100">
                          {c.orders.map((o, i) => (
                            <li key={`${c.carrier}-${i}`} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 text-[11px] text-slate-700">
                              <span className="min-w-0 truncate">
                                <span className="font-mono text-slate-500">{o.orderNumber ?? o.rowKey}</span>
                                {o.customer ? ` · ${o.customer}` : ''}
                                {o.shippingZone ? ` · ${o.shippingZone}` : ''}
                              </span>
                              <span className="font-mono tabular-nums text-slate-600">
                                {fmtMoney(o.amount, o.currency)}
                              </span>
                              <span className="font-mono tabular-nums text-amber-700">
                                {o.shippingCost != null ? `ARS ${Math.round(o.shippingCost).toLocaleString("es-AR")}` : '—'}
                              </span>
                              <span className="font-mono text-slate-500">{fmtDate(o.dispatchedAt)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
