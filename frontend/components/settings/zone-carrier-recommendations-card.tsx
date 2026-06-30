"use client";

// Marcos 2026-06-30: card en Settings → Tarifas que muestra qué
// mensajería sugiere el sistema como default para cada zona, basado
// en lo que el equipo viene picando en los últimos 90 días. Permite
// aplicar selecciones (per-row o bulk) sin que Marcos llene el
// Excel a mano — el cascade del panel Despachos + Listas activa
// apenas se aplican las recomendaciones.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api/endpoints";
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
import { toast } from "sonner";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RefreshIcon from "@mui/icons-material/Refresh";

type Recommendation = {
  zone: string;
  recommendedCarrier: string;
  confidence: number; // 0..1
  sampleSize: number;
  runnersUp: Array<{ carrier: string; count: number }>;
  currentDefault: string | null;
};

const CARRIER_COLOR: Record<string, string> = {
  "JyJ":                "bg-blue-50 text-blue-700 border-blue-200",
  "M2":                 "bg-orange-50 text-orange-700 border-orange-200",
  "Baires":             "bg-violet-50 text-violet-700 border-violet-200",
  "Andreani":           "bg-rose-50 text-rose-700 border-rose-200",
  "OCA":                "bg-amber-50 text-amber-700 border-amber-200",
  "Mercado Libre":      "bg-yellow-50 text-yellow-700 border-yellow-200",
  "Servifibras propio": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Despachos Online":   "bg-cyan-50 text-cyan-700 border-cyan-200",
};

