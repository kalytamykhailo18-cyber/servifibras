"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type MlQaRow, type MlQaCounts } from "@/lib/api/endpoints";
import { safeFormatDistanceToNow } from "@/lib/date";
import { toast } from "sonner";
import StorefrontIcon from "@mui/icons-material/Storefront";
import RefreshIcon from "@mui/icons-material/Refresh";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import LaunchIcon from "@mui/icons-material/Launch";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
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
import EditNoteIcon from "@mui/icons-material/EditNote";
import TimerOutlinedIcon from "@mui/icons-material/TimerOutlined";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import UndoIcon from "@mui/icons-material/Undo";
import MenuBookIcon from "@mui/icons-material/MenuBookOutlined";
import { PublicationFaqDialog } from "./publication-faq-dialog";
import { MlDraftComposer } from "./ml-draft-composer";

type QaFilter = "all" | "flagged" | "score-le-7" | "score-le-5";

const FILTER_CHIPS: Array<{ id: QaFilter; label: string; tone: string }> = [
  { id: "all",         label: "Todas",        tone: "slate" },
  { id: "flagged",     label: "Marcadas",     tone: "rose" },
  { id: "score-le-7",  label: "Calidad ≤7",   tone: "amber" },
  { id: "score-le-5",  label: "Calidad ≤5",   tone: "red" },
];

function filterToApi(f: QaFilter): { flagged?: boolean; maxScore?: number } {
  switch (f) {
    case "flagged":     return { flagged: true };
    case "score-le-7":  return { maxScore: 7 };
    case "score-le-5":  return { maxScore: 5 };
    default:            return {};
  }
}

function fmtResponseTime(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return `${h} h`;
}

