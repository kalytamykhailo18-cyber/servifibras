"use client";

// Marcos 2026-06-18: side-by-side team leaderboard. One row per
// active operator showing manual sales + response-time + workload
// over a configurable window so Marcos can compare who's working
// better/worse. Lives inside the "Calidad equipo" tab on Analíticas.

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api/endpoints";
import GroupIcon from "@mui/icons-material/Group";

type Period = "semana" | "quincena" | "mes" | "custom";

function isoWindow(period: Period, custom: { from: string; to: string }): { from: string; to: string } {
  const now = new Date();
  if (period === "custom") {
    return {
      from: custom.from ? new Date(custom.from + "T00:00:00").toISOString() : new Date(now.getTime() - 7 * 86400_000).toISOString(),
      to:   custom.to   ? new Date(custom.to   + "T23:59:59").toISOString() : now.toISOString(),
    };
  }
  const days = period === "semana" ? 7 : period === "quincena" ? 15 : 30;
  return {
    from: new Date(now.getTime() - days * 86400_000).toISOString(),
    to:   now.toISOString(),
  };
}

function fmtSeconds(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtArs(n: number): string {
  return `ARS ${Math.round(n).toLocaleString("es-AR")}`;
}

export function TeamPerformanceCard() {
  const [period, setPeriod] = useState<Period>("semana");
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [data, setData] = useState<Awaited<ReturnType<typeof api.analytics.getTeamPerformance>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const window = useMemo(() => isoWindow(period, custom), [period, custom]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await api.analytics.getTeamPerformance({ from: window.from, to: window.to });
        if (!cancelled) setData(res);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "no se pudo cargar");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [window.from, window.to]);

  // Sort by invoicedArs desc so the top performer surfaces first.
  const rows = useMemo(() => {
    if (!data?.users) return [];
    return [...data.users].sort((a, b) => b.invoicedArs - a.invoicedArs);
  }, [data]);

  return (
    <section
      data-testid="team-performance-card"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-500 text-white">
            <GroupIcon sx={{ fontSize: 16 }} />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Performance del equipo</h2>
            <p className="text-[11px] text-slate-500">
              Ventas manuales + tiempo de respuesta + conversaciones, por operador.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
          {(["semana", "quincena", "mes", "custom"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              data-testid={`team-perf-period-${p}`}
              className={
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
                (period === p
                  ? "bg-white text-slate-900 shadow-[0_1px_2px_0_rgb(15_23_42/0.06)]"
                  : "text-slate-500 hover:text-slate-700")
              }
            >
              {p === "semana" ? "Semana" : p === "quincena" ? "Quincena" : p === "mes" ? "Mes" : "Custom"}
            </button>
          ))}
        </div>
      </div>

      {period === "custom" && (
        <div className="mb-3 flex items-center gap-2 text-xs">
          <label className="text-slate-500">Desde</label>
          <input
            type="date"
            value={custom.from}
            onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
            className="h-8 rounded-md border border-slate-200 bg-white px-2"
          />
          <label className="text-slate-500">Hasta</label>
          <input
            type="date"
            value={custom.to}
            onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
            className="h-8 rounded-md border border-slate-200 bg-white px-2"
          />
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center text-xs text-slate-500">
          Cargando…
        </div>
      ) : error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-xs text-rose-800">
          {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center text-xs text-slate-500">
          No hay usuarios activos para mostrar.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="team-perf-table">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/50 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2 text-left font-medium">Operador</th>
                <th className="px-3 py-2 text-right font-medium" title="Cantidad de pedidos manuales cargados">Pedidos</th>
                <th className="px-3 py-2 text-right font-medium" title="Total facturado de los pedidos manuales cargados (ARS)">Facturado</th>
                <th className="px-3 py-2 text-right font-medium" title="Conversaciones donde envió al menos una respuesta">Conv.</th>
                <th className="px-3 py-2 text-right font-medium" title="Tiempo promedio entre el primer mensaje del cliente y su primera respuesta">1ra resp.</th>
                <th className="px-3 py-2 text-right font-medium" title="Tiempo promedio entre mensaje del cliente y su respuesta (todas las respuestas, no solo la primera)">Resp. prom.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr
                  key={u.userId}
                  data-testid={`team-perf-row-${u.userId}`}
                  className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/40"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{u.name}</div>
                    <div className="text-[11px] text-slate-500">{u.role}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">{u.ordersCreated}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold text-emerald-700">{fmtArs(u.invoicedArs)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700">{u.conversationsHandled}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-blue-700">{fmtSeconds(u.avgFirstResponseSeconds)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">{fmtSeconds(u.avgReplyLatencySeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-slate-500">
            Las ventas de TiendaNube y Mercado Libre quedan en su propia tarjeta (Ventas unificadas) — acá solo van los pedidos cargados a mano.
          </p>
        </div>
      )}
    </section>
  );
}
