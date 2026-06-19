"use client";

/**
 * Marcos 2026-06-05 (dispute settlement): para validar Bloque E el
 * cliente necesita ver el delta de costo IA en plata real. Este card
 * compara la ventana ANTES del deploy de los 5 cost opts (N1→Haiku,
 * FAQ pre-IA, batch ML, compresión historial, caps L1/L2) contra la
 * ventana actual.
 *
 * Las dos métricas que más importan para él:
 *   1) costo total en USD por la ventana de 10 días
 *   2) costo por pregunta del cliente real (no por call interno)
 *
 * Backend lee CLAUDE_OPTS_LIVE_SINCE_ISO + CLAUDE_SAVINGS_WINDOW_DAYS
 * de .env. Default es 2026-06-05 / 10 días — el día y la duración
 * registrados en todo.md cuando se shippearon las opts.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/endpoints";
import type { AiSavingsSnapshot } from "@/lib/api/endpoints";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import RefreshIcon from "@mui/icons-material/Refresh";
import SavingsIcon from "@mui/icons-material/Savings";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import RemoveIcon from "@mui/icons-material/Remove";

function fmtUsd(n: number): string {
  return `US$ ${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

function fmtPct(p: number): string {
  if (!Number.isFinite(p) || p === 0) return "0%";
  const sign = p > 0 ? "+" : "";
  return `${sign}${Math.round(p * 1000) / 10}%`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

/** Color por delta — bajada de costo es bueno (verde), suba es malo (rojo). */
function deltaTone(pctChange: number, lowerIsBetter = true): string {
  if (pctChange === 0) return "text-slate-600";
  const isImprovement = lowerIsBetter ? pctChange < 0 : pctChange > 0;
  return isImprovement ? "text-emerald-700" : "text-rose-700";
}

