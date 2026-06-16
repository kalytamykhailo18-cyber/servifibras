"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type QualityMeResponse, type ConversationSeverity } from "@/lib/api/endpoints";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

const SEVERE_LABEL: Record<ConversationSeverity, string> = {
  NONE: "",
  WRONG_PRICE: "Precio incorrecto",
  IMPOSSIBLE_PROMISE: "Promesa imposible",
  BAD_TREATMENT: "Mal trato",
  OTHER: "Otro problema grave",
};

export function QualityPersonalCard() {
  const [data, setData] = useState<QualityMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRewrite, setShowRewrite] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await api.quality.me("7d");
      setData(r);
    } catch {
      // soft-fail — card shows the empty state
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div data-testid="quality-personal-card" className="rounded-2xl border border-slate-200 bg-white/70 p-5 text-sm text-slate-500">
        Cargando tu calidad de atención…
      </div>
    );
  }

  if (!data || data.scoredCount === 0) {
    return (
      <div data-testid="quality-personal-card" className="rounded-2xl border border-slate-200 bg-white/60 p-5 text-sm">
        <div className="mb-1 flex items-center gap-2 text-slate-700">
          <AutoAwesomeIcon sx={{ fontSize: 18 }} className="text-violet-500" />
          <span className="font-semibold">Calidad de tu atención</span>
        </div>
        <p className="text-slate-500">
          Todavía no hay conversaciones cerradas tuyas en los últimos 7 días. Cuando cerrés una, Claude la evalúa y mostramos acá el score, fortalezas y la mejora más importante.
        </p>
      </div>
    );
  }

  const latest = data.latest;
  const score = latest?.score ?? null;
  const scoreColor = scoreClass(score);
  const max = Math.max(1, ...data.series.map((p) => p.count));

  return (
    <div data-testid="quality-personal-card" className="min-w-0 rounded-2xl border border-slate-200 bg-white/70 p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <AutoAwesomeIcon sx={{ fontSize: 18 }} className="text-violet-500" />
            Calidad de tu atención
          </div>
          <div className="text-xs text-slate-500">
            Última evaluación: {latest ? new Date(latest.createdAt).toLocaleString("es-AR") : "—"} · {data.scoredCount} conversaciones evaluadas en 7 días
          </div>
        </div>
        <div className="text-right">
          <div className={`text-3xl font-bold leading-none ${scoreColor}`} data-testid="quality-personal-score">
            {score ?? "—"}
            <span className="text-sm font-medium text-slate-400">/10</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            promedio 7d: <span className="font-semibold text-slate-700">{data.avgScore ?? "—"}</span>
          </div>
        </div>
      </div>

      {latest?.severeFlag && latest.severeFlag !== "NONE" && (
        <Link
          href={`/conversations/${latest.conversationId}`}
          data-testid="quality-personal-severe-link"
          data-conversation-id={latest.conversationId}
          className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900 transition hover:bg-rose-100/80 focus:bg-rose-100 focus:outline-none"
          title="Abrir la conversación completa"
        >
          <WarningAmberIcon sx={{ fontSize: 16 }} className="mt-0.5 text-rose-600 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold">{SEVERE_LABEL[latest.severeFlag]}</div>
            {latest.severeReason && <div className="mt-0.5">{latest.severeReason}</div>}
          </div>
          <OpenInNewIcon sx={{ fontSize: 14 }} className="mt-0.5 text-rose-500 shrink-0" />
        </Link>
      )}

      {latest?.strengths && latest.strengths.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-semibold text-emerald-700">Fortalezas detectadas</div>
          <ul className="space-y-1">
            {latest.strengths.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
                <CheckCircleIcon sx={{ fontSize: 14 }} className="mt-0.5 text-emerald-500 shrink-0" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {latest?.improvement && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
          <div className="flex items-start gap-2 text-xs text-amber-900">
            <LightbulbOutlinedIcon sx={{ fontSize: 16 }} className="mt-0.5 text-amber-600 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">Mejora principal</div>
              <div className="mt-0.5">{latest.improvement.reason}</div>
              <button
                type="button"
                data-testid="quality-personal-show-rewrite"
                onClick={() => setShowRewrite((v) => !v)}
                className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-200"
              >
                {showRewrite ? "Ocultar reescritura" : "Cómo hubiera quedado mejor"}
              </button>
              {showRewrite && (
                <div data-testid="quality-personal-rewrite" className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border border-slate-200 bg-white p-2 text-[11px] text-slate-700">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Lo que escribiste</div>
                    {latest.improvement.originalSnippet || <span className="italic text-slate-400">no detectado</span>}
                  </div>
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-[11px] text-emerald-900">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Cómo hubiera quedado mejor</div>
                    {latest.improvement.suggestedRewrite}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sparkline of last N days */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
          <span>Progreso semanal</span>
          <span className="font-medium text-slate-700">
            {data.series.filter((p) => p.count > 0).length} días con score
          </span>
        </div>
        <div className="flex h-12 items-end gap-1" data-testid="quality-personal-spark">
          {data.series.map((p) => {
            const height = p.avgScore != null ? Math.max(8, p.avgScore * 4) : 4;
            const tone = p.avgScore == null
              ? "bg-slate-100"
              : p.avgScore >= 8
              ? "bg-emerald-400"
              : p.avgScore >= 6
              ? "bg-amber-400"
              : "bg-rose-400";
            return (
              <div key={p.date} className="flex flex-1 flex-col items-center gap-1" title={`${p.date} · ${p.avgScore ?? "sin datos"} (${p.count})`}>
                <div className={`w-full rounded-sm ${tone}`} style={{ height: `${height}px` }} />
                <span className="text-[9px] text-slate-400">{p.date.slice(5)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function scoreClass(score: number | null): string {
  if (score == null) return "text-slate-500";
  if (score >= 8) return "text-emerald-600";
  if (score >= 6) return "text-amber-600";
  return "text-rose-600";
}