function severeBadge(severeFlag: string, severeReason: string | null) {
  if (!severeFlag || severeFlag === "NONE") return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-rose-100/80 px-2 py-0.5 text-[10px] font-semibold text-rose-700"
      title={severeReason ?? severeFlag}
    >
      <ReportProblemOutlinedIcon sx={{ fontSize: 11 }} />
      {severeFlag.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}

/**
 * Marcos 2026-06-03 PM: dedicated ML Q&A list view, mirrors his other
 * CRM's clean monitoring panel. Each row pairs a customer question
 * with the agent's reply + response-time + quality badge + correction
 * CTA. Originally lived at /mercadolibre; 2026-06-04 Marcos asked to
 * fold it into /conversations as a sub-tab so the sidebar stays light.
 */
type PendingDraft = {
  messageId: string;
  conversationId: string;
  contactName: string | null;
  contactId: string;
  mlQuestionId: string | null;
  mlPackId: string | null;
  mlAccountKey: string | null;
  // Marcos 2026-06-17: 'question' = ML Q&A, 'message' = post-venta DM.
  kind: 'question' | 'message';
  content: string;
  createdAt: string;
  // Marcos 2026-06-12: publication + question context surfaced in the
  // card so the operator can validate the AI draft without leaving
  // the review panel.
  questionText: string | null;
  itemId: string | null;
  itemTitle: string | null;
  itemPermalink: string | null;
};

// Marcos 2026-06-17: open reclamos. Claims escalate to human handoff
// without an AI draft — surfaced from a separate endpoint.
type OpenClaim = {
  conversationId: string;
  messageId: string;
  contactId: string;
  contactName: string | null;
  content: string;
  mlAccountKey: string | null;
  mlResourceId: string | null;
  createdAt: string;
  messageCount: number;
};

export function MercadolibreQaList() {
  const router = useRouter();
  const [rows, setRows] = useState<MlQaRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<QaFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [counts, setCounts] = useState<MlQaCounts | null>(null);
  // Marcos 2026-06-11: pending review drafts. Surfaces when
  // ML_QA_REVIEW_MODE=true server-side — the operator edits / sends
  // each draft to ML before the buyer sees the answer.
  const [drafts, setDrafts] = useState<PendingDraft[]>([]);
  // Marcos 2026-06-17: open reclamos surfaced in the Reclamos sub-tab.
  const [openClaims, setOpenClaims] = useState<OpenClaim[]>([]);
  // Sub-tab inside the ML QA panel. Defaults to Preguntas — switches
  // to whichever section has content on first load so the operator
  // sees something useful immediately even when Preguntas is empty.
  const [mlSubTab, setMlSubTab] = useState<'questions' | 'messages' | 'claims'>('questions');
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const [draftBusy, setDraftBusy] = useState<Record<string, 'send' | 'discard' | null>>({});
  // Marcos 2026-06-12: track which messageIds have a pending
  // server-side save so the textarea can render a subtle "guardado"
  // hint after a debounce flushes. Per-id timer holder.
  const [draftSyncState, setDraftSyncState] = useState<Record<string, 'idle' | 'saving' | 'saved'>>({});
  const draftSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Marcos 2026-06-12: collapse the yellow drafts block (operators
  // sometimes need to scroll the historical Q&A list below without
  // 47 drafts hogging the viewport). State is persisted to localStorage
  // so the operator's choice survives navigations / reloads.
  const [draftsCollapsed, setDraftsCollapsed] = useState<boolean>(false);
  // Bulk-discard window + busy state for the "Limpiar" menu.
  const [bulkBusy, setBulkBusy] = useState<boolean>(false);
  const [showBulkMenu, setShowBulkMenu] = useState<boolean>(false);
  // AI auto-reply toggle (admin-only). null while loading initial state.
  const [autoReplyOn, setAutoReplyOn] = useState<boolean | null>(null);
  const [autoReplyBusy, setAutoReplyBusy] = useState<boolean>(false);
  // Confirmation prompt for the bulk-discard action.
  const [confirmDiscard, setConfirmDiscard] = useState<null | { hours: number; label: string }>(null);
  // Marcos 2026-06-18: librería de respuestas rápidas — cargada una
  // vez en el padre para que los N borradores del panel no disparen
  // N requests idénticos al backend.
  const [sharedQuickReplies, setSharedQuickReplies] = useState<Array<{
    id: string; label: string; body: string; category: string | null;
  }>>([]);
  useEffect(() => {
    let cancelled = false;
    api.conversations
      .listQuickReplies()
      .then((rows) => { if (!cancelled) setSharedQuickReplies(rows as any); })
      .catch(() => { /* degrades silently — composer cae a fetch local */ });
    return () => { cancelled = true; };
  }, []);

  const loadCounts = useCallback(async () => {
    try {
      const c = await api.mercadolibre.qaCounts();
      setCounts(c);
    } catch {
      // non-fatal — chips just render without counts
    }
  }, []);

  const loadDrafts = useCallback(async () => {
    try {
      const [list, claims] = await Promise.all([
        api.mercadolibre.pendingDrafts(100),
        api.mercadolibre.openClaims(100).catch(() => [] as OpenClaim[]),
      ]);
      setDrafts(list);
      setOpenClaims(claims);
    } catch {
      setDrafts([]);
      setOpenClaims([]);
    }
  }, []);

  // Marcos 2026-06-12: debounced save of edits to the pending draft.
  // 1.5s after the operator stops typing, the current text gets
  // PUT'd into the backend so leaving the panel + coming back
  // doesn't blow away their work.
  const flushDraftEdit = useCallback(async (messageId: string, text: string) => {
    setDraftSyncState((prev) => ({ ...prev, [messageId]: 'saving' }));
    try {
      await api.mercadolibre.updateDraftText(messageId, text);
      setDraftSyncState((prev) => ({ ...prev, [messageId]: 'saved' }));
    } catch {
      setDraftSyncState((prev) => ({ ...prev, [messageId]: 'idle' }));
    }
  }, []);
  const onDraftEdit = useCallback((messageId: string, text: string) => {
    setDraftEdits((prev) => ({ ...prev, [messageId]: text }));
    setDraftSyncState((prev) => ({ ...prev, [messageId]: 'idle' }));
    const t = draftSaveTimers.current[messageId];
    if (t) clearTimeout(t);
    draftSaveTimers.current[messageId] = setTimeout(() => {
      if (text.trim().length === 0) return;
      void flushDraftEdit(messageId, text);
    }, 1500);
  }, [flushDraftEdit]);
  // On unmount, flush any pending timers so a fast nav-away still saves.
  useEffect(() => () => {
    const timers = draftSaveTimers.current;
    for (const id of Object.keys(timers)) {
      const t = timers[id];
      if (t) {
        clearTimeout(t);
        const text = draftEdits[id];
        if (text && text.trim().length > 0) {
          void api.mercadolibre.updateDraftText(id, text).catch(() => {});
        }
      }
    }
  // intentionally empty deps — we want the cleanup at strict unmount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const releaseDraft = useCallback(async (d: PendingDraft) => {
    setDraftBusy((prev) => ({ ...prev, [d.messageId]: 'send' }));
    try {
      const edited = (draftEdits[d.messageId] ?? d.content).trim();
      await api.mercadolibre.releaseDraft(d.messageId, edited);
      toast.success('Respuesta enviada a Mercado Libre');
      setDrafts((prev) => prev.filter((x) => x.messageId !== d.messageId));
      setDraftEdits((prev) => { const next = { ...prev }; delete next[d.messageId]; return next; });
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? 'No se pudo enviar la respuesta');
    } finally {
      setDraftBusy((prev) => ({ ...prev, [d.messageId]: null }));
    }
  }, [draftEdits]);

  const discardDraft = useCallback(async (d: PendingDraft) => {
    setDraftBusy((prev) => ({ ...prev, [d.messageId]: 'discard' }));
    try {
      await api.mercadolibre.discardDraft(d.messageId);
      toast.success('Borrador descartado');
      setDrafts((prev) => prev.filter((x) => x.messageId !== d.messageId));
      setDraftEdits((prev) => { const next = { ...prev }; delete next[d.messageId]; return next; });
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? 'No se pudo descartar');
    } finally {
      setDraftBusy((prev) => ({ ...prev, [d.messageId]: null }));
    }
  }, []);

  // Debounce the search input so we don't hammer the backend on every
  // keystroke. 350 ms is the sweet spot — instant-feeling without
  // wasting cycles.
  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(searchInput), 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    try {
      const apiParams = filterToApi(filter);
      const data = await api.mercadolibre.listQa({
        limit: 100,
        ...apiParams,
        search: searchDebounced || undefined,
      });
      setRows(data);
    } catch (err: any) {
      toast.error(err?.message || "No se pudo cargar el panel de MercadoLibre");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, searchDebounced]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Keep counts in sync with the filter chip clicks + the row-level
  // toggleReviewed action below — we refresh counts after each row
  // mutation so the Marcadas chip ticks down as Marcos works through
  // the queue.
  useEffect(() => {
    void loadCounts();
    void loadDrafts();
  }, [loadCounts, loadDrafts]);

  // Marcos 2026-06-12: hydrate collapse state + AI auto-reply state
  // on mount. Both lookups are best-effort; failures fall back to
  // sensible defaults (expanded / null → button hidden).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const v = window.localStorage.getItem('ml-qa-drafts-collapsed');
      if (v === '1') setDraftsCollapsed(true);
    } catch { /* ignore */ }
    (async () => {
      try {
        const m = await api.mercadolibre.getAiMode();
        setAutoReplyOn(!!m?.autoReplyEnabled);
      } catch {
        setAutoReplyOn(null);
      }
    })();
  }, []);
  const toggleDraftsCollapsed = useCallback(() => {
    setDraftsCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem('ml-qa-drafts-collapsed', next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const toggleAutoReply = useCallback(async () => {
    if (autoReplyOn === null) return;
    setAutoReplyBusy(true);
    try {
      const next = !autoReplyOn;
      const r = await api.mercadolibre.setAiMode(next);
      setAutoReplyOn(!!r?.autoReplyEnabled);
      toast.success(r?.autoReplyEnabled ? 'IA activada — responde automáticamente' : 'IA en revisión — cada respuesta espera tu OK');
    } catch (err: any) {
      toast.error(err?.message ?? 'No se pudo cambiar el modo');
    } finally {
      setAutoReplyBusy(false);
    }
  }, [autoReplyOn]);
  const doBulkDiscard = useCallback(async (hours: number) => {
    setBulkBusy(true);
    setShowBulkMenu(false);
    try {
      const r = await api.mercadolibre.bulkDiscardDrafts(hours);
      toast.success(`${r.discarded} borrador${r.discarded === 1 ? '' : 'es'} descartado${r.discarded === 1 ? '' : 's'}`);
      void loadDrafts();
    } catch (err: any) {
      toast.error(err?.message ?? 'No se pudo limpiar');
    } finally {
      setBulkBusy(false);
      setConfirmDiscard(null);
    }
  }, [loadDrafts]);

  // Marcos 2026-06-11: poll the pending drafts list every minute so
  // new questions held back by ML_QA_REVIEW_MODE surface without a
  // manual refresh.
  useEffect(() => {
    const t = window.setInterval(() => void loadDrafts(), 60_000);
    return () => window.clearInterval(t);
  }, [loadDrafts]);

  // "Crear FAQ desde Q&A" — Bloque E item 3. Opens a dialog seeded with
  // the buyer's question text so the operator can save a canned answer
  // for that ML item; the inbound handler then replies instantly the
  // next time the same Q is asked, without a Claude call.
  const [faqDialogRow, setFaqDialogRow] = useState<MlQaRow | null>(null);

  // Per-row "Marcar OK" / "Volver a marcar" — Marcos 2026-06-04:
  // clicking marks the row reviewed so it leaves the Marcadas queue.
  // Re-clicking on a reviewed row re-flags it. Optimistic update: we
  // patch local state immediately and reconcile from the backend.
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);
  const toggleReviewed = useCallback(
    async (row: MlQaRow) => {
      if (pendingRowId) return;
      const wasReviewed = row.quality.reviewedAt != null;
      setPendingRowId(row.conversationId);
      try {
        if (wasReviewed) {
          await api.quality.unmarkReviewed(row.conversationId);
          toast.success("Volvimos a marcar la pregunta para revisión");
        } else {
          await api.quality.markReviewed(row.conversationId);
          toast.success("Marcada como revisada — sale de la cola");
        }
        // Refetch to reflect the new state under the current filter.
        // If we're on "Marcadas", a just-reviewed row will disappear;
        // a just-unmarked row reappears. Also refresh the chip counts
        // so the Marcadas badge ticks down/up as Marcos works through.
        await Promise.all([load(), loadCounts()]);
      } catch (err: any) {
        toast.error(err?.message || "No se pudo actualizar el estado");
      } finally {
        setPendingRowId(null);
      }
    },
    [pendingRowId, load],
  );

  return (
    <div className="space-y-4">
      {/* Marcos 2026-06-11: pending review drafts (review mode on
          the backend). Each card shows the buyer-side question and
          the agent's draft, editable; Enviar a ML libera la
          respuesta. Hidden when no drafts/messages/claims pending.
          Marcos 2026-06-17: three sub-tabs (Preguntas / Mensajes /
          Reclamos) because each operates on a different ML surface
          and the operator wants the counts split out. */}
      {(() => {
        const questions = drafts.filter((d) => d.kind === 'question');
        const messages = drafts.filter((d) => d.kind === 'message');
        const claims = openClaims;
        const totalPending = questions.length + messages.length + claims.length;
        if (totalPending === 0) return null;
        const visibleDrafts = mlSubTab === 'questions'
          ? questions
          : mlSubTab === 'messages'
            ? messages
            : [];
        const headerCount = mlSubTab === 'questions'
          ? questions.length
          : mlSubTab === 'messages'
            ? messages.length
            : claims.length;
        const headerLabel = mlSubTab === 'questions'
          ? (headerCount === 1 ? 'pregunta pendiente de revisión' : 'preguntas pendientes de revisión')
          : mlSubTab === 'messages'
            ? (headerCount === 1 ? 'mensaje pendiente de revisión' : 'mensajes pendientes de revisión')
            : (headerCount === 1 ? 'reclamo abierto' : 'reclamos abiertos');
        return (
      <>
      <div className="rounded-2xl border border-amber-200/80 bg-amber-50/60 p-3">
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-amber-200 bg-white/60 p-1" data-testid="ml-qa-subtabs">
          {([
            { id: 'questions' as const, label: 'Preguntas', count: questions.length, activeBg: 'bg-amber-500 text-white' },
            { id: 'messages'  as const, label: 'Mensajes',  count: messages.length,  activeBg: 'bg-blue-600 text-white' },
            { id: 'claims'    as const, label: 'Reclamos',  count: claims.length,    activeBg: 'bg-rose-600 text-white' },
          ]).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setMlSubTab(t.id)}
              data-testid={`ml-qa-subtab-${t.id}`}
              className={
                'flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ' +
                (mlSubTab === t.id ? t.activeBg : 'text-slate-600 hover:text-slate-900')
              }
            >
              {t.label}
              {t.count > 0 && (
                <span
                  data-testid={`ml-qa-subtab-${t.id}-count`}
                  className={
                    'inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums ' +
                    (mlSubTab === t.id ? 'bg-white/25 text-white' : 'bg-rose-600 text-white')
                  }
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      {mlSubTab === 'claims' ? (
        <div className="rounded-2xl border border-rose-200/80 bg-rose-50/60 p-4 space-y-3" data-testid="ml-pending-claims">
          {claims.length === 0 ? (
            <p className="text-center text-xs text-rose-700/80">No hay reclamos abiertos en este momento.</p>
          ) : (
            <ul className="space-y-2">
              {claims.map((c) => (
                <li
                  key={c.messageId}
                  className="rounded-xl border border-rose-200 bg-white p-3"
                  data-testid={`ml-pending-claim-${c.messageId}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-rose-900">
                      {c.contactName || 'Comprador'}
                      {c.mlResourceId && (
                        <span className="ml-2 font-mono text-[11px] font-normal text-rose-700">
                          #{c.mlResourceId.split('/').pop()}
                        </span>
                      )}
                      {c.messageCount > 1 && (
                        <span className="ml-2 inline-flex h-4 items-center rounded-full bg-rose-100 px-1.5 text-[10px] font-semibold text-rose-700">
                          {c.messageCount} actualizaciones
                        </span>
                      )}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!window.confirm('¿Marcar este reclamo como resuelto? Se saca del panel.')) return;
                          try {
                            await api.mercadolibre.resolveClaim(c.conversationId);
                            toast.success('Reclamo marcado como resuelto');
                            await loadDrafts();
                          } catch (err: any) {
                            toast.error(err?.response?.data?.error || 'No se pudo marcar');
                          }
                        }}
                        data-testid={`ml-pending-claim-resolve-${c.messageId}`}
                        className="rounded-lg border border-rose-300 bg-white px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        Resuelto
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push(`/conversations/${c.conversationId}`)}
                        data-testid={`ml-pending-claim-open-${c.messageId}`}
                        className="rounded-lg bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-700"
                      >
                        Abrir
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-rose-900/80">{c.content}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      </>
        );
      })()}
      {/* Original drafts block — now only rendered when the active
          sub-tab is questions or messages, since claims have their
          own surface above. */}
      {drafts.length > 0 && mlSubTab !== 'claims' && (
        <div
          data-testid="ml-pending-drafts"
          className="rounded-2xl border border-amber-200/80 bg-amber-50/60 p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={toggleDraftsCollapsed}
              data-testid="ml-pending-drafts-toggle"
              aria-expanded={!draftsCollapsed}
              className="inline-flex items-center gap-1.5 text-left text-sm font-semibold text-amber-900 hover:text-amber-950"
            >
              {draftsCollapsed
                ? <ChevronRightIcon sx={{ fontSize: 18 }} className="text-amber-700" />
                : <ExpandMoreIcon sx={{ fontSize: 18 }} className="text-amber-700" />}
              {(() => {
                const subDrafts = drafts.filter((d) => d.kind === (mlSubTab === 'messages' ? 'message' : 'question'));
                const n = subDrafts.length;
                const label = mlSubTab === 'messages'
                  ? (n === 1 ? 'mensaje pendiente de revisión' : 'mensajes pendientes de revisión')
                  : (n === 1 ? 'pregunta pendiente de revisión' : 'preguntas pendientes de revisión');
                return `${n} ${label}`;
              })()}
            </button>
            <div className="flex flex-wrap items-center gap-2">
              {/* AI auto-reply toggle — admin sees it once the
                  /qa/ai-mode probe has come back. We hide it for
                  non-admins by not rendering when the API throws,
                  but the backend gates it too. */}
              {autoReplyOn !== null && (
                <button
                  type="button"
                  onClick={() => void toggleAutoReply()}
                  disabled={autoReplyBusy}
                  data-testid="ml-qa-ai-toggle"
                  aria-pressed={autoReplyOn}
                  className={
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-semibold transition-colors disabled:opacity-60 " +
                    (autoReplyOn
                      ? "border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                      : "border-amber-400 bg-white text-amber-800 hover:bg-amber-50")
                  }
                  title={autoReplyOn ? "La IA responde automáticamente. Apretá para pasar a revisión." : "Cada respuesta espera tu OK. Apretá para activar la IA."}
                >
                  <span className={
                    "inline-block h-2 w-2 rounded-full " +
                    (autoReplyOn ? "bg-emerald-500" : "bg-amber-500")
                  } />
                  {autoReplyOn ? 'IA activa' : 'IA en revisión'}
                </button>
              )}
              {/* Limpiar — three windows; "todos" is the explicit
                  flush. The dropdown is hover-free, just a tap to
                  open and tap an item. */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowBulkMenu((s) => !s)}
                  disabled={bulkBusy}
                  data-testid="ml-qa-bulk-discard"
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-amber-300 bg-white px-3 text-[11px] font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-60"
                >
                  <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                  {bulkBusy ? 'Limpiando…' : 'Limpiar'}
                  <ExpandMoreIcon sx={{ fontSize: 14 }} />
                </button>
                {showBulkMenu && (
                  <div
                    data-testid="ml-qa-bulk-discard-menu"
                    className="absolute right-0 top-9 z-10 w-56 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
                  >
                    {[
                      { hours: 168, label: 'Más de 7 días' },
                      { hours: 24,  label: 'Más de 24 horas' },
                      { hours: 0,   label: 'Todos los borradores' },
                    ].map((opt) => (
                      <button
                        key={opt.hours}
                        type="button"
                        onClick={() => { setShowBulkMenu(false); setConfirmDiscard(opt); }}
                        data-testid={`ml-qa-bulk-discard-${opt.hours}`}
                        className="block w-full rounded-lg px-3 py-2 text-left text-xs text-slate-700 hover:bg-amber-50 hover:text-amber-800"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          {!draftsCollapsed && (
            <p className="text-[11px] text-amber-700/80">
              El agente preparó la respuesta. Editá si querés y enviá a Mercado Libre.
            </p>
          )}
          {!draftsCollapsed && (
          <ul className="space-y-3">
            {drafts.filter((d) => d.kind === (mlSubTab === 'messages' ? 'message' : 'question')).map((d) => {
              const text = draftEdits[d.messageId] ?? d.content;
              const busy = draftBusy[d.messageId] ?? null;
              return (
                <li
                  key={d.messageId}
                  data-testid="ml-pending-draft-card"
                  className="rounded-xl border border-amber-200/70 bg-white/90 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>
                      {d.contactName ?? 'comprador'} · {d.mlAccountKey === 'mercadolibre_cuenta2' ? 'cuenta 2' : 'cuenta 1'}
                    </span>
                    <span className="font-mono">{d.mlQuestionId ?? 'sin id'}</span>
                  </div>
                  {/* Marcos 2026-06-12: surface the publication +
                      buyer question above the AI draft so the
                      operator can validate the answer before
                      releasing. itemTitle from cache when warm; bare
                      MLA id + permalink when cold. */}
                  {d.itemId && (
                    <div
                      data-testid="ml-draft-publication"
                      className="flex items-center gap-2 rounded-md border border-amber-200/60 bg-amber-50/40 px-2 py-1 text-[12px] text-amber-900"
                    >
                      <span className="text-amber-700">Publicación:</span>
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {d.itemTitle ?? d.itemId}
                      </span>
                      {d.itemPermalink && (
                        <a
                          href={d.itemPermalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid="ml-draft-publication-link"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 underline-offset-2 hover:underline"
                        >
                          Abrir
                          <LaunchIcon sx={{ fontSize: 11 }} />
                        </a>
                      )}
                    </div>
                  )}
                  {d.questionText && (
                    <div
                      data-testid="ml-draft-question"
                      className="rounded-md border border-slate-200 bg-slate-50/60 px-2 py-1.5 text-[12px] leading-relaxed text-slate-700"
                    >
                      <span className="mr-1 font-semibold text-slate-500">Pregunta:</span>
                      {d.questionText}
                    </div>
                  )}
                  <MlDraftComposer
                    draftId={d.messageId}
                    value={text}
                    onChange={(next) => onDraftEdit(d.messageId, next)}
                    onBlur={() => {
                      // Force-flush the pending save when the
                      // operator tabs / clicks away. The timer is
                      // 1.5s and they may navigate before then.
                      const t = draftSaveTimers.current[d.messageId];
                      if (t) {
                        clearTimeout(t);
                        if (text.trim().length > 0) void flushDraftEdit(d.messageId, text);
                      }
                    }}
                    disabled={!!busy}
                    quickReplies={sharedQuickReplies}
                  />
                  {/* Save-state hint. Stays invisible until the operator
                      starts typing, switches to "guardando…" while the
                      patch is in flight, then to "guardado" once it
                      lands. */}
                  {(draftSyncState[d.messageId] === 'saving' || draftSyncState[d.messageId] === 'saved') && (
                    <p
                      data-testid={`ml-draft-sync-${d.messageId}`}
                      className="-mt-1 text-[10px] font-medium text-amber-700/80"
                    >
                      {draftSyncState[d.messageId] === 'saving' ? 'guardando…' : 'guardado'}
                    </p>
                  )}
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => void discardDraft(d)}
                      disabled={!!busy}
                      data-testid="ml-draft-discard"
                      className="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {busy === 'discard' ? '…' : 'Descartar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void releaseDraft(d)}
                      disabled={!!busy || text.trim().length === 0}
                      data-testid="ml-draft-release"
                      className="inline-flex h-8 items-center rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {busy === 'send' ? 'Enviando…' : 'Enviar a Mercado Libre'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          )}
        </div>
      )}

      {confirmDiscard && (
        <AlertDialog open={true} onOpenChange={(v) => { if (!v) setConfirmDiscard(null); }}>
          <AlertDialogContent data-testid="ml-qa-bulk-discard-confirm">
            <AlertDialogHeader>
              <AlertDialogTitle>Descartar borradores</AlertDialogTitle>
              <AlertDialogDescription>
                Vas a descartar {confirmDiscard.label.toLowerCase()}. Esta acción no se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => setConfirmDiscard(null)}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              >
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void doBulkDiscard(confirmDiscard.hours)}
                data-testid="ml-qa-bulk-discard-confirm-yes"
                className="inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-amber-600 to-orange-500 px-5 text-sm font-medium text-white hover:-translate-y-0.5 transition"
              >
                Descartar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Preguntas en publicaciones, en orden de respuesta. Tocá &quot;Corregir&quot; para
          reescribir cualquier respuesta y guardarla como ejemplo.
        </p>
        <button
          type="button"
          onClick={() => {
            setRefreshing(true);
            void load();
          }}
          disabled={refreshing}
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] disabled:opacity-60"
        >
          <RefreshIcon sx={{ fontSize: 14 }} className={`text-blue-600 ${refreshing ? "animate-spin" : ""}`} />
          Recargar
        </button>
      </div>

      {/* FILTER CHIPS + SEARCH — Marcos 2026-06-04 ask: jump straight
          to the low-quality / flagged replies to review and correct. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5" data-testid="mercadolibre-qa-filters">
          {FILTER_CHIPS.map((chip) => {
            const isActive = filter === chip.id;
            const chipCount = counts
              ? chip.id === "all"
                ? counts.all
                : chip.id === "flagged"
                  ? counts.flagged
                  : chip.id === "score-le-7"
                    ? counts.scoreLe7
                    : chip.id === "score-le-5"
                      ? counts.scoreLe5
                      : null
              : null;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setFilter(chip.id)}
                data-testid={`mercadolibre-qa-filter-${chip.id}`}
                aria-pressed={isActive}
                className={
                  "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors " +
                  (isActive
                    ? chip.tone === "rose"
                      ? "border-rose-300 bg-rose-50 text-rose-700"
                      : chip.tone === "amber"
                        ? "border-amber-300 bg-amber-50 text-amber-700"
                        : chip.tone === "red"
                          ? "border-red-300 bg-red-50 text-red-700"
                          : "border-slate-400 bg-slate-100 text-slate-800"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50")
                }
              >
                <span>{chip.label}</span>
                {chipCount != null && (
                  <span
                    className={
                      "inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums " +
                      (isActive
                        ? chip.tone === "rose"
                          ? "bg-rose-200/70 text-rose-800"
                          : chip.tone === "amber"
                            ? "bg-amber-200/70 text-amber-800"
                            : chip.tone === "red"
                              ? "bg-red-200/70 text-red-800"
                              : "bg-slate-300/70 text-slate-800"
                        : "bg-slate-100 text-slate-500")
                    }
                  >
                    {chipCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="relative ml-auto min-w-0 flex-1 max-w-sm">
          <SearchIcon sx={{ fontSize: 16 }} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar en pregunta o respuesta…"
            data-testid="mercadolibre-qa-search"
            className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput("")}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <CloseIcon sx={{ fontSize: 14 }} />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-100/70" />
          ))}
        </div>
      ) : !rows || rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-12 text-center">
          <HelpOutlineIcon sx={{ fontSize: 32 }} className="text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-600">Sin preguntas todavía</p>
          <p className="mt-1 text-xs text-slate-400">
            Cuando un comprador haga una pregunta en una publicación de ML, va a aparecer acá.
          </p>
        </div>
      ) : (
        <ul className="space-y-3" data-testid="mercadolibre-qa-list">
          {rows.map((row) => (
            <li
              key={row.question.id}
              data-testid="mercadolibre-qa-row"
              className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-shadow duration-200 hover:shadow-[0_8px_24px_-12px_rgb(15_23_42/0.18)]"
            >
              <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-[260px_minmax(0,1fr)_180px] lg:items-stretch">
                {/* LEFT — publication */}
                <div className="flex items-start gap-3">
                  <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    {row.publication.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={row.publication.thumbnail} alt="" className="h-full w-full object-contain" />
                    ) : (
                      <StorefrontIcon sx={{ fontSize: 28 }} className="text-slate-300" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug text-slate-900 line-clamp-2">
                      {row.publication.title ?? "Publicación sin contexto"}
                    </p>
                    {row.publication.itemId && (
                      <p className="mt-1 font-mono text-[10px] text-slate-400">#{row.publication.itemId}</p>
                    )}
                    {row.publication.permalink && (
                      <a
                        href={row.publication.permalink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-yellow-700 hover:underline"
                      >
                        Ver publicación
                        <OpenInNewIcon sx={{ fontSize: 11 }} />
                      </a>
                    )}
                  </div>
                </div>

                {/* MIDDLE — Q + A */}
                <div className="space-y-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        Pregunta
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {row.buyer.name ?? row.buyer.mlUserId ?? "comprador"} ·{" "}
                        {safeFormatDistanceToNow(row.question.at)}
                      </p>
                    </div>
                    <p className="text-sm leading-relaxed text-slate-800">{row.question.text}</p>
                  </div>
                  {row.reply ? (
                    <div className="rounded-xl border border-blue-200/80 bg-blue-50/60 p-3">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-700">
                          Respuesta del agente {row.reply.bySender === "ADMIN" ? "(operador)" : ""}
                        </p>
                        <p className="text-[10px] text-slate-400">{safeFormatDistanceToNow(row.reply.at)}</p>
                      </div>
                      <p className="whitespace-pre-line text-sm leading-relaxed text-slate-800">{row.reply.text}</p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 p-3">
                      <p className="text-xs font-medium text-amber-800">Aún sin respuesta</p>
                    </div>
                  )}
                </div>

                {/* RIGHT — meta + actions */}
                <div className="flex flex-col items-stretch justify-between gap-3 border-l-0 lg:border-l lg:border-slate-100 lg:pl-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs text-slate-600">
                      <TimerOutlinedIcon sx={{ fontSize: 14 }} className="text-slate-400" />
                      <span className="font-mono">{fmtResponseTime(row.responseTimeMs)}</span>
                      <span className="text-slate-400">de respuesta</span>
                    </div>
                    {row.quality.score != null && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-slate-500">Calidad:</span>
                        <span
                          className={
                            row.quality.score >= 8
                              ? "font-semibold text-emerald-700"
                              : row.quality.score >= 5
                                ? "font-semibold text-amber-700"
                                : "font-semibold text-rose-700"
                          }
                        >
                          {row.quality.score}/10
                        </span>
                      </div>
                    )}
                    {severeBadge(row.quality.severeFlag, row.quality.severeReason)}
                    {row.quality.reviewedAt && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-100/80 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
                        title={`Marcada como revisada · ${safeFormatDistanceToNow(row.quality.reviewedAt)}`}
                        data-testid="mercadolibre-qa-reviewed-badge"
                      >
                        <CheckCircleOutlineIcon sx={{ fontSize: 11 }} />
                        Revisada
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => router.push(`/conversations/${row.conversationId}`)}
                      data-testid="mercadolibre-qa-correct-btn"
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.18)] transition-colors duration-150 hover:bg-amber-700"
                      title="Abrir la conversación para corregir la respuesta"
                    >
                      <EditNoteIcon sx={{ fontSize: 16 }} />
                      Corregir respuesta
                    </button>
                    {row.publication.itemId && (
                      <button
                        type="button"
                        onClick={() => setFaqDialogRow(row)}
                        data-testid="mercadolibre-qa-create-faq-btn"
                        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 hover:border-amber-300 hover:bg-amber-100"
                        title="Guardar una respuesta predefinida para esta pregunta en esta publicación"
                      >
                        <MenuBookIcon sx={{ fontSize: 14 }} />
                        Crear FAQ
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void toggleReviewed(row)}
                      disabled={pendingRowId === row.conversationId}
                      data-testid="mercadolibre-qa-mark-reviewed-btn"
                      data-reviewed={row.quality.reviewedAt ? "true" : "false"}
                      className={
                        row.quality.reviewedAt
                          ? "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                          : "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 transition-colors duration-150 hover:border-emerald-300 hover:bg-emerald-100 disabled:opacity-60"
                      }
                      title={
                        row.quality.reviewedAt
                          ? "Volver a marcar para revisión"
                          : "Marcar como correcta — sale del filtro Marcadas"
                      }
                    >
                      {row.quality.reviewedAt ? (
                        <>
                          <UndoIcon sx={{ fontSize: 14 }} />
                          Revertir
                        </>
                      ) : (
                        <>
                          <CheckCircleOutlineIcon sx={{ fontSize: 14 }} />
                          Marcar OK
                        </>
                      )}
                    </button>
                  </div>
                  <Link
                    href={`/conversations/${row.conversationId}`}
                    className="text-center text-[11px] text-slate-500 hover:text-slate-700 hover:underline"
                  >
                    Ver hilo completo
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {faqDialogRow?.publication.itemId && (
        <PublicationFaqDialog
          open={!!faqDialogRow}
          onOpenChange={(v) => {
            if (!v) setFaqDialogRow(null);
          }}
          itemId={faqDialogRow.publication.itemId}
          publicationTitle={faqDialogRow.publication.title ?? null}
          seedQuestion={faqDialogRow.question.text}
        />
      )}
    </div>
  );
}
