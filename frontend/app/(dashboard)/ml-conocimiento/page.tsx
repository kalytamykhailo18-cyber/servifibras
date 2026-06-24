"use client";

/**
 * Marcos 2026-06-24: Base de conocimiento por publicación (Phase A).
 *
 * El operador ingresa un MLA item id, dispara la ingesta del histórico,
 * y luego cura fila por fila (mantener / editar respuesta / descartar
 * por desactualizada). Eso alimenta la base de verdad que el modo de
 * respuesta cerrado (Phase C) va a usar para responder nuevas
 * preguntas sin RAG abierto y sin drift.
 *
 * Vista: arriba, alta + sumario de publicaciones ya ingestadas;
 * abajo, cuando se selecciona una, las Q&A en una grilla con acciones.
 */

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoleGuard } from "@/lib/hooks/use-role-guard";
import {
  api,
  type MlKnowledgeRow,
  type MlKnowledgeSummaryRow,
} from "@/lib/api/endpoints";
import { UserRole } from "@/types";
import { toast } from "sonner";
import LibraryBooksIcon from "@mui/icons-material/LibraryBooks";
import DownloadIcon from "@mui/icons-material/Download";
import CheckIcon from "@mui/icons-material/Check";
import EditIcon from "@mui/icons-material/Edit";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";

const ROLES = [UserRole.ADMIN, UserRole.ATENCION];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  } catch { return iso.slice(0, 10); }
}

function STATUS_PILL(status: string): { label: string; cls: string } {
  switch (status) {
    case 'kept':      return { label: 'Validada', cls: 'bg-emerald-100 text-emerald-800' };
    case 'edited':    return { label: 'Editada',  cls: 'bg-blue-100 text-blue-800' };
    case 'discarded': return { label: 'Descartada', cls: 'bg-slate-200 text-slate-600' };
    default:          return { label: 'Pendiente', cls: 'bg-amber-100 text-amber-800' };
  }
}

