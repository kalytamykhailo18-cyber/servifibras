"use client";

import { useCallback, useEffect, useState } from "react";
import { useRealtimeEvent } from "@/lib/realtime/use-realtime";
import { api } from "@/lib/api/endpoints";
import { safeFormatDistanceToNow } from "@/lib/date";
import GradeIcon from "@mui/icons-material/Grade";
import RefreshIcon from "@mui/icons-material/Refresh";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";

interface ScorePayload {
  score: number | null;
  strengths: string[];
  improvement: {
    reason: string;
    originalSnippet: string;
    suggestedRewrite: string;
  } | null;
  missedOpportunity: { detected: boolean; reason: string | null };
  severeFlag: string;
  severeReason: string | null;
  updatedAt: string;
}

interface ConversationScorePanelProps {
  conversationId: string;
}

// Score → gradient ring color. 8+ = emerald, 5-7 = amber, <5 = rose.
function scoreTone(score: number | null): {
  ring: string;
  text: string;
  label: string;
  bg: string;
} {
  if (score === null) {
    return {
      ring: "from-slate-300 to-slate-200",
      text: "text-slate-400",
      label: "—",
      bg: "bg-slate-50",
    };
  }
  if (score >= 8) {
    return {
      ring: "from-emerald-500 to-teal-400",
      text: "text-emerald-700",
      label: "Excelente",
      bg: "bg-emerald-50",
    };
  }
  if (score >= 5) {
    return {
      ring: "from-amber-500 to-orange-400",
      text: "text-amber-700",
      label: "Aceptable",
      bg: "bg-amber-50",
    };
  }
  return {
    ring: "from-rose-500 to-pink-400",
    text: "text-rose-700",
    label: "A mejorar",
    bg: "bg-rose-50",
  };
}

