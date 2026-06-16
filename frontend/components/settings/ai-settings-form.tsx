"use client";

// Configuración → IA tab.
//
// History: the original form was a scaffolding artefact (model dropdown
// pre-filled with "gpt-4", temperature / max-tokens / auto-response
// toggle, escalation keywords). Those fields were stored in DB but
// never consumed — the live agent runs on Claude with values pulled
// from `.env`. Marcos flagged the confusion on 2026-05-14 ("este panel
// no está reflejando la realidad"); the form was rewritten to do the
// only thing that actually drives agent behaviour from this page: edit
// the Lucas system prompt.
//
// Mechanism: GET /admin/configuration/lucas-prompt returns the live
// snapshot (content + source 'db'|'file'|'none' + updatedAt). PUT
// persists to the Configuration table; ClaudeService hot-reloads so
// the next reply uses the new prompt. POST .../reset drops the DB
// override and falls back to the on-disk default
// (LUCAS_PROMPT_PATH). No server restart, no AnyDesk.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api/endpoints";
import { safeFormatDate } from "@/lib/date";
import { Skeleton } from "@/components/ui/skeleton";
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
import SmartToyIcon from "@mui/icons-material/SmartToy";
import SaveIcon from "@mui/icons-material/Save";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import RefreshIcon from "@mui/icons-material/Refresh";

type Source = "db" | "file" | "none";

interface Snapshot {
  content: string | null;
  source: Source;
  updatedAt: string | null;
  length: number;
}

const SECTION_HEADER =
  "mb-6 flex items-center gap-3";
const FIELD_LABEL = "text-xs font-medium uppercase tracking-wide text-slate-500";

export function AISettingsForm() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      const snap = await api.config.getLucasPrompt();
      setSnapshot(snap);
      setDraft(snap.content ?? "");
    } catch (err: any) {
      toast.error(err?.message || "No se pudo cargar el prompt");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => {
    return (snapshot?.content ?? "") !== draft;
  }, [snapshot, draft]);

  const handleSave = useCallback(async () => {
    if (!dirty) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      toast.error("El prompt no puede quedar vacío");
      return;
    }
    setIsSaving(true);
    try {
      const next = await api.config.updateLucasPrompt(trimmed);
      setSnapshot(next);
      setDraft(next.content ?? "");
      toast.success("Prompt guardado. El agente usa la versión nueva desde el próximo mensaje.");
    } catch (err: any) {
      toast.error(err?.message || "No se pudo guardar el prompt");
    } finally {
      setIsSaving(false);
    }
  }, [dirty, draft]);

  const handleReset = useCallback(async () => {
    setIsResetting(true);
    try {
      const next = await api.config.resetLucasPrompt();
      setSnapshot(next);
      setDraft(next.content ?? "");
      setResetOpen(false);
      toast.success("Prompt restablecido al original del servidor.");
    } catch (err: any) {
      toast.error(err?.message || "No se pudo restablecer el prompt");
    } finally {
      setIsResetting(false);
    }
  }, []);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className={SECTION_HEADER}>
          <Skeleton className="h-11 w-11 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  const sourceLabel: Record<Source, string> = {
    db: "Personalizado (editado desde el panel)",
    file: "Original del servidor",
    none: "Sin prompt cargado (fallback genérico)",
  };
  const sourceTint: Record<Source, string> = {
    db: "bg-emerald-100 text-emerald-700",
    file: "bg-slate-100 text-slate-600",
    none: "bg-amber-100 text-amber-700",
  };

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-6 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <div className={SECTION_HEADER}>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(139_92_246/0.45)]">
          <SmartToyIcon sx={{ fontSize: 22 }} />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">Prompt del agente Lucas</h2>
          <p className="text-xs text-slate-500">
            Define quién es Lucas, cómo responde y qué puede hacer. Cualquier cambio guardado acá impacta
            inmediatamente en la próxima respuesta del agente — sin reinicios.
          </p>
        </div>
      </div>

      {/* Status row — source + length + last-edit */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${sourceTint[snapshot?.source ?? "none"]}`}
          data-testid="lucas-prompt-source"
        >
          {sourceLabel[snapshot?.source ?? "none"]}
        </span>
        <span className="text-slate-400">·</span>
        <span data-testid="lucas-prompt-length">
          {(snapshot?.length ?? 0).toLocaleString("es-AR")} caracteres
        </span>
        {snapshot?.updatedAt && (
          <>
            <span className="text-slate-400">·</span>
            <span>
              Última edición: {safeFormatDate(snapshot.updatedAt, "dd/MM/yyyy HH:mm")}
            </span>
          </>
        )}
      </div>

      <label htmlFor="lucas-prompt-editor" className={FIELD_LABEL}>
        Contenido del prompt
      </label>
      <textarea
        id="lucas-prompt-editor"
        data-testid="lucas-prompt-editor"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        rows={20}
        className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-slate-900 focus:border-violet-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100"
        placeholder="Sos Lucas, el asistente de ServiFibras…"
      />
      <p className="mt-1.5 text-[11px] text-slate-500">
        Markdown, headers y emojis decorativos los limpia automáticamente el sistema antes de enviar al cliente.
        El máximo permitido es 200 KB.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || isSaving}
          data-testid="lucas-prompt-save"
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(139_92_246/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(139_92_246/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-[0_8px_20px_-6px_rgb(139_92_246/0.5)]"
        >
          {isSaving ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Guardando…
            </>
          ) : (
            <>
              <SaveIcon sx={{ fontSize: 16 }} />
              Guardar cambios
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => setDraft(snapshot?.content ?? "")}
          disabled={!dirty || isSaving}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Descartar cambios
        </button>

        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
        >
          <RefreshIcon sx={{ fontSize: 16 }} className="text-blue-600" />
          Recargar
        </button>

        {snapshot?.source === "db" && (
          <button
            type="button"
            onClick={() => setResetOpen(true)}
            data-testid="lucas-prompt-reset"
            className="ml-auto inline-flex h-10 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 text-sm font-medium text-amber-800 transition-all duration-200 hover:border-amber-300 hover:bg-amber-100"
          >
            <RestartAltIcon sx={{ fontSize: 16 }} />
            Restablecer al original
          </button>
        )}
      </div>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Restablecer el prompt original?</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a descartar la versión personalizada y volver al prompt que viene por defecto en el servidor.
              Los cambios guardados se pierden — si querés conservarlos, copialos a un lado antes de continuar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResetting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReset}
              disabled={isResetting}
              data-testid="lucas-prompt-reset-confirm"
            >
              {isResetting ? "Restableciendo…" : "Restablecer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