export function AiSavingsCard() {
  const [data, setData] = useState<AiSavingsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api.aiBudget.getSavings();
      setData(s);
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo cargar el costo de IA");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <Skeleton className="mb-3 h-5 w-40" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }
  if (!data) return null;

  const costDeltaTone = deltaTone(data.delta.costPctChange);
  const costPerQDeltaTone = deltaTone(data.delta.costPerQuestionPctChange);

  const DeltaIcon = (pct: number, lowerIsBetter = true) => {
    if (pct === 0) return <RemoveIcon sx={{ fontSize: 14 }} />;
    const isImprovement = lowerIsBetter ? pct < 0 : pct > 0;
    return isImprovement
      ? <TrendingDownIcon sx={{ fontSize: 14 }} />
      : <TrendingUpIcon sx={{ fontSize: 14 }} />;
  };

  return (
    <div
      className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
      data-testid="ai-savings-card"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SavingsIcon sx={{ fontSize: 20 }} className="text-emerald-600" />
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Costo de IA — antes vs ahora
          </h3>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-medium text-slate-600 hover:border-slate-300 disabled:opacity-60"
          aria-label="Refrescar"
        >
          <RefreshIcon sx={{ fontSize: 12 }} className={loading ? "animate-spin" : ""} />
          {loading ? "…" : "Refrescar"}
        </button>
      </div>

      <p className="mb-3 text-[11px] text-slate-500">
        Comparación de ventanas de {data.baseline.days} días — antes del deploy de las optimizaciones de costo (Bloque E, {fmtDate(data.optsLiveSince)}) contra la última semana en curso.
      </p>

      {/* TOP — antes / ahora / delta */}
      <div className="mb-3 grid gap-2 sm:grid-cols-3" data-testid="ai-savings-top">
        <div className="rounded-xl border border-slate-200/70 bg-slate-50 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Antes ({fmtDate(data.baseline.fromIso)} → {fmtDate(data.baseline.toIso)})
          </p>
          <p className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums">
            {fmtUsd(data.baseline.costUsd)}
          </p>
          <p className="text-[11px] text-slate-600">
            {data.baseline.calls.toLocaleString("es-AR")} calls · {data.baseline.questions.toLocaleString("es-AR")} preguntas reales
          </p>
        </div>

        <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/40 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-emerald-700">
            Ahora ({fmtDate(data.current.fromIso)} → {fmtDate(data.current.toIso)})
          </p>
          <p className="mt-1 font-mono text-lg font-semibold text-emerald-900 tabular-nums" data-testid="ai-savings-current-cost">
            {fmtUsd(data.current.costUsd)}
          </p>
          <p className="text-[11px] text-emerald-800">
            {data.current.calls.toLocaleString("es-AR")} calls · {data.current.questions.toLocaleString("es-AR")} preguntas reales
          </p>
        </div>

        <div className="rounded-xl border border-slate-200/70 bg-white p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Variación
          </p>
          <p
            className={`mt-1 inline-flex items-center gap-1 font-mono text-lg font-semibold tabular-nums ${costDeltaTone}`}
            data-testid="ai-savings-cost-delta"
          >
            {DeltaIcon(data.delta.costPctChange)}
            {fmtPct(data.delta.costPctChange)}
          </p>
          <p className={`text-[11px] inline-flex items-center gap-1 ${costPerQDeltaTone}`}>
            {DeltaIcon(data.delta.costPerQuestionPctChange)}
            {fmtPct(data.delta.costPerQuestionPctChange)} por pregunta
          </p>
        </div>
      </div>

      {/* PER-QUESTION HEADLINE */}
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200/70 bg-white p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">Costo por pregunta — antes</p>
          <p className="mt-1 font-mono text-base font-semibold text-slate-900 tabular-nums">{fmtUsd(data.baseline.costPerQuestionUsd)}</p>
        </div>
        <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/40 p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-emerald-700">Costo por pregunta — ahora</p>
          <p className="mt-1 font-mono text-base font-semibold text-emerald-900 tabular-nums" data-testid="ai-savings-cost-per-question">{fmtUsd(data.current.costPerQuestionUsd)}</p>
        </div>
      </div>

      {/* MODEL SPLIT (ventana actual) */}
      {data.byModelCurrent.length > 0 && (
        <div className="mb-3" data-testid="ai-savings-by-model">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Costo por modelo (ventana actual)</p>
          <ul className="space-y-1">
            {data.byModelCurrent.map((m) => (
              <li
                key={m.model}
                className="flex items-center justify-between gap-2 rounded-md border border-slate-200/70 bg-slate-50/50 px-3 py-1.5 text-[11px]"
              >
                <span className="truncate font-mono text-slate-700">{m.model}</span>
                <span className="inline-flex items-center gap-3 tabular-nums text-slate-600">
                  <span>{m.calls.toLocaleString("es-AR")} calls</span>
                  <span className="font-semibold text-slate-900">{fmtUsd(m.costUsd)}</span>
                  <span className="inline-flex h-5 min-w-[40px] items-center justify-center rounded-full bg-slate-200 px-1.5 text-[10px] text-slate-700">
                    {Math.round(m.share * 100)}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* CALL-SITE SPLIT */}
      {data.byCallSiteCurrent.length > 0 && (
        <details className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-3">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-slate-600">
            Desglose por uso (ventana actual)
          </summary>
          <ul className="mt-2 space-y-1">
            {data.byCallSiteCurrent.map((c) => (
              <li
                key={c.callSite}
                className="flex items-center justify-between gap-2 rounded-md border border-slate-200/70 bg-white px-3 py-1 text-[11px]"
              >
                <span className="truncate font-mono text-slate-700">{c.callSite}</span>
                <span className="inline-flex items-center gap-3 tabular-nums text-slate-600">
                  <span>{c.calls.toLocaleString("es-AR")}</span>
                  <span className="font-semibold text-slate-900">{fmtUsd(c.costUsd)}</span>
                  <span className="inline-flex h-5 min-w-[40px] items-center justify-center rounded-full bg-slate-200 px-1.5 text-[10px] text-slate-700">
                    {Math.round(c.share * 100)}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="mt-3 text-[10px] text-slate-400">
        Tokens · entrada {fmtTokens(data.current.inputTokens)} (cache hit {fmtTokens(data.current.cacheReadTokens)}) · salida {fmtTokens(data.current.outputTokens)}. Excluye tráfico de test/dev.
      </p>
    </div>
  );
}
