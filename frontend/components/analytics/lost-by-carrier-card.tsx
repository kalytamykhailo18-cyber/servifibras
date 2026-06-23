"use client";

/**
 * Marcos 2026-06-23: monto a cobrar a cada mensajería por paquetes
 * perdidos (returnState=LOST). La fila se materializa cuando un
 * operador toca "No volvió" desde Pendientes de regreso. Sirve para
 * que ADMIN sepa cuánta plata reclamar a cada courier cada semana / mes.
 */

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api/endpoints";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";

type Preset = 'semana' | 'quincena' | 'mes' | 'custom';

function isoOf(d: Date): string { return d.toISOString(); }
function startOfDay(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0); }
function presetRange(p: Exclude<Preset, 'custom'>): { from: Date; to: Date } {
  const now = new Date();
  const to = now;
  const days = p === 'semana' ? 7 : p === 'quincena' ? 15 : 30;
  const from = startOfDay(new Date(now.getTime() - (days - 1) * 86400000));
  return { from, to };
}
function fmtARS(amount: number): string {
  return `ARS ${Math.round(amount).toLocaleString("es-AR")}`;
}
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function LostByCarrierCard() {
  const [preset, setPreset] = useState<Preset>('mes');
  const [customFrom, setCustomFrom] = useState<string>(toLocalInput(presetRange('mes').from));
  const [customTo, setCustomTo] = useState<string>(toLocalInput(new Date()));
  const [data, setData] = useState<Awaited<ReturnType<typeof api.analytics.getLostByCarrier>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const res = await api.analytics.getLostByCarrier({ from: isoOf(range.from), to: isoOf(range.to) });
      setData(res);
    } catch (err: any) {
      setError(err?.message ?? "No se pudieron cargar los datos");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [preset, customFrom, customTo]);

  const max = data?.byCarrier.reduce((m, r) => Math.max(m, r.totalToCollect), 0) ?? 0;

  return (
    <div
      data-testid="lost-by-carrier-card"
      className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ReportProblemOutlinedIcon sx={{ fontSize: 20 }} className="text-amber-600" />
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            A cobrar a mensajerías (perdidos)
          </h3>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          data-testid="lost-by-carrier-refresh"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshIcon sx={{ fontSize: 13 }} className={loading ? "animate-spin" : ""} />
          {loading ? 'Cargando…' : 'Refrescar'}
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="lost-by-carrier-presets">
        {([
          { id: 'semana' as const, label: 'Semana' },
          { id: 'quincena' as const, label: 'Quincena' },
          { id: 'mes' as const, label: 'Mes' },
          { id: 'custom' as const, label: 'Custom' },
        ]).map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPreset(p.id)}
            data-testid={`lost-by-carrier-preset-${p.id}`}
            className={
              "inline-flex h-7 items-center rounded-md px-2.5 text-[11px] font-medium transition-colors " +
              (preset === p.id ? "bg-amber-600 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50")
            }
          >
            {p.label}
          </button>
        ))}
        {preset === 'custom' && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              data-testid="lost-by-carrier-custom-from"
              className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px]"
            />
            <span className="text-[11px] text-slate-400">→</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              data-testid="lost-by-carrier-custom-to"
              className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[11px]"
            />
          </div>
        )}
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-xs text-rose-700">{error}</p>
      ) : !data ? (
        <p className="text-xs text-slate-500">Cargando…</p>
      ) : data.byCarrier.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-6 text-center text-xs text-slate-500" data-testid="lost-by-carrier-empty">
          No hay paquetes marcados como perdidos en este rango.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-baseline gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Perdidos</p>
              <p className="text-lg font-semibold text-slate-900 tabular-nums">{data.total}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Total a cobrar</p>
              <p className="text-lg font-semibold text-amber-700 tabular-nums">{fmtARS(data.totalToCollect)}</p>
            </div>
          </div>
          <ul className="space-y-1.5" data-testid="lost-by-carrier-list">
            {data.byCarrier.map((c) => (
              <li key={c.carrier} className="rounded-lg border border-slate-200 bg-white p-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-800">{c.carrier}</span>
                  <span className="shrink-0 font-mono text-sm tabular-nums text-amber-700">{fmtARS(c.totalToCollect)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 to-orange-500"
                      style={{ width: `${max > 0 ? Math.round((c.totalToCollect / max) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-500 tabular-nums">{c.count} paquete{c.count === 1 ? '' : 's'}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