export function ConversationScorePanel({ conversationId }: ConversationScorePanelProps) {
  const [score, setScore] = useState<ScorePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [applyState, setApplyState] = useState<"idle" | "applying" | "applied" | "error">("idle");
  // Editable copy of the evaluator's suggested rewrite. Marcos 2026-06-02:
  // "no me deja editar actualmente la corrección de la pregunta" — for
  // cases like the hebillas kit where the evaluator doesn't know catalog
  // details, the admin needs to overwrite the suggestion before
  // promoting it as a training example.
  const [editedRewrite, setEditedRewrite] = useState<string>("");
  const [rewriteDirty, setRewriteDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.conversations.getScore(conversationId);
      setScore(data);
      // Seed the editable rewrite from the evaluator's suggestion the
      // first time the panel loads for a conversation. Re-seeding on
      // every load would erase a user's in-progress edit, so we only
      // overwrite when the admin hasn't touched the field yet.
      if (data?.improvement?.suggestedRewrite) {
        setEditedRewrite((prev) =>
          rewriteDirty && prev ? prev : data.improvement!.suggestedRewrite,
        );
      } else {
        if (!rewriteDirty) setEditedRewrite("");
      }
    } catch {
      // keep previous on transient failure
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [conversationId, rewriteDirty]);

  useEffect(() => {
    setLoading(true);
    setScore(null);
    setRewriteDirty(false);
    setEditedRewrite("");
    setApplyState("idle");
    load();
    // load() reads `rewriteDirty` but we reset it above before the call,
    // so the seeded value lands cleanly when conversationId changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useRealtimeEvent<{ conversationId: string }>("quality:score_ready", (payload) => {
    if (payload?.conversationId === conversationId) {
      setRefreshing(true);
      load();
    }
  });

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await api.conversations.regenerateScore(conversationId);
    } catch {
      // ignore — refetch anyway
    }
    setTimeout(() => {
      load();
    }, 1500);
  };

  const handleApplyCorrection = async () => {
    setApplyState("applying");
    try {
      // If the admin edited the suggestion, send the override; otherwise
      // the backend uses the evaluator's original suggestedRewrite.
      const override = rewriteDirty ? editedRewrite.trim() : undefined;
      const res = await api.quality.applyCorrection(conversationId, override);
      setApplyState(res?.success ? "applied" : "error");
    } catch {
      setApplyState("error");
    }
  };

  const tone = scoreTone(score?.score ?? null);
  const severe = score?.severeFlag && score.severeFlag !== "NONE";

  return (
    <div
      className={
        "rounded-2xl border p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] " +
        (severe
          ? "border-rose-300/80 bg-gradient-to-br from-rose-50/60 to-white"
          : "border-blue-200/70 bg-gradient-to-br from-blue-50/40 to-white")
      }
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={
              "grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25)] " +
              (severe
                ? "bg-gradient-to-br from-rose-500 to-pink-500"
                : "bg-gradient-to-br from-blue-500 to-cyan-400")
            }
          >
            <GradeIcon sx={{ fontSize: 14 }} />
          </span>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Calidad en vivo
          </h3>
        </div>
        <button
          type="button"
          onClick={handleManualRefresh}
          disabled={refreshing}
          aria-label="Refrescar puntaje"
          title="Refrescar puntaje"
          className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-blue-600 disabled:opacity-60"
        >
          <RefreshIcon sx={{ fontSize: 14 }} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {loading ? (
        <div className="space-y-2.5">
          <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
          <div className="h-3 w-full animate-pulse rounded bg-slate-200" />
        </div>
      ) : !score ? (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-slate-500">
            Sin puntaje todavía. Aun así podés escribir la respuesta correcta
            abajo y guardarla como ejemplo — el agente la imitará en casos
            parecidos.
          </p>
          {renderEditor({
            heading: "Respuesta corregida (manual)",
            placeholder:
              "Redactá cómo el agente debería haber respondido al cliente.",
            editedRewrite,
            setEditedRewrite,
            rewriteDirty,
            setRewriteDirty,
            applyState,
            setApplyState,
            handleApplyCorrection,
            originalSuggestion: null,
          })}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Big score ring */}
          <div className="flex items-center gap-4">
            <div
              className={`grid h-16 w-16 shrink-0 place-items-center rounded-full bg-gradient-to-br ${tone.ring} text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(15_23_42/0.18)]`}
            >
              <div className="grid h-[58px] w-[58px] place-items-center rounded-full bg-white">
                <span className={`text-2xl font-bold ${tone.text}`}>
                  {score.score ?? "—"}
                  {score.score !== null && (
                    <span className="text-sm font-medium text-slate-400">/10</span>
                  )}
                </span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${tone.text}`}>{tone.label}</p>
              <p className="text-[10px] text-slate-400">
                Actualizado {safeFormatDistanceToNow(score.updatedAt)}
              </p>
            </div>
          </div>

          {/* Severe flag — only when triggered */}
          {severe && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-200/70 bg-rose-50/80 p-3">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-rose-500 text-white">
                <ReportProblemOutlinedIcon sx={{ fontSize: 14 }} />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">
                  {score.severeFlag.replace(/_/g, " ")}
                </p>
                {score.severeReason && (
                  <p className="mt-0.5 text-xs leading-relaxed text-rose-700">
                    {score.severeReason}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Strengths — what's working */}
          {score.strengths.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <CheckCircleOutlineIcon sx={{ fontSize: 12 }} className="text-emerald-600" />
                Fortalezas
              </div>
              <ul className="space-y-1.5 text-sm text-slate-700">
                {score.strengths.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
                    <span className="leading-relaxed">{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Improvement — what to fix, with rewrite suggestion.
              The editor itself now renders on EVERY scored conversation
              (Marcos 2026-06-03 PM: "podríamos incorporar corrección a
              cualquier respuesta… a veces la IA no encuentra la
              gravedad o el error"). When the scorer didn't surface a
              suggestion, the editor opens with empty content and the
              admin types the correct reply from scratch. */}
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <LightbulbOutlinedIcon sx={{ fontSize: 12 }} className="text-amber-600" />
              A mejorar
            </div>
            {score.improvement?.reason ? (
              <p className="text-sm leading-relaxed text-slate-700">
                {score.improvement.reason}
              </p>
            ) : (
              <p className="text-xs leading-relaxed text-slate-500">
                El evaluador no marcó nada para corregir, pero si vos ves un
                error en alguna respuesta del agente podés escribir la versión
                correcta abajo y guardarla como ejemplo.
              </p>
            )}
            {renderEditor({
              heading: score.improvement?.suggestedRewrite
                ? "Sugerencia (editable)"
                : "Respuesta corregida (manual)",
              placeholder: score.improvement?.suggestedRewrite
                ? "Editá la respuesta corregida antes de aplicarla como ejemplo."
                : "Redactá cómo el agente debería haber respondido al cliente.",
              editedRewrite,
              setEditedRewrite,
              rewriteDirty,
              setRewriteDirty,
              applyState,
              setApplyState,
              handleApplyCorrection,
              originalSuggestion: score.improvement?.suggestedRewrite || null,
            })}
          </div>

          {/* Missed opportunity callout — only when detected */}
          {score.missedOpportunity?.detected && score.missedOpportunity.reason && (
            <div className="rounded-xl border border-orange-200/70 bg-orange-50/60 p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-orange-700">
                Oportunidad no aprovechada
              </p>
              <p className="text-xs leading-relaxed text-slate-700">
                {score.missedOpportunity.reason}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Inline editor block — used in three contexts:
 *  (1) Score absent (manual correction, blank textarea).
 *  (2) Score present without a `suggestedRewrite` (manual correction).
 *  (3) Score present WITH a `suggestedRewrite` (editable suggestion).
 * Context (3) passes `originalSuggestion` so the admin can revert.
 */
function renderEditor(props: {
  heading: string;
  placeholder: string;
  editedRewrite: string;
  setEditedRewrite: (v: string) => void;
  rewriteDirty: boolean;
  setRewriteDirty: (v: boolean) => void;
  applyState: "idle" | "applying" | "applied" | "error";
  setApplyState: (s: "idle" | "applying" | "applied" | "error") => void;
  handleApplyCorrection: () => void;
  originalSuggestion: string | null;
}) {
  const {
    heading,
    placeholder,
    editedRewrite,
    setEditedRewrite,
    rewriteDirty,
    setRewriteDirty,
    applyState,
    setApplyState,
    handleApplyCorrection,
    originalSuggestion,
  } = props;
  return (
    <div className="mt-2 rounded-xl border border-amber-200/70 bg-amber-50/60 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
          {heading}
        </p>
        {rewriteDirty && originalSuggestion && (
          <button
            type="button"
            onClick={() => {
              setEditedRewrite(originalSuggestion);
              setRewriteDirty(false);
              if (applyState === "applied") setApplyState("idle");
            }}
            data-testid="reset-correction-btn"
            className="text-[10px] font-medium text-amber-700 underline-offset-2 hover:underline"
            title="Volver a la versión que sugirió el evaluador"
          >
            Volver a la sugerencia original
          </button>
        )}
      </div>
      <textarea
        value={editedRewrite}
        onChange={(e) => {
          setEditedRewrite(e.target.value);
          setRewriteDirty(true);
          if (applyState === "applied") setApplyState("idle");
        }}
        data-testid="correction-edit-textarea"
        rows={Math.min(8, Math.max(3, editedRewrite.split("\n").length + 1))}
        className="w-full resize-y rounded-lg border border-amber-200 bg-white/80 px-2 py-1.5 text-xs leading-relaxed text-slate-700 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-200"
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={handleApplyCorrection}
        disabled={
          applyState === "applying" ||
          applyState === "applied" ||
          editedRewrite.trim().length === 0
        }
        data-testid="apply-correction-btn"
        className={
          "mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition " +
          (applyState === "applied"
            ? "bg-emerald-100 text-emerald-800 cursor-not-allowed"
            : applyState === "error"
              ? "bg-rose-100 text-rose-800 hover:bg-rose-200"
              : applyState === "applying"
                ? "bg-amber-100 text-amber-700 cursor-not-allowed opacity-70"
                : editedRewrite.trim().length === 0
                  ? "bg-amber-300 text-white cursor-not-allowed opacity-60"
                  : "bg-amber-600 text-white hover:bg-amber-700")
        }
        title={
          originalSuggestion
            ? rewriteDirty
              ? "Guarda tu versión editada como ejemplo few-shot del agente"
              : "Guarda la sugerencia del evaluador como ejemplo few-shot del agente"
            : "Guarda esta corrección manual como ejemplo few-shot del agente"
        }
      >
        <AutoFixHighIcon sx={{ fontSize: 13 }} />
        {applyState === "applied"
          ? "Aplicada como ejemplo"
          : applyState === "applying"
            ? "Aplicando…"
            : applyState === "error"
              ? "Reintentar"
              : !originalSuggestion
                ? "Guardar como ejemplo"
                : rewriteDirty
                  ? "Usar versión editada como ejemplo"
                  : "Usar como ejemplo"}
      </button>
    </div>
  );
}