export default function MlConocimientoPage() {
  const { isAllowed } = useRoleGuard(ROLES);
  const [summary, setSummary] = useState<MlKnowledgeSummaryRow[] | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [rows, setRows] = useState<MlKnowledgeRow[] | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [newItemId, setNewItemId] = useState("");
  const [accountKey, setAccountKey] = useState<'mercadolibre' | 'mercadolibre_cuenta2'>('mercadolibre');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [aiPassRunning, setAiPassRunning] = useState(false);
  const [autoKeepRunning, setAutoKeepRunning] = useState(false);

  const loadSummary = async () => {
    try {
      const s = await api.mlPublicationKnowledge.summary();
      setSummary(s);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "No se pudo cargar el resumen");
      setSummary([]);
    }
  };

  const loadItem = async (itemId: string) => {
    setSelectedItemId(itemId);
    setRows(null);
    try {
      const r = await api.mlPublicationKnowledge.listForItem(itemId);
      setRows(r);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "No se pudieron cargar las Q&A");
      setRows([]);
    }
  };

  useEffect(() => {
    if (!isAllowed) return;
    void loadSummary();
  }, [isAllowed]);

  const onIngest = async () => {
    const itemId = newItemId.trim().toUpperCase();
    if (!/^MLA\d{6,}$/.test(itemId)) {
      toast.error("MLA inválido (formato esperado: MLA1234567890)");
      return;
    }
    setIngesting(true);
    try {
      const r = await api.mlPublicationKnowledge.ingest(itemId, accountKey);
      toast.success(`Ingesta OK: ${r.inserted} nuevas, ${r.skipped} ya existentes, ${r.errored} con error`);
      setNewItemId("");
      await loadSummary();
      await loadItem(itemId);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "No se pudo ingestar");
    } finally {
      setIngesting(false);
    }
  };

  const onAutoKeep = async () => {
    if (!selectedItemId) return;
    if (!window.confirm("¿Auto-marcar como 'validadas' todas las pendientes con score IA >= 70%? Las dudosas y desactualizadas quedan para revisión manual.")) return;
    setAutoKeepRunning(true);
    try {
      const r = await api.mlPublicationKnowledge.autoKeepHighScore(selectedItemId);
      toast.success(`${r.keptCount} filas auto-validadas`);
      await loadItem(selectedItemId);
      await loadSummary();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Falló auto-keep");
    } finally {
      setAutoKeepRunning(false);
    }
  };

  const onAiPass = async () => {
    if (!selectedItemId) return;
    setAiPassRunning(true);
    try {
      const r = await api.mlPublicationKnowledge.aiStalenessPass(selectedItemId);
      if (r.note) {
        toast.info(r.note);
      } else {
        toast.success(`Pasada IA: ${r.processed} evaluadas, ${r.flagged} marcadas como dudosas (score < 0.7)`);
      }
      await loadItem(selectedItemId);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Falló la pasada de IA");
    } finally {
      setAiPassRunning(false);
    }
  };

  const onCurate = async (rowId: string, action: 'keep' | 'edit' | 'discard', payload?: { curatedAnswer?: string; stalenessFlag?: string }) => {
    setBusy((prev) => ({ ...prev, [rowId]: true }));
    try {
      await api.mlPublicationKnowledge.curate(rowId, { action, ...payload });
      toast.success(action === 'keep' ? 'Validada' : action === 'edit' ? 'Editada' : 'Descartada');
      if (selectedItemId) await loadItem(selectedItemId);
      await loadSummary();
      if (action === 'edit') { setEditingId(null); setEditText(""); }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "No se pudo curar");
    } finally {
      setBusy((prev) => ({ ...prev, [rowId]: false }));
    }
  };

  const grouped = useMemo(() => {
    if (!summary) return null;
    return [...summary].sort((a, b) => b.pending - a.pending);
  }, [summary]);

  if (!isAllowed) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 text-white">
          <LibraryBooksIcon sx={{ fontSize: 20 }} />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Base de conocimiento por publicación</h1>
          <p className="text-xs text-slate-500">
            Ingestá el histórico de Q&A de cada publicación de Mercado Libre y curá las respuestas. El agente, en modo cerrado, va a responder usando sólo este material curado + la ficha de la publicación.
          </p>
        </div>
      </div>

      <section className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">
          Ingestar histórico
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.5fr_180px_auto]">
          <Input
            value={newItemId}
            onChange={(e) => setNewItemId(e.target.value)}
            placeholder="MLA item ID (ej. MLA1234567890)"
            data-testid="ml-knowledge-item-id"
            className="h-10"
            onKeyDown={(e) => { if (e.key === 'Enter') void onIngest(); }}
          />
          <select
            value={accountKey}
            onChange={(e) => setAccountKey(e.target.value as any)}
            data-testid="ml-knowledge-account"
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="mercadolibre">Cuenta 1</option>
            <option value="mercadolibre_cuenta2">Cuenta 2</option>
          </select>
          <button
            type="button"
            onClick={onIngest}
            disabled={ingesting || !newItemId.trim()}
            data-testid="ml-knowledge-ingest"
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-4 text-xs font-semibold text-white shadow-sm hover:brightness-105 disabled:opacity-60"
          >
            <DownloadIcon sx={{ fontSize: 14 }} />
            {ingesting ? "Ingestando…" : "Ingestar"}
          </button>
        </div>
      </section>

      <section>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Publicaciones ingestadas
        </p>
        {grouped === null ? (
          <Skeleton className="h-48 w-full rounded-xl" />
        ) : grouped.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-8 text-center text-xs text-slate-500" data-testid="ml-knowledge-empty">
            Todavía no ingestaste ninguna publicación. Pegá un MLA arriba para empezar.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2" data-testid="ml-knowledge-summary">
            {grouped.map((s) => {
              const isSelected = s.itemId === selectedItemId;
              return (
                <li key={`${s.itemId}__${s.accountKey}`}>
                  <button
                    type="button"
                    onClick={() => void loadItem(s.itemId)}
                    data-testid={`ml-knowledge-card-${s.itemId}`}
                    className={
                      "w-full rounded-xl border bg-white p-3 text-left transition-colors " +
                      (isSelected ? "border-blue-500 ring-2 ring-blue-200" : "border-slate-200 hover:border-slate-300")
                    }
                  >
                    <p className="font-mono text-sm font-semibold text-slate-900">{s.itemId}</p>
                    <p className="text-[10px] uppercase tracking-wider text-slate-400">
                      {s.accountKey === 'mercadolibre' ? 'cuenta 1' : 'cuenta 2'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px]">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700">{s.total} total</span>
                      {s.pending > 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">{s.pending} pendientes</span>}
                      {s.kept > 0 && <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800">{s.kept} validadas</span>}
                      {s.edited > 0 && <span className="rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-800">{s.edited} editadas</span>}
                      {s.discarded > 0 && <span className="rounded bg-slate-200 px-1.5 py-0.5 font-semibold text-slate-600">{s.discarded} descartadas</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {selectedItemId && (
        <section>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Q&A de {selectedItemId}
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onAiPass}
                disabled={aiPassRunning}
                data-testid="ml-knowledge-ai-pass"
                title="Corre Haiku sobre cada Q&A pendiente y marca cuáles quedaron desactualizadas comparándolas con la ficha actual de la publicación"
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 text-[11px] font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-60"
              >
                <AutoAwesomeIcon sx={{ fontSize: 13 }} className={aiPassRunning ? 'animate-pulse' : ''} />
                {aiPassRunning ? 'Evaluando con IA…' : 'Pasada IA'}
              </button>
              <button
                type="button"
                onClick={onAutoKeep}
                disabled={autoKeepRunning}
                data-testid="ml-knowledge-auto-keep"
                title="Auto-marca como 'validadas' las pendientes con score IA >= 70% (las dudosas quedan para revisión manual)"
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
              >
                <CheckIcon sx={{ fontSize: 13 }} />
                {autoKeepRunning ? 'Validando…' : 'Auto-validar ≥ 70%'}
              </button>
              <a
                href={`https://articulo.mercadolibre.com.ar/${selectedItemId.replace(/^([A-Z]{3})(\d+)$/, '$1-$2')}-_JM`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:underline"
              >
                <OpenInNewIcon sx={{ fontSize: 12 }} />
                Abrir publicación
              </a>
            </div>
          </div>
          {rows === null ? (
            <Skeleton className="h-64 w-full rounded-xl" />
          ) : rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-6 text-center text-xs text-slate-500">
              La ingesta no devolvió Q&A para esta publicación.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="ml-knowledge-rows">
              {rows.map((r) => {
                const isEditing = editingId === r.id;
                const pill = STATUS_PILL(r.curationStatus);
                const effectiveAnswer = r.curatedAnswer ?? r.answerText ?? '';
                return (
                  <li
                    key={r.id}
                    data-testid={`ml-knowledge-row-${r.id}`}
                    className="rounded-xl border border-slate-200 bg-white p-3 space-y-2"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[11px] text-slate-500">
                        Pregunta del {fmtDate(r.questionAt)}{r.answeredAt && ` · respondida ${fmtDate(r.answeredAt)}`}
                      </p>
                      <div className="flex items-center gap-1.5">
                        {r.aiValidityScore != null && (
                          <span
                            className={
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                              (r.aiValidityScore >= 0.7
                                ? 'bg-emerald-100 text-emerald-800'
                                : r.aiValidityScore >= 0.4
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-rose-100 text-rose-800')
                            }
                            title={r.aiNote ?? undefined}
                          >
                            IA {(r.aiValidityScore * 100).toFixed(0)}%
                          </span>
                        )}
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${pill.cls}`}>
                          {pill.label}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm font-medium text-slate-900">{r.questionText}</p>
                    {r.aiNote && r.aiValidityScore != null && r.aiValidityScore < 0.7 && (
                      <p className="rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-900 border border-amber-200">
                        <strong>IA:</strong> {r.aiNote}
                      </p>
                    )}
                    {isEditing ? (
                      <div className="space-y-1.5">
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="block w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          rows={4}
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => { setEditingId(null); setEditText(""); }}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => void onCurate(r.id, 'edit', { curatedAnswer: editText })}
                            disabled={!!busy[r.id] || editText.trim().length === 0}
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                          >
                            Guardar edición
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="rounded-lg bg-slate-50 p-2 text-sm text-slate-700 whitespace-pre-wrap">
                        {effectiveAnswer || <span className="text-slate-400 italic">sin respuesta registrada</span>}
                      </p>
                    )}
                    {!isEditing && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void onCurate(r.id, 'keep')}
                          disabled={!!busy[r.id]}
                          data-testid={`ml-knowledge-keep-${r.id}`}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                        >
                          <CheckIcon sx={{ fontSize: 14 }} />
                          Validar
                        </button>
                        <button
                          type="button"
                          onClick={() => { setEditingId(r.id); setEditText(effectiveAnswer); }}
                          disabled={!!busy[r.id]}
                          data-testid={`ml-knowledge-edit-${r.id}`}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-60"
                        >
                          <EditIcon sx={{ fontSize: 14 }} />
                          Editar respuesta
                        </button>
                        <button
                          type="button"
                          onClick={() => { if (window.confirm("¿Descartar esta Q&A? No se va a usar para entrenar al agente.")) void onCurate(r.id, 'discard', { stalenessFlag: 'irrelevant' }); }}
                          disabled={!!busy[r.id]}
                          data-testid={`ml-knowledge-discard-${r.id}`}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                        >
                          <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                          Descartar
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
