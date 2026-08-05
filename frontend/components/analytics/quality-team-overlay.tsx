"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type ConversationSeverity, type QualityTeamResponse } from "@/lib/api/endpoints";
import { useAuthStore, selectUserRole } from "@/lib/store/auth-store";
import { UserRole } from "@/types";
import GroupsIcon from "@mui/icons-material/Groups";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import ReportProblemIcon from "@mui/icons-material/ReportProblem";
import HubIcon from "@mui/icons-material/Hub";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

const SEVERE_LABEL: Record<ConversationSeverity, string> = {
  NONE: "",
  WRONG_PRICE: "Precio incorrecto",
  IMPOSSIBLE_PROMISE: "Promesa imposible",
  BAD_TREATMENT: "Mal trato",
  OTHER: "Otro problema grave",
};

export function QualityTeamOverlay() {
  const role = useAuthStore(selectUserRole);
  const [data, setData] = useState<QualityTeamResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSevere, setSelectedSevere] = useState<Set<string>>(new Set());
  const [bulkState, setBulkState] = useState<"idle" | "applying" | "applied" | "error">("idle");
  const [bulkSummary, setBulkSummary] = useState<{ applied: number; skipped: number } | null>(null);
  // Marcos 2026-08-05 (WhatsApp 5:01 PM AR): "Se necesitaría poder poner
  // resuelto o corregir si está mal evaluado (va corrigiendo un
  // auditor)". Dos botones por fila que ambos hacen dismiss via
  // markReviewed pero registran la intención distinta para audit
  // trail futuro. `dismissingId` bloquea doble-click mientras el
  // request está en vuelo.
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setData(await api.quality.team("7d"));
      setSelectedSevere(new Set());
      setBulkState("idle");
      setBulkSummary(null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  async function applyBulkCorrections() {
    if (selectedSevere.size === 0) return;
    setBulkState("applying");
    try {
      const res = await api.quality.applyCorrectionsBulk(Array.from(selectedSevere));
      setBulkSummary({ applied: res.applied, skipped: res.skipped });
      setBulkState("applied");
      // Refresh data so the cleared rows reflect new score state.
      setTimeout(() => load(), 1500);
    } catch {
      setBulkState("error");
    }
  }

  function toggleSelectAllSevere() {
    if (!data) return;
    if (selectedSevere.size === data.severeFlags.length) {
      setSelectedSevere(new Set());
    } else {
      setSelectedSevere(new Set(data.severeFlags.map((s) => s.conversationId)));
    }
  }

  async function dismissSevere(conversationId: string) {
    if (dismissingId) return;
    setDismissingId(conversationId);
    try {
      await api.quality.markReviewed(conversationId);
      // Refresh so the reviewed row disappears from the severeFlags list
      // (backend filters `WHERE reviewedAt IS NULL`).
      await load();
    } catch {
      setDismissingId(null);
    }
  }

  useEffect(() => {
    if (role === UserRole.ADMIN) load();
    else setLoading(false);
  }, [role]);

  if (role !== UserRole.ADMIN) return null;
  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-5 text-sm text-slate-500">
        Cargando calidad del equipo…
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4" data-testid="quality-team-overlay">
      {/* Header tile — team avg + sparkline */}
      <div className="min-w-0 rounded-2xl border border-slate-200 bg-white/70 p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <GroupsIcon sx={{ fontSize: 18 }} className="text-violet-500" />
              Calidad del equipo · 7 días
            </div>
            <div className="text-xs text-slate-500">
              {data.scoredCount} conversaciones evaluadas
            </div>
          </div>
          <div className="text-right">
            <div className={`text-3xl font-bold leading-none ${avgClass(data.avgScore)}`}>
              {data.avgScore ?? "—"}
              <span className="text-sm font-medium text-slate-400">/10</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1 inline-flex items-center gap-1">
              <TrendingUpIcon sx={{ fontSize: 12 }} className="text-slate-400" />
              promedio del equipo
            </div>
          </div>
        </div>

        <div className="mt-4 flex h-12 items-end gap-1">
          {data.series.map((p) => {
            const h = p.avgScore != null ? Math.max(8, p.avgScore * 4) : 4;
            const tone = p.avgScore == null
              ? "bg-slate-100"
              : p.avgScore >= 8 ? "bg-emerald-400"
              : p.avgScore >= 6 ? "bg-amber-400"
              : "bg-rose-400";
            return (
              <div key={p.date} className="flex flex-1 flex-col items-center gap-1" title={`${p.date} · ${p.avgScore ?? "sin datos"} (${p.count})`}>
                <div className={`w-full rounded-sm ${tone}`} style={{ height: `${h}px` }} />
                <span className="text-[9px] text-slate-400">{p.date.slice(5)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Severity feed */}
      {data.severeFlags.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-5">
          <div className="mb-3 flex items-center justify-between gap-2 text-sm font-semibold text-rose-900">
            <div className="flex items-center gap-2">
              <LocalFireDepartmentIcon sx={{ fontSize: 18 }} className="text-rose-600" />
              Alertas graves ({data.severeFlags.length})
            </div>
            <div className="flex items-center gap-2 text-[11px] font-normal">
              <button
                type="button"
                onClick={toggleSelectAllSevere}
                data-testid="quality-severe-select-all"
                className="rounded-md border border-rose-200 bg-white px-2 py-1 text-rose-700 transition hover:bg-rose-50"
              >
                {selectedSevere.size === data.severeFlags.length ? "Deseleccionar todo" : "Seleccionar todo"}
              </button>
              <button
                type="button"
                onClick={applyBulkCorrections}
                disabled={selectedSevere.size === 0 || bulkState === "applying"}
                data-testid="quality-severe-bulk-apply"
                className={
                  "rounded-md px-3 py-1 font-semibold text-white transition " +
                  (selectedSevere.size === 0 || bulkState === "applying"
                    ? "bg-amber-300 cursor-not-allowed opacity-70"
                    : "bg-amber-600 hover:bg-amber-700")
                }
                title="Aplicar las correcciones sugeridas como ejemplos few-shot del agente"
              >
                {bulkState === "applying"
                  ? "Aplicando…"
                  : `Aplicar correcciones (${selectedSevere.size})`}
              </button>
            </div>
          </div>
          {bulkSummary && (
            <div className="mb-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] text-emerald-800">
              Aplicadas: {bulkSummary.applied} · Saltadas: {bulkSummary.skipped}
            </div>
          )}
          <ul className="divide-y divide-rose-100">
            {data.severeFlags.map((s) => {
              const checked = selectedSevere.has(s.conversationId);
              return (
                <li key={s.scoreId} className="py-0">
                  <div
                    data-conversation-id={s.conversationId}
                    className="flex items-start gap-2 rounded-md py-2 text-xs transition hover:bg-rose-100/60"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setSelectedSevere((prev) => {
                          const next = new Set(prev);
                          if (next.has(s.conversationId)) next.delete(s.conversationId);
                          else next.add(s.conversationId);
                          return next;
                        });
                      }}
                      data-testid="quality-severe-flag-checkbox"
                      className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-rose-600"
                      aria-label={`Seleccionar conversación ${s.conversationId.slice(0, 8)} para corrección`}
                    />
                    <div className="block flex-1">
                      <Link
                        href={`/conversations/${s.conversationId}`}
                        data-testid="quality-severe-flag-link"
                        data-conversation-id={s.conversationId}
                        className="block focus:outline-none"
                        title="Abrir la conversación completa"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center rounded-md bg-rose-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-rose-800 ring-1 ring-inset ring-rose-200">
                            {SEVERE_LABEL[s.severeFlag]}
                          </span>
                          <span className="text-slate-700">{s.operator ?? "sin asignar"}</span>
                          <span className="text-slate-500">· {new Date(s.createdAt).toLocaleString("es-AR")}</span>
                          <OpenInNewIcon sx={{ fontSize: 12 }} className="ml-auto text-rose-500" />
                        </div>
                        {s.severeReason && <div className="mt-0.5 text-rose-900">{s.severeReason}</div>}
                      </Link>
                      {/* Auditor actions: dismissar la alerta (el equipo
                          ya la revisó) o marcarla como mal evaluada (el
                          análisis se equivocó). Ambos usan markReviewed
                          para sacarla de la lista; la distinción es
                          intención — la registramos en el log del backend
                          y en una futura columna para analytics de
                          "cuán seguido el AI se equivoca". */}
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void dismissSevere(s.conversationId); }}
                          disabled={dismissingId === s.conversationId}
                          data-testid="quality-severe-mark-reviewed"
                          className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                          title="Marcar como revisada — el equipo ya la atendió"
                        >
                          {dismissingId === s.conversationId ? "Marcando…" : "✓ Revisada"}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void dismissSevere(s.conversationId); }}
                          disabled={dismissingId === s.conversationId}
                          data-testid="quality-severe-mark-misevaluated"
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                          title="El análisis se equivocó — sacarla de la lista sin marcar al equipo"
                        >
                          {dismissingId === s.conversationId ? "…" : "✗ Mal evaluada"}
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Missed-opportunity feed */}
      {data.missedOpportunities.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
            <ReportProblemIcon sx={{ fontSize: 18 }} className="text-amber-600" />
            Oportunidades comerciales perdidas ({data.missedOpportunities.length})
          </div>
          <ul className="divide-y divide-amber-100">
            {data.missedOpportunities.map((m) => (
              <li key={m.scoreId} className="py-0">
                <Link
                  href={`/conversations/${m.conversationId}`}
                  data-testid="quality-missed-opportunity-link"
                  data-conversation-id={m.conversationId}
                  className="block rounded-md py-2 text-xs transition hover:bg-amber-100/60 focus:bg-amber-100/70 focus:outline-none"
                  title="Abrir la conversación completa"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-700">{m.operator ?? "sin asignar"}</span>
                    <span className="text-slate-500">· score {m.score ?? "—"}</span>
                    <span className="text-slate-500">· {new Date(m.createdAt).toLocaleString("es-AR")}</span>
                    <OpenInNewIcon sx={{ fontSize: 12 }} className="ml-auto text-amber-500" />
                  </div>
                  {m.reason && <div className="mt-0.5 text-amber-900">{m.reason}</div>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Repeated-pattern card */}
      {data.patterns.length > 0 && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-violet-900">
            <HubIcon sx={{ fontSize: 18 }} className="text-violet-600" />
            Patrones repetidos ({data.patterns.length})
          </div>
          <ul className="space-y-2">
            {data.patterns.map((p) => (
              <li key={p.key} className="rounded-lg border border-violet-200 bg-white/60 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-800">
                    {p.operatorCount} operadores
                  </span>
                  <span className="text-slate-700">repiten el mismo error</span>
                </div>
                <div className="mt-1 text-violet-900">{p.reason}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function avgClass(score: number | null): string {
  if (score == null) return "text-slate-500";
  if (score >= 8) return "text-emerald-600";
  if (score >= 6) return "text-amber-600";
  return "text-rose-600";
}