export function ZoneCarrierRecommendationsCard() {
  const [rows, setRows] = useState<Recommendation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.dailyLogistica.zoneCarrierRecommendations();
      setRows(data);
      // Auto-seleccionar las zonas donde currentDefault ya NO está y
      // la recomendación tiene confianza ≥ 80% — guía al ojo del
      // admin a las acciones más obvias.
      const auto = new Set<string>();
      for (const r of data) {
        if (!r.currentDefault && r.confidence >= 0.80) auto.add(r.zone);
      }
      setSelected(auto);
    } catch (e: any) {
      setError(e?.message || "no se pudieron cargar recomendaciones");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleRow = (zone: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(zone)) next.delete(zone);
      else next.add(zone);
      return next;
    });
  };

  const selectAll = (only: 'all' | 'highConfidence' | 'none') => {
    if (!rows) return;
    if (only === 'none') return setSelected(new Set());
    const next = new Set<string>();
    for (const r of rows) {
      if (only === 'all') next.add(r.zone);
      else if (r.confidence >= 0.80) next.add(r.zone);
    }
    setSelected(next);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try { await load(); }
    finally { setRefreshing(false); }
  };

  const apply = async () => {
    if (!rows) return;
    const selections = rows
      .filter((r) => selected.has(r.zone))
      .map((r) => ({ zone: r.zone, carrier: r.recommendedCarrier }));
    if (selections.length === 0) {
      toast.error("No hay recomendaciones seleccionadas");
      setApplyOpen(false);
      return;
    }
    setApplying(true);
    try {
      const res = await api.dailyLogistica.applyZoneCarrierRecommendations(selections);
      toast.success(`Aplicadas ${selections.length} recomendaciones — ${res.updated} CPs actualizados`);
      if (res.zonesWithoutMatch.length > 0) {
        toast.warning(`${res.zonesWithoutMatch.length} zonas sin CPs cargados en la tabla — subí la planilla para que el default actúe sobre esos CPs`);
      }
      await load();
    } catch (e: any) {
      toast.error(e?.message || "no se pudo aplicar");
    } finally {
      setApplying(false);
      setApplyOpen(false);
    }
  };

  const selectedCount = selected.size;

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-violet-500 text-white shadow-[0_4px_12px_-2px_rgb(192_38_211/0.45)]">
          <AutoAwesomeIcon sx={{ fontSize: 22 }} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-900">Mensajería sugerida por zona</h3>
          <p className="text-xs text-slate-500">
            Detectada desde lo que el equipo viene picando los últimos 90 días. Aplicar fija el default por zona — los pedidos nuevos sin pick manual usan esta mensajería automáticamente.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshIcon sx={{ fontSize: 14 }} className={refreshing ? "animate-spin" : ""} />
          Recalcular
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-rose-200/70 bg-rose-50 p-3 text-xs text-rose-700">
          {error}
        </div>
      )}

      {!rows && !error && <div className="text-xs text-slate-500">Cargando recomendaciones…</div>}

      {rows && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-xs text-slate-500">
          Todavía no hay suficiente histórico de despachos para sugerir defaults. Volvé en unos días cuando el equipo haya picado más mensajerías, o cargá la planilla de Tarifas con la columna mensajería.
        </div>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => selectAll('highConfidence')}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            >
              Sólo alta confianza (≥80%)
            </button>
            <button
              type="button"
              onClick={() => selectAll('all')}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            >
              Todas
            </button>
            <button
              type="button"
              onClick={() => selectAll('none')}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            >
              Ninguna
            </button>
            <span className="text-slate-500">
              {selectedCount} seleccionada{selectedCount === 1 ? "" : "s"} de {rows.length}
            </span>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50/70 text-slate-600">
                <tr>
                  <th className="w-10 px-3 py-2"></th>
                  <th className="px-3 py-2 text-left font-medium uppercase tracking-wider">Zona</th>
                  <th className="px-3 py-2 text-left font-medium uppercase tracking-wider">Sugerida</th>
                  <th className="px-3 py-2 text-right font-medium uppercase tracking-wider">Confianza</th>
                  <th className="px-3 py-2 text-right font-medium uppercase tracking-wider">Despachos</th>
                  <th className="px-3 py-2 text-left font-medium uppercase tracking-wider">Default actual</th>
                  <th className="px-3 py-2 text-left font-medium uppercase tracking-wider">Otras opciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const isSel = selected.has(r.zone);
                  const matchesCurrent = r.currentDefault && r.currentDefault.toLowerCase() === r.recommendedCarrier.toLowerCase();
                  return (
                    <tr key={r.zone} className={isSel ? "bg-fuchsia-50/30" : ""}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleRow(r.zone)}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-fuchsia-600 focus:ring-fuchsia-500"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">{r.zone}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${CARRIER_COLOR[r.recommendedCarrier] ?? "bg-slate-100 text-slate-700 border-slate-200"}`}>
                          {r.recommendedCarrier}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={r.confidence >= 0.80 ? "text-emerald-700 font-semibold" : r.confidence >= 0.65 ? "text-amber-700" : "text-slate-500"}>
                          {Math.round(r.confidence * 100)}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{r.sampleSize}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {r.currentDefault ? (
                          <span className="inline-flex items-center gap-1">
                            {matchesCurrent && <CheckCircleIcon sx={{ fontSize: 12 }} className="text-emerald-600" />}
                            {r.currentDefault}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {r.runnersUp.map((u, i) => (
                          <span key={u.carrier}>
                            {i > 0 && " · "}
                            {u.carrier} <span className="tabular-nums text-slate-400">({u.count})</span>
                          </span>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => setApplyOpen(true)}
              disabled={selectedCount === 0}
              className="inline-flex items-center gap-1.5 rounded-xl bg-fuchsia-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-fuchsia-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Aplicar {selectedCount > 0 ? `${selectedCount} ` : ""}recomendacion{selectedCount === 1 ? "" : "es"}
            </button>
          </div>
        </>
      )}

      <AlertDialog open={applyOpen} onOpenChange={(o) => { if (!o) setApplyOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aplicar recomendaciones de mensajería</AlertDialogTitle>
            <AlertDialogDescription>
              Esto fija el default de mensajería para {selectedCount} zona{selectedCount === 1 ? "" : "s"}. Los pedidos nuevos sin pick manual van a usar la mensajería sugerida; los que ya están en cola no cambian. Podés revertir o cambiar el default después subiendo una planilla nueva.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applying}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={apply} disabled={applying} className="bg-fuchsia-600 text-white hover:bg-fuchsia-700">
              {applying ? "Aplicando…" : "Aplicar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
