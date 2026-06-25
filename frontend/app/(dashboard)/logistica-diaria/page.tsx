"use client";

// Bloque C — Marcos 2026-06-06: daily logistics overview page.
// Mirrors the 6-section structure of the picker's Excel:
//   COLECTA 1, COLECTA 2, FLEX 1, FLEX 2, MOTOS, MICROS
// Each row has a checkbox the picker ticks when the order is armado;
// the click persists immediately, the same state shows up in the
// downloaded xlsx the next time the operator hits "Descargar".

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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
import { useRoleGuard } from "@/lib/hooks/use-role-guard";
import {
  api,
  type AggregatedDay,
  type DailySection,
  type DailySectionRow,
} from "@/lib/api/endpoints";
import { UserRole } from "@/types";
import { toast } from "sonner";
import { safeFormatDate } from "@/lib/date";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DownloadIcon from "@mui/icons-material/Download";
import InventoryIcon from "@mui/icons-material/Inventory";
import RefreshIcon from "@mui/icons-material/Refresh";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";

const ROLES = [UserRole.ADMIN, UserRole.LOGISTICA, UserRole.ENCARGADO];

const SECTION_ORDER: DailySection[] = [
  "COLECTA_1",
  "COLECTA_2",
  "FLEX_1",
  "FLEX_2",
  "MOTOS",
  "MICROS",
  "RETIRA_CASEROS",
];

const SECTION_META: Record<DailySection, { label: string; tint: string; rail: string }> = {
  COLECTA_1: { label: "COLECTA 1", tint: "border-blue-200/70 bg-blue-50/30", rail: "bg-gradient-to-b from-blue-500 to-cyan-400" },
  COLECTA_2: { label: "COLECTA 2", tint: "border-indigo-200/70 bg-indigo-50/30", rail: "bg-gradient-to-b from-indigo-500 to-violet-400" },
  FLEX_1: { label: "FLEX 1", tint: "border-emerald-200/70 bg-emerald-50/30", rail: "bg-gradient-to-b from-emerald-500 to-teal-400" },
  FLEX_2: { label: "FLEX 2", tint: "border-teal-200/70 bg-teal-50/30", rail: "bg-gradient-to-b from-teal-500 to-cyan-400" },
  MOTOS: { label: "MOTOS", tint: "border-orange-200/70 bg-orange-50/30", rail: "bg-gradient-to-b from-orange-500 to-amber-400" },
  MICROS: { label: "MICROS", tint: "border-rose-200/70 bg-rose-50/30", rail: "bg-gradient-to-b from-rose-500 to-pink-400" },
  // Marcos 2026-06-10: buyer picks up at the Servifibras Caseros
  // store. TN orders with shipping_pickup_type=pickup auto-land here;
  // ML "Acordá entrega" rows arrive via the per-row manual move.
  RETIRA_CASEROS: { label: "RETIRA CASEROS", tint: "border-violet-200/70 bg-violet-50/30", rail: "bg-gradient-to-b from-violet-500 to-fuchsia-400" },
  // Marcos 2026-06-12: PRFV laminados that just transitioned to
  // LISTA_CORTADA show up here so the picker can dispatch them in
  // the same pass as the rest of the day. Marking dispatched here
  // cascades to the placa's state in the PRFV admin page.
  LAMINADOS_PRFV: { label: "LAMINADOS PRFV", tint: "border-amber-200/70 bg-amber-50/30", rail: "bg-gradient-to-b from-amber-500 to-orange-400" },
};

function todayIsoDay(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function LogisticaDiariaPage() {
  const { isAllowed } = useRoleGuard(ROLES);
  const [date, setDate] = useState<string>(todayIsoDay());
  const [data, setData] = useState<AggregatedDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingRow, setPendingRow] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Bloque B item 2 — Marcos 2026-06-07 PM: expand-in-place. We
  // track expanded rowKeys in a Set so multiple rows can be open
  // simultaneously (the picker may want to compare two orders side-
  // by-side while preparing them).
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  // Marcos 2026-06-10: 3-tab redesign. Pendientes = still on the
  // picker's bench (state ∈ {PENDIENTE, ARMADO} and not dispatched).
  // Listas para despachar = boxes the picker closed and that are
  // waiting for the carrier (state = LISTO and not dispatched).
  // Despachadas = carrier picked them up. Flow forward-only: the
  // picker "envía a despachar" → state=LISTO; once ML/TN flips
  // isDispatched, the row auto-moves to Despachadas.
  const [tab, setTab] = useState<'pendientes' | 'listas' | 'despachadas'>('pendientes');
  // Marcos 2026-06-10: section fold state. Click a section header
  // to collapse it so the picker working on MICROS doesn't have to
  // scroll past 100 COLECTA rows.
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  // Marcos 2026-06-10: flex couriers from /admin/daily-logistica/flex-couriers.
  // Loaded once on mount; lets the dropdown stay in sync with the
  // FLEX_COURIERS env without a redeploy.
  const [flexCouriers, setFlexCouriers] = useState<string[]>([]);
  // Marcos 2026-06-25: edición inline del courier en filas que ya
  // tienen uno asignado. Sin esto, una vez stampeado el courier (o si
  // la fila pasó a Despachadas con courier ya fijo) no había forma de
  // cambiarlo desde el panel — el pill era read-only y el dropdown se
  // escondía. Click en el pill → toggle a dropdown para esa rowKey.
  const [editingCourierRow, setEditingCourierRow] = useState<Set<string>>(new Set());
  // Marcos 2026-06-10: surface the "links favoritos" configured in
  // Settings → Logística at the top of the panel so the armador
  // doesn't have to flip to another tab to reach the carriers'
  // tracking pages, the ML seller dashboard, etc. Loaded once on
  // mount; if the config call errors we silently fall back to no
  // links (the panel still works for everything else).
  const [favLinks, setFavLinks] = useState<Array<{ label: string; url: string }>>([]);
  // Marcos 2026-06-10: per-family pickup cutoff hours. Loaded
  // alongside favLinks from Settings → Logística. The section
  // render uses these to split rows into "para mañana" (above the
  // divider, came in after today's cutoff) and "pueden salir hoy"
  // (below). null/missing → no cutoff banner for that family.
  const [cutoffHours, setCutoffHours] = useState<{
    colecta?: number | null;
    flex?: number | null;
    motos?: number | null;
    micros?: number | null;
  }>({});
  // Marcos 2026-06-10: confirmation dialog for "Eliminar canceladas".
  // Per Marcos: "Una vez que confirma la cancelación, que las pueda
  // borrar" — the archive action must be confirmed (also matches the
  // standing UI rule: never native confirm(), always AlertDialog).
  const [archiveTarget, setArchiveTarget] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.dailyLogistica.aggregate(date);
      setData(result);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "No se pudo cargar la agregación");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date]);

  useEffect(() => {
    if (isAllowed) {
      setLoading(true);
      void load();
    }
  }, [isAllowed, load]);

  // Marcos 2026-06-10: hydrate the FLEX courier dropdown from env.
  useEffect(() => {
    if (!isAllowed) return;
    api.dailyLogistica
      .listFlexCouriers()
      .then((list) => setFlexCouriers(list))
      .catch(() => setFlexCouriers([]));
  }, [isAllowed]);

  // Marcos 2026-06-10: load the favourites configured in Settings
  // → Logística. The Excel header has had these for a while; the
  // operator now also gets them as one-click chips at the top of
  // the panel itself.
  useEffect(() => {
    if (!isAllowed) return;
    api.config
      .getLogistica()
      .then((cfg) => {
        const list = Array.isArray(cfg?.linksFavoritos) ? cfg.linksFavoritos : [];
        // Drop blank rows the admin might have left mid-edit.
        const cleaned = list
          .map((l) => ({ label: (l?.label ?? '').trim(), url: (l?.url ?? '').trim() }))
          .filter((l) => l.label.length > 0 && l.url.length > 0);
        setFavLinks(cleaned);
        const ch = cfg?.cutoffHours ?? {};
        setCutoffHours({
          colecta: typeof ch.colecta === 'number' ? ch.colecta : null,
          flex: typeof ch.flex === 'number' ? ch.flex : null,
          motos: typeof ch.motos === 'number' ? ch.motos : null,
          micros: typeof ch.micros === 'number' ? ch.micros : null,
        });
      })
      .catch(() => { setFavLinks([]); setCutoffHours({}); });
  }, [isAllowed]);

  /**
   * Bloque B item 3.10 — Marcos 2026-06-08: auto-refresh the panel
   * every 5 minutes (env-tunable). Skips while the tab isn't visible
   * so we don't burn ML API quota when nobody's looking.
   */
  useEffect(() => {
    if (!isAllowed) return;
    const intervalMs =
      (Number(process.env.NEXT_PUBLIC_LOGISTICA_AUTO_REFRESH_MIN) || 5) * 60 * 1000;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        setRefreshing(true);
        void load();
      }
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [isAllowed, load]);

  /**
   * Bloque B item 3.10 — search box. Filters rows client-side by
   * customer name, order number (rowKey), product label or note —
   * matches what the picker types into the box. Case-insensitive +
   * accent-insensitive. Empty query = show everything.
   */
  const [searchQuery, setSearchQuery] = useState('');
  const matchesSearch = useCallback(
    (row: DailySectionRow) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      const norm = (s: string | null | undefined) =>
        (s ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
      return (
        norm(row.cliente).includes(q) ||
        norm(row.producto).includes(q) ||
        norm(row.notes).includes(q) ||
        norm(row.rowKey).includes(q) ||
        norm(row.sourceId).includes(q)
      );
    },
    [searchQuery],
  );

  /**
   * Bloque B item 3.6 — Marcos 2026-06-08: forward-only state click.
   * PENDIENTE → ARMADO → LISTO. When the operator wants to revert
   * (misclick), they use the "Revertir" link in the expanded row.
   */
  const advanceState = async (row: DailySectionRow) => {
    if (pendingRow) return;
    setPendingRow(row.rowKey);
    const nextState: 'ARMADO' | 'LISTO' = row.state === 'PENDIENTE' ? 'ARMADO' : 'LISTO';
    // Optimistic update.
    setData((prev) => {
      if (!prev) return prev;
      const next: AggregatedDay = JSON.parse(JSON.stringify(prev));
      for (const sec of SECTION_ORDER) {
        for (const r of next.sections[sec]) {
          if (r.rowKey === row.rowKey) {
            r.state = nextState;
            r.armado = true;
            const now = new Date().toISOString();
            if (nextState === 'ARMADO' && !r.armadoAt) r.armadoAt = now;
            if (nextState === 'LISTO') {
              if (!r.armadoAt) r.armadoAt = now;
              r.listoAt = now;
            }
          }
        }
      }
      return next;
    });
    try {
      await api.dailyLogistica.advanceState(row.rowKey, date);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "No se pudo actualizar el estado");
      await load();
    } finally {
      setPendingRow(null);
    }
  };

  /**
   * Bloque B item 3.8 — Marcos 2026-06-08: per-row notes. Local
   * draft state per rowKey so typing doesn't fight the optimistic
   * reload; saves on blur (the operator types, clicks away, write
   * lands). Empty / blank value clears the note.
   */
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const onNoteChange = (rowKey: string, value: string) => {
    setNoteDrafts((prev) => ({ ...prev, [rowKey]: value }));
  };
  const onNoteCommit = async (row: DailySectionRow) => {
    const draft = noteDrafts[row.rowKey];
    const original = row.notes ?? '';
    if (draft === undefined || draft === original) return;
    try {
      await api.dailyLogistica.setNote(
        row.rowKey,
        date,
        draft.trim().length === 0 ? null : draft,
      );
      await load();
      setNoteDrafts((prev) => {
        const next = { ...prev };
        delete next[row.rowKey];
        return next;
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? 'No se pudo guardar la nota');
    }
  };

  /**
   * Bloque B item 3.7 — toggle a single item's check inside the
   * expanded panel. Optimistic update so the armador sees the tick
   * land immediately, then reconcile with the canonical state from
   * the backend.
   */
  const toggleItemCheck = async (
    row: DailySectionRow,
    itemKey: string,
    checked: boolean,
  ) => {
    // Optimistic flip.
    setData((prev) => {
      if (!prev) return prev;
      const next: AggregatedDay = JSON.parse(JSON.stringify(prev));
      for (const sec of SECTION_ORDER) {
        for (const r of next.sections[sec]) {
          if (r.rowKey === row.rowKey) {
            const set = new Set(r.itemsChecked ?? []);
            if (checked) set.add(itemKey);
            else set.delete(itemKey);
            r.itemsChecked = Array.from(set);
            if (r.state === 'PENDIENTE' && checked) r.state = 'ARMADO';
          }
        }
      }
      return next;
    });
    try {
      await api.dailyLogistica.toggleItemCheck(
        row.rowKey, date, itemKey, checked, row.items.length,
      );
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? 'No se pudo actualizar el item');
      await load();
    }
  };

  const revertRow = async (row: DailySectionRow) => {
    if (pendingRow) return;
    setPendingRow(row.rowKey);
    try {
      await api.dailyLogistica.unmarkArmado(row.rowKey);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "No se pudo revertir");
      await load();
    } finally {
      setPendingRow(null);
    }
  };

  /**
   * Multi-select bulk action — the operator ticks N rows and marks
   * them all ARMADO or LISTO in one click. The selection set is
   * local to the page (never persisted) and gets cleared after a
   * successful bulk write.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const toggleSelected = (rowKey: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());
  const bulkApply = async (targetState: 'ARMADO' | 'LISTO') => {
    if (bulkPending || selected.size === 0) return;
    setBulkPending(true);
    try {
      const r = await api.dailyLogistica.bulkSetState(Array.from(selected), date, targetState);
      const ok = r.created + r.updated;
      if (ok > 0) {
        toast.success(`${ok} fila${ok === 1 ? '' : 's'} → ${targetState}${r.failed.length ? ` (${r.failed.length} con error)` : ''}`);
      }
      // Marcos 2026-06-25: cuando hay rechazos (típicamente "Faltan N
      // items por tildar..."), surface el cliente afectado + motivo
      // concreto en lugar de un genérico "N con error".
      if (r.failed.length > 0) {
        const reasons = (r as any).failedReasons as
          | Array<{ rowKey: string; reason: string }>
          | undefined;
        const labelByKey = new Map<string, string>();
        for (const rows of Object.values(data?.sections ?? {})) {
          for (const row of (rows as any[])) {
            labelByKey.set(row.rowKey, row.clienteName || row.cliente || row.orderRef || row.rowKey);
          }
        }
        const items = (reasons ?? r.failed.map((rk) => ({ rowKey: rk, reason: '' })))
          .slice(0, 3)
          .map((f) => `${labelByKey.get(f.rowKey) ?? f.rowKey}: ${f.reason || 'error'}`);
        const more = r.failed.length > 3 ? ` (+${r.failed.length - 3} más)` : '';
        toast.error(`No se pudieron pasar a ${targetState}:\n${items.join('\n')}${more}`, { duration: 10_000 });
      }
      clearSelection();
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "No se pudo aplicar la acción en lote");
    } finally {
      setBulkPending(false);
    }
  };

  /**
   * Marcos 2026-06-10: bulk-stamp the flex courier on every selected
   * row. Called from the dropdown that shows in the bulk bar when
   * the picker is on the "Listas para despachar" tab. Empty courier
   * value (or "Sin asignar") clears the stamp.
   */
  // Marcos 2026-06-12 (4): the operator picks a courier at the
  // moment they move the row to LISTO. Up to now that pick was
  // only exposed as a bulk action; tucked into the Listas tab
  // header where most operators never noticed it. Now there's an
  // inline dropdown on every Lista row without a flexCourier
  // assigned, so the pick happens per-row with one click and
  // flows straight to the dispatch-stats analytics.
  const setRowCourier = async (rowKey: string, courier: string | null) => {
    try {
      await api.dailyLogistica.setFlexCourier([rowKey], date, courier);
      setData((prev) => {
        if (!prev) return prev;
        const next: AggregatedDay = JSON.parse(JSON.stringify(prev));
        for (const sec of SECTION_ORDER) {
          for (const r of next.sections[sec]) {
            if (r.rowKey === rowKey) r.flexCourier = courier;
          }
        }
        return next;
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "No se pudo asignar el courier");
    }
  };

  const bulkSetCourier = async (courier: string | null) => {
    if (bulkPending) return;
    // Marcos 2026-06-16: previously this returned silently when no
    // rows were checkboxed, which read as "Baires no se etiqueta".
    // Surface the empty-selection state so the operator knows the
    // dropdown needs row selections first.
    if (selected.size === 0) {
      toast.error("Seleccioná al menos una fila para asignarle el courier");
      return;
    }
    setBulkPending(true);
    try {
      const r = await api.dailyLogistica.setFlexCourier(Array.from(selected), date, courier);
      // Marcos 2026-06-25: el backend ahora auto-promove a LISTO cuando
      // se asigna un courier. Si la operación se hizo desde Pendientes,
      // las filas saltan a "Listas para despachar" en el próximo load.
      const courierLabel = courier ?? 'sin courier';
      const promoteHint = courier && tab === 'pendientes'
        ? ' (pasan a Listas para despachar)'
        : '';
      if (r.updated > 0) {
        toast.success(
          `${r.updated} fila${r.updated === 1 ? '' : 's'} → ${courierLabel}${promoteHint}` +
          `${r.failed.length ? ` (${r.failed.length} con error)` : ''}`,
        );
      }
      // Marcos 2026-06-25: cuando una asignación de courier desde
      // Pendientes falla porque el pack tiene items sin tildar, el
      // backend rechaza la auto-promoción a LISTO. Surface el cliente
      // + motivo para que el operador sepa qué pack le falta tildar.
      if (r.failed.length > 0) {
        const reasons = (r as any).failedReasons as
          | Array<{ rowKey: string; reason: string }>
          | undefined;
        const labelByKey = new Map<string, string>();
        for (const rows of Object.values(data?.sections ?? {})) {
          for (const row of (rows as any[])) {
            labelByKey.set(row.rowKey, row.clienteName || row.cliente || row.orderRef || row.rowKey);
          }
        }
        const items = (reasons ?? r.failed.map((rk) => ({ rowKey: rk, reason: '' })))
          .slice(0, 3)
          .map((f) => `${labelByKey.get(f.rowKey) ?? f.rowKey}: ${f.reason || 'error'}`);
        const more = r.failed.length > 3 ? ` (+${r.failed.length - 3} más)` : '';
        toast.error(`No se pudo asignar courier:\n${items.join('\n')}${more}`, { duration: 10_000 });
      }
      clearSelection();
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "No se pudo asignar el courier");
    } finally {
      setBulkPending(false);
    }
  };

  /**
   * Marcos 2026-06-10: dismiss cancelled rows. Single or bulk via
   * the selection set. Backend stamps archivedAt on the
   * LogisticaArmado row; the aggregator drops it from the next
   * refresh. The cancelled-orders module is the long-term home for
   * them (separate view, not built here).
   */
  /**
   * Marcos 2026-06-10: stamp selected rows as manually dispatched.
   * Used when a buyer picked up at Caseros OR a flex courier
   * physically came for the boxes — ML/TN can't auto-detect those.
   * The row jumps to the Despachadas tab on next refresh.
   */
  const bulkMarkDispatched = async () => {
    if (bulkPending || selected.size === 0) return;
    setBulkPending(true);
    try {
      const r = await api.dailyLogistica.setManualDispatch(Array.from(selected), date, true);
      if (r.updated > 0) {
        toast.success(
          `${r.updated} fila${r.updated === 1 ? '' : 's'} → Despachadas` +
          `${r.failed.length ? ` (${r.failed.length} con error)` : ''}`,
        );
      }
      // Marcos 2026-06-25: cuando una fila no se pudo despachar (rule
      // "si o si necesita courier"), surface el motivo con el cliente
      // afectado en vez de un genérico "N con error". Si hay >3 errores,
      // mostramos los primeros 3 para mantener el toast legible.
      if (r.failed.length > 0) {
        const reasons = (r as any).failedReasons as
          | Array<{ rowKey: string; reason: string }>
          | undefined;
        const labelByKey = new Map<string, string>();
        for (const rows of Object.values(data?.sections ?? {})) {
          for (const row of (rows as any[])) {
            labelByKey.set(row.rowKey, row.clienteName || row.cliente || row.orderRef || row.rowKey);
          }
        }
        const items = (reasons ?? r.failed.map((rk) => ({ rowKey: rk, reason: '' })))
          .slice(0, 3)
          .map((f) => `${labelByKey.get(f.rowKey) ?? f.rowKey}: ${f.reason || 'error'}`);
        const more = r.failed.length > 3 ? ` (+${r.failed.length - 3} más)` : '';
        toast.error(`No se pudieron despachar:\n${items.join('\n')}${more}`, { duration: 10_000 });
      }
      clearSelection();
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "No se pudo marcar como despachadas");
    } finally {
      setBulkPending(false);
    }
  };

  /**
   * Marcos 2026-06-10: move rows between panel sections via the
   * manual override. Used by the per-row "Mover a Retira Caseros"
   * (and the reverse) action. section=null restores the row to its
   * auto-computed section. Optimistic toast + reload so the picker
   * sees the row jump immediately.
   */
  const moveRowsToSection = async (rowKeys: string[], section: string | null) => {
    if (bulkPending || rowKeys.length === 0) return;
    setBulkPending(true);
    try {
      const r = await api.dailyLogistica.setSectionOverride(rowKeys, date, section);
      const label = section ? SECTION_META[section as DailySection]?.label ?? section : 'sección auto';
      toast.success(`${r.updated} fila${r.updated === 1 ? '' : 's'} → ${label}${r.failed.length ? ` (${r.failed.length} con error)` : ''}`);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "No se pudo mover la fila");
    } finally {
      setBulkPending(false);
    }
  };

  const archiveCancelled = async (rowKeys: string[]) => {
    if (bulkPending || rowKeys.length === 0) return;
    setBulkPending(true);
    try {
      const r = await api.dailyLogistica.archiveCancelled(rowKeys, date);
      toast.success(`${r.archived} cancelada${r.archived === 1 ? '' : 's'} eliminada${r.archived === 1 ? '' : 's'}${r.failed.length ? ` (${r.failed.length} con error)` : ''}`);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const k of rowKeys) next.delete(k);
        return next;
      });
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "No se pudo eliminar las canceladas");
    } finally {
      setBulkPending(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      const { blob, filename } = await api.dailyLogistica.downloadExcel(date);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Descargado: ${filename}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "No se pudo descargar el archivo");
    } finally {
      setDownloading(false);
    }
  };

  // Marcos 2026-06-10: tab-membership rule reused everywhere we
  // need to know which tab a row belongs to. Three buckets:
  //   pendientes — still on the picker's bench (state ≠ LISTO and
  //                carrier hasn't taken it).
  //   listas     — closed boxes waiting for the carrier
  //                (state = LISTO and not dispatched).
  //   despachadas — carrier took it.
  const rowInTab = useCallback(
    (r: { isDispatched: boolean; state: 'PENDIENTE' | 'ARMADO' | 'LISTO' }, t: 'pendientes' | 'listas' | 'despachadas') => {
      if (r.isDispatched) return t === 'despachadas';
      if (r.state === 'LISTO') return t === 'listas';
      return t === 'pendientes';
    },
    [],
  );

  // Marcos 2026-06-10 (revised): we do NOT auto-mark rows as
  // dispatched based on the cutoff hour anymore. The previous
  // version of this code did, but Marcos pointed out the real
  // failure modes — carrier doesn't pass, driver steals a package,
  // box lost in depósito — and silently moving the row to
  // Despachadas masks exactly the events the team needs to catch.
  // The correct source of truth is ML's shipping_status (flips when
  // the driver scans), which we already hydrate via shipment fetch
  // every panel load. So the rule is: row → Despachadas only when
  // ML/TN says so. The cutoff still drives the visual divider
  // (above) and the "no fue retirado" alert badge (below) so the
  // exceptions are loud, not silent.
  //
  // Keeping a `view` alias so the code that consumes data through
  // it stays one-line-stable if I need to enrich rows again later.
  const view = data;

  const counts = useMemo(() => {
    if (!view) return null;
    let total = 0;
    let armado = 0;
    let cancelled = 0;
    for (const s of SECTION_ORDER) {
      for (const r of view.sections[s]) {
        if (!rowInTab(r, tab)) continue;
        total++;
        if (r.isCancelled) cancelled++;
        if (r.armado) armado++;
      }
    }
    return { total, armado, pending: total - armado - cancelled, cancelled };
  }, [view, tab, rowInTab]);

  if (!isAllowed) return null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* HEADER */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(249_115_22/0.45)] sm:h-11 sm:w-11">
          <InventoryIcon sx={{ fontSize: 20 }} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight sm:text-3xl text-slate-900">Logística diaria</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">
            Las ventas del día en las 6 secciones, con tilde de armado por fila. Descargá el Excel cuando lo necesites — refleja exactamente lo que está tildado en este momento.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-orange-400 focus:ring-4 focus:ring-orange-500/15"
            data-testid="logistica-diaria-date"
          />
          <button
            type="button"
            onClick={download}
            disabled={downloading || loading || !data}
            data-testid="logistica-diaria-download-btn"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-br from-orange-600 to-amber-500 px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgb(249_115_22/0.5)] transition-all duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <DownloadIcon sx={{ fontSize: 18 }} />
            )}
            Descargar Excel
          </button>
          <button
            type="button"
            onClick={() => {
              setRefreshing(true);
              void load();
            }}
            disabled={refreshing}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshIcon sx={{ fontSize: 16 }} className={`text-orange-600 ${refreshing ? "animate-spin" : ""}`} />
            Recargar
          </button>
        </div>
      </div>

      {/* Marcos 2026-06-10: links favoritos from Settings →
          Logística surfaced as one-click chips at the top of the
          panel. Editable from the same settings card without a
          redeploy. Hidden when no links are configured to avoid an
          empty strip. Horizontal scroll on narrow screens. */}
      {favLinks.length > 0 && (
        <div
          data-testid="logistica-fav-links"
          className="flex items-center gap-2 overflow-x-auto rounded-2xl border border-slate-200/70 bg-white/60 px-3 py-2"
        >
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 shrink-0">
            Accesos rápidos
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {favLinks.map((l, idx) => (
              <a
                key={`${l.url}-${idx}`}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="logistica-fav-link"
                title={l.url}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"
              >
                {l.label}
                <span aria-hidden className="text-[10px] text-slate-400">↗</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Marcos 2026-06-10: 3-tab toggle. Pendientes (still on
          bench) / Listas para despachar (closed boxes awaiting
          carrier) / Despachadas (carrier picked up). */}
      <div className="flex items-center gap-1.5 flex-wrap" data-testid="logistica-tabs">
        {(
          [
            { key: 'pendientes', label: 'Pendientes' },
            { key: 'listas', label: 'Listas para despachar' },
            { key: 'despachadas', label: 'Despachadas' },
          ] as const
        ).map(({ key, label }) => {
          const flat = view ? Object.values(view.sections).flat() : [];
          const total = flat.filter((r) => rowInTab(r, key)).length;
          // Marcos 2026-06-20: contador secundario "sin armar" en la
          // tab Despachadas — paquetes que ML auto-promovió a
          // despachados pero que el equipo nunca tildó armado. Visible
          // sólo en esa tab y sólo si hay > 0.
          const sinArmar = key === 'despachadas'
            ? flat.filter((r) => r.isDispatched && r.autoDispatchedWithoutArmado && !r.isCancelled).length
            : 0;
          const isActive = tab === key;
          return (
            <button
              key={key}
              type="button"
              data-testid={`logistica-tab-${key}`}
              aria-pressed={isActive}
              onClick={() => setTab(key)}
              className={
                'inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors ' +
                (isActive
                  ? 'border-slate-700 bg-slate-800 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50')
              }
            >
              <span>{label}</span>
              <span
                className={
                  'inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums ' +
                  (isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600')
                }
              >
                {total}
              </span>
              {sinArmar > 0 && (
                <span
                  data-testid="logistica-tab-despachadas-sin-armar"
                  title={`${sinArmar} paquete${sinArmar === 1 ? '' : 's'} despachado${sinArmar === 1 ? '' : 's'} por ML sin que el equipo haya tildado armado — revisar`}
                  className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold tabular-nums text-white animate-pulse"
                >
                  {sinArmar}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Bloque B item 3.10 — Marcos 2026-06-08: search box.
          Filters rows client-side by cliente / orden / producto /
          nota. Sits above the bulk bar so they don't fight for the
          sticky slot. */}
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Buscar por cliente, número de orden, producto o nota…"
          data-testid="logistica-search"
          className="h-9 flex-1 rounded-lg border border-slate-200 bg-white/70 px-3 text-sm placeholder:text-slate-400 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
        {searchQuery.trim().length > 0 && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
            data-testid="logistica-search-clear"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Bloque B item 3.6 — bulk action bar. Visible only when at
          least one row is selected. Sticky so it stays in reach as the
          picker scrolls through long sections. */}
      {selected.size > 0 && (
        <div
          data-testid="logistica-bulk-bar"
          className="sticky top-16 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-300 bg-white/95 px-4 py-2 shadow-lg backdrop-blur"
        >
          <p className="text-sm text-slate-700">
            <span className="font-semibold tabular-nums">{selected.size}</span> fila
            {selected.size === 1 ? '' : 's'} seleccionada{selected.size === 1 ? '' : 's'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => bulkApply('ARMADO')}
              disabled={bulkPending}
              data-testid="logistica-bulk-armado"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-100 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-200 disabled:opacity-60"
            >
              Marcar como ARMADO
            </button>
            {/* Marcos 2026-06-10: "Marcar como LISTO" semantics
                are exactly "enviar a Listas para despachar" — the
                row leaves the Pendientes tab and lands in the
                Listas tab. Relabelled so the picker reads what
                actually happens. */}
            <button
              type="button"
              onClick={() => bulkApply('LISTO')}
              disabled={bulkPending}
              data-testid="logistica-bulk-listo"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              Enviar a Listas para despachar
            </button>
            {/* Marcos 2026-06-10: bulk "Eliminar canceladas". Only
                surfaces when the selection contains at least one
                cancelled row — otherwise the button is dead weight.
                Sends archivedAt; backend drops the row from the
                aggregator on next refresh. */}
            {(() => {
              const cancelledSelected = view
                ? Object.values(view.sections).flat().filter((r) => selected.has(r.rowKey) && r.isCancelled).map((r) => r.rowKey)
                : [];
              if (cancelledSelected.length === 0) return null;
              return (
                <button
                  type="button"
                  onClick={() => setArchiveTarget(cancelledSelected)}
                  disabled={bulkPending}
                  data-testid="logistica-bulk-archive-cancelled"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-rose-100 px-3 text-xs font-semibold text-rose-800 hover:bg-rose-200 disabled:opacity-60"
                  title="Confirmar la cancelación y sacar las filas del panel"
                >
                  Eliminar {cancelledSelected.length} cancelada{cancelledSelected.length === 1 ? '' : 's'}
                </button>
              );
            })()}
            {/* Marcos 2026-06-10 round 3: manual "Marcar como
                despachadas". Visible on Pendientes + Listas tabs (in
                Despachadas the rows already are dispatched). Use
                cases: a buyer just picked up at Caseros; a flex
                courier (Logistica 1/2/3) showed up and took the
                boxes — neither flips ML/TN's source-side flag, so
                the operator confirms here. Pickup at Caseros is the
                Marcos-flagged path; courier-came lives in the
                Listas tab next to the courier dropdown. */}
            {tab !== 'despachadas' && (
              <button
                type="button"
                onClick={() => void bulkMarkDispatched()}
                disabled={bulkPending}
                data-testid="logistica-bulk-mark-dispatched"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
                title="Confirmar que las filas seleccionadas salieron (el cliente retiró o el courier ya las llevó)"
              >
                Marcar como despachadas
              </button>
            )}
            {/* Marcos 2026-06-10: courier dropdown — antes solo en
                Listas. Marcos 2026-06-25: extendido a Pendientes
                también, porque asignar courier en sí mismo es la
                señal de que el paquete está listo para que el courier
                se lo lleve — el backend auto-promove a LISTO en
                el mismo call, comprimiendo los 2 pasos que hacía el
                operador (enviar a Listas + después asignar courier). */}
            {tab !== 'despachadas' && flexCouriers.length > 0 && (
              <select
                data-testid="logistica-bulk-courier"
                onChange={(e) => {
                  const v = e.target.value;
                  void bulkSetCourier(v === '__clear__' ? null : v);
                  e.currentTarget.value = '';
                }}
                defaultValue=""
                disabled={bulkPending}
                className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:border-slate-400 disabled:opacity-60"
              >
                <option value="" disabled>Asignar courier…</option>
                {flexCouriers.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                <option value="__clear__">— quitar courier —</option>
              </select>
            )}
            {/* Marcos 2026-06-10 follow-up: bulk move-to-section.
                Edge case Marcos called out: a buyer who originally
                chose "Acordar entrega" later asks for delivery via
                MOTO or MICRO — and vice versa. The override field is
                already any-to-any; this dropdown just exposes the
                full set of destinations. Acts on every selected
                row; "Sección auto" clears the override so the row
                drops back to its computed section. */}
            <select
              data-testid="logistica-bulk-move-section"
              onChange={(e) => {
                const v = e.target.value;
                if (v === '') return;
                void moveRowsToSection(
                  Array.from(selected),
                  v === '__auto__' ? null : v,
                );
                e.currentTarget.value = '';
              }}
              defaultValue=""
              disabled={bulkPending}
              className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 hover:border-slate-400 disabled:opacity-60"
            >
              <option value="" disabled>Mover a…</option>
              {SECTION_ORDER.map((s) => (
                <option key={s} value={s}>{SECTION_META[s].label}</option>
              ))}
              <option value="__auto__">— Sección automática —</option>
            </select>

            <button
              type="button"
              onClick={clearSelection}
              disabled={bulkPending}
              data-testid="logistica-bulk-clear"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-60"
            >
              Limpiar
            </button>
          </div>
        </div>
      )}

      {/* SUMMARY CHIPS — Marcos 2026-06-09: counts respect the active
          tab (Pendientes / Despachadas) so the totals match what's
          actually visible below. The cancelled chip surfaces ML
          buyer-cancellations separately so the picker knows real load. */}
      {counts && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            <span className="tabular-nums font-semibold">{counts.total}</span> {tab === 'pendientes' ? 'a preparar' : tab === 'listas' ? 'listas para despachar' : 'despachadas'}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
            <CheckCircleIcon sx={{ fontSize: 14 }} />
            <span className="tabular-nums font-semibold">{counts.armado}</span> armados
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
            <span className="tabular-nums font-semibold">{counts.pending}</span> pendientes
          </span>
          {counts.cancelled > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-3 py-1 text-xs font-medium text-rose-700">
              <span className="tabular-nums font-semibold">{counts.cancelled}</span> canceladas
            </span>
          )}
        </div>
      )}

      {/* GENERATION NOTES (e.g. "TN orders not synced") */}
      {data?.notes && data.notes.length > 0 && (
        <div className="rounded-xl border border-amber-200/70 bg-amber-50/50 p-3 text-xs text-amber-800">
          <p className="font-semibold uppercase tracking-wider text-amber-700">Notas de generación</p>
          <ul className="mt-1 space-y-1">
            {data.notes.map((n, i) => (
              <li key={i}>
                <span className="font-mono text-[10px] text-amber-600">[{n.source}]</span> {n.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data?.errors && data.errors.length > 0 && (
        <div className="rounded-xl border border-rose-200/70 bg-rose-50/50 p-3 text-xs text-rose-800">
          <p className="flex items-center gap-1 font-semibold uppercase tracking-wider text-rose-700">
            <WarningAmberIcon sx={{ fontSize: 14 }} />
            Errores en la agregación
          </p>
          <ul className="mt-1 space-y-1">
            {data.errors.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-[10px] text-rose-600">[{e.source}]</span> {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* SECTIONS */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {SECTION_ORDER.map((section) => {
            const meta = SECTION_META[section];
            const sectionRows = view?.sections[section] ?? [];
            // 3-tab filter via rowInTab (Marcos 2026-06-10).
            const tabRows = sectionRows.filter((r) => rowInTab(r, tab));
            const rawRows = tabRows;
            const rows = searchQuery.trim().length > 0 ? rawRows.filter(matchesSearch) : rawRows;
            const isCollapsed = collapsedSections.has(section);

            // Marcos 2026-06-10: cutoff divider. Each section family
            // has a daily pickup cutoff (colecta 14, flex 15, motos
            // 15, micros 16, configurable from Settings → Logística).
            // Once "now" passes the cutoff, rows that arrived AFTER
            // the cutoff are "para mañana" (less urgent), while rows
            // that came in BEFORE the cutoff were the morning batch.
            // The divider only matters on the Pendientes tab — Listas
            // / Despachadas don't have a "today vs tomorrow" priority.
            const family: 'colecta' | 'flex' | 'motos' | 'micros' | null =
              section === 'COLECTA_1' || section === 'COLECTA_2' ? 'colecta'
              : section === 'FLEX_1' || section === 'FLEX_2' ? 'flex'
              : section === 'MOTOS' ? 'motos'
              : section === 'MICROS' ? 'micros'
              : null;
            const cutoffDefaults = { colecta: 14, flex: 15, motos: 15, micros: null } as const;
            const rawCutoff = family ? cutoffHours[family] : null;
            const cutoffHour: number | null =
              typeof rawCutoff === 'number'
                ? rawCutoff
                : family && rawCutoff === undefined
                  ? cutoffDefaults[family] ?? null
                  : null;
            let cutoffDividerIdx = -1;
            if (tab === 'pendientes' && cutoffHour != null) {
              const nowDate = new Date();
              if (nowDate.getHours() >= cutoffHour) {
                const cutoffDate = new Date();
                cutoffDate.setHours(cutoffHour, 0, 0, 0);
                const cutoffMs = cutoffDate.getTime();
                cutoffDividerIdx = rows.findIndex(
                  (r) => r.createdAtIso && new Date(r.createdAtIso).getTime() < cutoffMs,
                );
              }
            }
            return (
              <div
                key={section}
                data-testid={`logistica-section-${section}`}
                className={`overflow-hidden rounded-2xl border ${meta.tint}`}
              >
                {/* Marcos 2026-06-10: click the header to collapse
                    the section. Lets the picker working on MICROS
                    fold COLECTA_1 / FLEX_1 / etc. and reach their
                    own panel faster. */}
                <button
                  type="button"
                  data-testid={`logistica-section-toggle-${section}`}
                  aria-expanded={!isCollapsed}
                  onClick={() => {
                    setCollapsedSections((prev) => {
                      const next = new Set(prev);
                      if (next.has(section)) next.delete(section);
                      else next.add(section);
                      return next;
                    });
                  }}
                  className="flex w-full items-center gap-3 border-b border-slate-200/70 bg-white/60 px-4 py-2 text-left transition-colors hover:bg-white/80"
                >
                  <span className={`h-3 w-8 rounded-full ${meta.rail}`} />
                  <span className="text-sm font-semibold uppercase tracking-wider text-slate-800">
                    {meta.label}
                  </span>
                  <span className="ml-auto inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-white px-2 text-[11px] font-semibold tabular-nums text-slate-700">
                    {rows.length === rawRows.length
                      ? rows.length
                      : `${rows.length}/${rawRows.length}`}
                  </span>
                  {isCollapsed ? (
                    <ExpandMoreIcon sx={{ fontSize: 18 }} className="text-slate-500" />
                  ) : (
                    <ExpandLessIcon sx={{ fontSize: 18 }} className="text-slate-500" />
                  )}
                </button>
                {isCollapsed ? null : rows.length === 0 ? (
                  <p className="px-4 py-4 text-center text-[11px] text-slate-500">
                    Sin pedidos en esta sección para {date}.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-200/70 bg-white/40">
                    {rows.map((row, rowIdx) => {
                      const expanded = expandedRows.has(row.rowKey);
                      const hasItems = Array.isArray(row.items) && row.items.length > 0;
                      const totalUnits = hasItems
                        ? row.items.reduce((sum, it) => sum + (it.quantity || 1), 0)
                        : 0;
                      // Marcos 2026-06-10: cutoff divider. Renders
                      // BEFORE the first row whose createdAtIso is
                      // earlier than today's cutoff — splits "para
                      // mañana" (above, post-cutoff arrivals) from
                      // "pueden salir hoy" (below, pre-cutoff). Only
                      // visible on Pendientes tab and only once now
                      // is past the cutoff hour.
                      const dividerBefore = rowIdx === cutoffDividerIdx && cutoffDividerIdx > 0;
                      // Marcos 2026-06-10 (revised): "no fue
                      // retirado" exception alert. The carrier was
                      // supposed to pick this box up — the row was
                      // in LISTO before today's cutoff — but ML
                      // still hasn't flipped its shipping_status,
                      // which is how we'd normally see the scan.
                      // Likely scenarios: colecta no pasó, chofer
                      // se lo llevó pero no escaneó, paquete
                      // perdido en depósito. We surface a red
                      // "NO FUE RETIRADO" chip so the team
                      // notices and follows up — instead of the
                      // previous version of this code which
                      // silently moved them to Despachadas and
                      // masked exactly these events. cutoffHour is
                      // already computed for the divider above. */
                      const isStaleListo =
                        tab === 'listas'
                        && cutoffHour != null
                        && row.state === 'LISTO'
                        && !row.isDispatched
                        && row.listoAt != null
                        && new Date(row.listoAt).getTime() <
                          (() => { const d = new Date(); d.setHours(cutoffHour, 0, 0, 0); return d.getTime(); })()
                        && new Date().getHours() >= cutoffHour;
                      // Bloque B item 3.7 — LISTO is blocked while the
                      // multi-item check is in progress. Single-item
                      // rows (and CRM rows without items) can advance
                      // freely. Mirrors the backend guard.
                      const itemsTotal = hasItems ? row.items.length : 0;
                      const itemsCheckedCount = (row.itemsChecked ?? []).length;
                      const advanceBlocked =
                        row.state === 'ARMADO' && itemsTotal > 1 && itemsCheckedCount < itemsTotal;
                      return (
                      <Fragment key={row.rowKey}>
                      {dividerBefore && (
                        <li
                          data-testid="logistica-cutoff-divider"
                          data-section={section}
                          data-cutoff-hour={cutoffHour}
                          className="border-y-4 border-amber-500 bg-amber-50/70 px-4 py-2 text-[12px] font-semibold uppercase tracking-wider text-amber-800"
                        >
                          <span className="inline-flex items-center gap-2">
                            <span aria-hidden>⏰</span>
                            Corte {String(cutoffHour).padStart(2, '0')}:00 — abajo, lo del lote de hoy. Arriba, ya quedan para mañana.
                          </span>
                        </li>
                      )}
                      <li
                        data-testid="logistica-row"
                        data-row-key={row.rowKey}
                        data-armado={row.armado ? "true" : "false"}
                        data-state={row.state}
                        data-expanded={expanded ? "true" : "false"}
                        data-selected={selected.has(row.rowKey) ? "true" : "false"}
                        data-cancelled={row.isCancelled ? "true" : "false"}
                        className={
                          'border-b border-slate-200/40 last:border-b-0 ' +
                          (row.isCancelled ? 'bg-rose-50/60' : '')
                        }
                      >
                        <div className="grid grid-cols-[24px_88px_24px_minmax(0,1fr)_minmax(0,1fr)_minmax(180px,1.2fr)_140px] items-center gap-3 px-4 py-2.5 hover:bg-white/70">
                        <input
                          type="checkbox"
                          data-testid="logistica-row-select"
                          aria-label="Seleccionar fila para acciones en lote"
                          checked={selected.has(row.rowKey)}
                          onChange={() => toggleSelected(row.rowKey)}
                          className="h-4 w-4 cursor-pointer rounded border-slate-300 text-emerald-600 focus:ring-emerald-300"
                        />
                        {/* Marcos 2026-06-10 round 3: cancelled rows
                            replace the state pill with a visible
                            "Eliminar" button. State progression is
                            meaningless on a cancelled order — the
                            picker shouldn't have to hunt for the
                            tiny inline-text Eliminar; this puts it
                            in the same prominent column as the rest
                            of the row's primary action. */}
                        {row.isCancelled ? (
                          <button
                            type="button"
                            onClick={() => setArchiveTarget([row.rowKey])}
                            disabled={bulkPending}
                            data-testid="logistica-state-pill-eliminar"
                            title="Eliminar fila cancelada del panel"
                            className="h-7 rounded-full bg-rose-600 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
                          >
                            Eliminar
                          </button>
                        ) : (
                        <button
                          type="button"
                          onClick={() => advanceState(row)}
                          disabled={pendingRow === row.rowKey || row.state === 'LISTO' || advanceBlocked}
                          data-testid="logistica-state-pill"
                          data-state={row.state}
                          data-advance-blocked={advanceBlocked ? 'true' : 'false'}
                          aria-label={
                            row.state === 'PENDIENTE'
                              ? 'Avanzar a ARMADO'
                              : row.state === 'ARMADO'
                                ? (advanceBlocked
                                    ? `LISTO bloqueado — faltan ${itemsTotal - itemsCheckedCount} items por tildar`
                                    : 'Avanzar a LISTO')
                                : 'Ya está LISTO'
                          }
                          title={
                            row.state === 'PENDIENTE'
                              ? 'Click → ARMADO'
                              : row.state === 'ARMADO'
                                ? (advanceBlocked
                                    ? `Tildá los ${itemsTotal - itemsCheckedCount} items que faltan en el desplegable para poder pasar a LISTO`
                                    : 'Click → LISTO')
                                : 'LISTO (revertir desde el desplegable)'
                          }
                          className={
                            row.state === 'LISTO'
                              ? 'h-7 rounded-full bg-emerald-600 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm disabled:opacity-100'
                              : row.state === 'ARMADO'
                                ? (advanceBlocked
                                    ? 'h-7 rounded-full bg-amber-50 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-amber-600 cursor-not-allowed opacity-70'
                                    : 'h-7 rounded-full bg-amber-100 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800 hover:bg-amber-200 disabled:opacity-60')
                                : 'h-7 rounded-full border border-slate-300 bg-white px-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:border-amber-300 hover:text-amber-700 disabled:opacity-60'
                          }
                        >
                          {pendingRow === row.rowKey
                            ? '…'
                            : advanceBlocked
                              ? `armado ${itemsCheckedCount}/${itemsTotal}`
                              : row.state.toLowerCase()}
                        </button>
                        )}
                        <button
                          type="button"
                          data-testid="logistica-row-expand"
                          aria-label={expanded ? "Colapsar detalle" : "Ver detalle del pedido"}
                          aria-expanded={expanded}
                          disabled={!hasItems}
                          onClick={() => {
                            setExpandedRows((prev) => {
                              const next = new Set(prev);
                              if (next.has(row.rowKey)) next.delete(row.rowKey);
                              else next.add(row.rowKey);
                              return next;
                            });
                          }}
                          title={hasItems ? "Ver items del pedido" : "Sin items para expandir"}
                          className={
                            hasItems
                              ? "grid h-6 w-6 place-items-center rounded text-slate-500 hover:bg-slate-200/80 hover:text-slate-900"
                              : "grid h-6 w-6 place-items-center rounded text-slate-300 cursor-not-allowed opacity-60"
                          }
                        >
                          {expanded ? (
                            <ExpandLessIcon sx={{ fontSize: 18 }} />
                          ) : (
                            <ExpandMoreIcon sx={{ fontSize: 18 }} />
                          )}
                        </button>
                        {/* Marcos 2026-06-10: two-line label. Name
                            on top, order ref underneath. Source /
                            account label dropped — the section
                            header already says COLECTA 1 / FLEX 2 /
                            etc., so repeating it on every row is
                            noise. Status chips (CANCELADA / ACORDÁ
                            CON CLIENTE / MENSAJE) stay inline with
                            the name because they're operationally
                            load-bearing. */}
                        <div className="min-w-0">
                          <p className="truncate text-sm text-slate-900">
                            {row.isCancelled && (
                              <>
                                <span
                                  data-testid="logistica-row-cancelada"
                                  className="mr-1 inline-flex h-4 items-center rounded-full bg-rose-600 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-white align-middle"
                                >
                                  CANCELADA
                                </span>
                                {/* Marcos 2026-06-10: per-row dismiss.
                                    Confirms the cancellation and
                                    archives the row out of the panel. */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setArchiveTarget([row.rowKey]);
                                  }}
                                  data-testid="logistica-row-archive-cancelled"
                                  title="Confirmar cancelación y sacar del panel"
                                  className="mr-1.5 inline-flex h-4 items-center rounded-full border border-rose-300 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-rose-700 hover:bg-rose-50 align-middle"
                                >
                                  Eliminar
                                </button>
                              </>
                            )}
                            {row.pickupAgreement && (
                              <span
                                data-testid="logistica-row-acordar"
                                title="El comprador retira / acuerda la entrega — coordinar antes de despachar"
                                className="mr-1.5 inline-flex h-4 items-center rounded-full bg-amber-500 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-white align-middle"
                              >
                                ACORDÁ CON CLIENTE
                              </span>
                            )}
                            {/* Marcos 2026-06-11 (#2000016880649372):
                                pack parked in ML's hub past
                                ML_HUB_STALE_HOURS — the carrier never
                                picked up. The backend yanks the row
                                back to Pendientes; this badge tells
                                the picker WHY it reappeared so they
                                escalate instead of re-picking. */}
                            {row.isStuckInHub && (
                              <span
                                data-testid="logistica-row-stuck-hub"
                                title="ML marcó el envío en hub pero la colecta nunca lo retiró — revisar con el courier"
                                className="mr-1.5 inline-flex h-4 items-center rounded-full bg-rose-600 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-white align-middle animate-pulse"
                              >
                                ATASCADO EN HUB
                              </span>
                            )}
                            {/* Marcos 2026-06-20: badge para filas que
                                aparecieron en Despachadas sin que el
                                equipo haya stampado armado (ML
                                auto-promovió). Hace falta verificar que
                                el paquete físico salió correctamente. */}
                            {row.autoDispatchedWithoutArmado && (
                              <span
                                data-testid="logistica-row-sin-armar"
                                title="ML reportó este envío como despachado pero nadie tildó armado en el panel — verificar que el paquete físico salió correcto"
                                className="mr-1.5 inline-flex h-4 items-center rounded-full bg-amber-600 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-white align-middle animate-pulse"
                              >
                                SIN ARMAR — REVISAR
                              </span>
                            )}
                            {/* Marcos 2026-06-10: per-row section
                                override. ML "Acordá entrega" rows
                                (pickup at Caseros) can't be
                                auto-distinguished from "Acordá envío"
                                via the ML order endpoint, so the
                                operator flips them manually. Same
                                affordance also lets them undo a
                                wrong auto-routing. */}
                            {section !== 'RETIRA_CASEROS' && row.pickupAgreement && (
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); void moveRowsToSection([row.rowKey], 'RETIRA_CASEROS'); }}
                                data-testid="logistica-row-move-retira"
                                title="El cliente retira en Caseros — moverla a RETIRA CASEROS"
                                className="mr-1.5 inline-flex h-4 items-center rounded-full border border-violet-300 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-violet-700 hover:bg-violet-50 align-middle"
                              >
                                → Retira
                              </button>
                            )}
                            {section === 'RETIRA_CASEROS' && (
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); void moveRowsToSection([row.rowKey], null); }}
                                data-testid="logistica-row-move-auto"
                                title="No es retiro — devolverla a la sección automática"
                                className="mr-1.5 inline-flex h-4 items-center rounded-full border border-slate-300 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-600 hover:bg-slate-50 align-middle"
                              >
                                ← Sección auto
                              </button>
                            )}
                            {row.hasUnreadMessage && (
                              <span
                                data-testid="logistica-row-mensaje"
                                title="El comprador escribió por el chat de ML — leelo antes de despachar"
                                className="mr-1.5 inline-flex h-4 items-center gap-0.5 rounded-full bg-sky-600 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-white align-middle"
                              >
                                MENSAJE
                              </span>
                            )}
                            {isStaleListo && (
                              <span
                                data-testid="logistica-row-stale-listo"
                                title={`Estaba LISTO antes del corte de las ${String(cutoffHour).padStart(2, '0')}:00 pero el sistema todavía no lo marca como despachado. Chequear con el courier — puede no haber pasado, o el paquete no fue escaneado.`}
                                className="mr-1.5 inline-flex h-4 items-center gap-0.5 rounded-full bg-red-600 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-white align-middle animate-pulse"
                              >
                                NO FUE RETIRADO
                              </span>
                            )}
                            {row.clienteName || row.cliente}
                          </p>
                          {row.orderRef && (
                            <p className="truncate text-[11px] text-slate-500 font-mono">
                              {row.orderRef}
                              {/* Marcos 2026-06-12 (4): inline per-row
                                  courier pick. Marcos 2026-06-25: el
                                  edit ahora también está disponible
                                  en Despachadas — antes una fila que
                                  pasaba a Despachadas sin courier
                                  quedaba sin forma de stampearlo, y
                                  una con courier mal asignado tampoco
                                  era editable. Hidden en Pendientes
                                  (todavía no se decide). */}
                              {row.flexCourier && !editingCourierRow.has(row.rowKey) && (
                                <button
                                  type="button"
                                  data-testid="logistica-row-flex-courier"
                                  title={
                                    tab === 'despachadas'
                                      ? `Despachado con ${row.flexCourier} — click para cambiar`
                                      : `Asignado: ${row.flexCourier} — click para cambiar`
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (row.isCancelled || flexCouriers.length === 0) return;
                                    setEditingCourierRow((prev) => {
                                      const next = new Set(prev);
                                      next.add(row.rowKey);
                                      return next;
                                    });
                                  }}
                                  className={
                                    'ml-2 inline-flex h-4 items-center rounded-full px-1.5 text-[9px] font-semibold uppercase tracking-wider align-middle ' +
                                    (row.isCancelled || flexCouriers.length === 0
                                      ? 'bg-violet-100 text-violet-700 cursor-default'
                                      : 'bg-violet-100 text-violet-700 hover:bg-violet-200 cursor-pointer')
                                  }
                                >
                                  {row.flexCourier}
                                </button>
                              )}
                              {/* Sin courier asignado: en Despachadas
                                  es una alerta — sin courier no podemos
                                  rastrear quién se llevó el paquete si
                                  el comprador reclama. */}
                              {tab === 'despachadas' && !row.flexCourier && flexCouriers.length > 0 && !row.isCancelled && !editingCourierRow.has(row.rowKey) && (
                                <span
                                  data-testid="logistica-row-no-courier"
                                  title="Despachada sin courier registrado — no podemos rastrear quién la llevó si hay reclamo"
                                  className="ml-2 inline-flex h-4 items-center rounded-full bg-rose-100 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-rose-700 align-middle"
                                >
                                  SIN COURIER
                                </span>
                              )}
                              {flexCouriers.length > 0 && !row.isCancelled
                                && (!row.flexCourier || editingCourierRow.has(row.rowKey)) && (
                                <select
                                  data-testid={`logistica-row-courier-pick-${row.rowKey.replace(/[^a-z0-9]+/gi, '-')}`}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    const v = e.target.value;
                                    if (v === '__clear__') {
                                      void setRowCourier(row.rowKey, null);
                                    } else if (v) {
                                      void setRowCourier(row.rowKey, v);
                                    }
                                    setEditingCourierRow((prev) => {
                                      const next = new Set(prev);
                                      next.delete(row.rowKey);
                                      return next;
                                    });
                                    e.currentTarget.value = '';
                                  }}
                                  onBlur={() => {
                                    setEditingCourierRow((prev) => {
                                      if (!prev.has(row.rowKey)) return prev;
                                      const next = new Set(prev);
                                      next.delete(row.rowKey);
                                      return next;
                                    });
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  defaultValue=""
                                  autoFocus={editingCourierRow.has(row.rowKey)}
                                  className="ml-2 h-5 rounded-full border border-amber-300 bg-amber-50 px-2 text-[10px] font-semibold uppercase tracking-wider text-amber-800 align-middle hover:bg-amber-100"
                                >
                                  <option value="" disabled>
                                    {row.flexCourier ? `Cambiar (actual: ${row.flexCourier})` : 'Asignar courier…'}
                                  </option>
                                  {flexCouriers.map((c) => (
                                    <option key={c} value={c}>{c}</option>
                                  ))}
                                  {row.flexCourier && (
                                    <option value="__clear__">— quitar courier —</option>
                                  )}
                                </select>
                              )}
                            </p>
                          )}
                        </div>
                        {row.mlPermalink ? (
                          <a
                            href={row.mlPermalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-w-0 truncate text-sm text-blue-700 hover:underline"
                            data-testid="logistica-row-product-link"
                            title="Abrir publicación en MercadoLibre"
                          >
                            {row.producto}
                          </a>
                        ) : (
                          <p className="min-w-0 truncate text-sm text-slate-700">{row.producto}</p>
                        )}
                        {/* Marcos 2026-06-18 PM: nota cargada desde
                           /orders por el operador que armó el pedido —
                           read-only para el armador para que la vea
                           sin que se confunda con sus aclaraciones
                           propias. Sólo se renderiza cuando viene
                           algo del pedido origen. */}
                        {row.orderNotes && row.orderNotes.trim().length > 0 && (
                          <div
                            data-testid="logistica-row-order-note"
                            title="Nota cargada desde Pedidos"
                            className="inline-flex max-w-full items-start gap-1.5 rounded-md border border-emerald-200/70 bg-emerald-50/70 px-2 py-1 text-[11px] leading-snug text-emerald-900"
                          >
                            <span className="shrink-0 rounded bg-emerald-200/70 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-800">
                              pedido
                            </span>
                            <span className="min-w-0 break-words">{row.orderNotes}</span>
                          </div>
                        )}
                        {/* Bloque B item 3.8 — per-row editable note. Auto-saves on blur. */}
                        <input
                          type="text"
                          value={noteDrafts[row.rowKey] ?? row.notes ?? ''}
                          onChange={(e) => onNoteChange(row.rowKey, e.target.value)}
                          onBlur={() => onNoteCommit(row)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.currentTarget.blur();
                            } else if (e.key === 'Escape') {
                              setNoteDrafts((prev) => {
                                const next = { ...prev };
                                delete next[row.rowKey];
                                return next;
                              });
                              e.currentTarget.blur();
                            }
                          }}
                          placeholder={row.orderNotes ? 'Aclaración del armador…' : 'Nota…'}
                          maxLength={500}
                          data-testid="logistica-row-note"
                          className={
                            'h-8 min-w-0 rounded-md border bg-white/80 px-2 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-200 ' +
                            ((noteDrafts[row.rowKey] ?? row.notes ?? '').trim().length > 0
                              ? 'border-amber-300 text-amber-900'
                              : 'border-slate-200 text-slate-700 hover:border-slate-300')
                          }
                        />
                        <div className="text-right text-[11px] tabular-nums text-slate-500">
                          {row.armadoAt && (
                            <p title="ARMADO">
                              A: {safeFormatDate(row.armadoAt, "dd/MM HH:mm")}
                            </p>
                          )}
                          {row.listoAt && (
                            <p className="text-emerald-700" title="LISTO">
                              L: {safeFormatDate(row.listoAt, "dd/MM HH:mm")}
                            </p>
                          )}
                          {!row.armadoAt && !row.listoAt && <p>—</p>}
                        </div>
                        </div>
                        {expanded && hasItems && (() => {
                          // Bloque B item 3.7 — Marcos 2026-06-08.
                          // Stable per-item keys. Marcos 2026-06-22:
                          // antes la key era it.sku — cuando un mismo
                          // SKU aparecía en dos items del pedido
                          // (ej. dos 'Pigmento X10 Gm SKU 8012'),
                          // ambos colisionaban en la misma entry del
                          // Set y la cuenta nunca llegaba a 4/4. Ahora
                          // siempre incluimos el índice posicional —
                          // 'sku:0', 'sku:1' — para que items
                          // duplicados sean entidades distintas. El
                          // costo: pedidos en vuelo con keys viejas
                          // se ven como no-tildados y el armador
                          // re-tilda una vez (los que tenían el bug
                          // estaban trabados en 3/4 igual).
                          const itemKeyFor = (it: typeof row.items[number], idx: number) => {
                            const base = it.sku && it.sku.length > 0 ? it.sku : 'item';
                            return `${base}:${idx}`;
                          };
                          const checkedSet = new Set(row.itemsChecked ?? []);
                          const totalItems = row.items.length;
                          const checkedCount = row.items.reduce(
                            (c, it, idx) => (checkedSet.has(itemKeyFor(it, idx)) ? c + 1 : c),
                            0,
                          );
                          const allChecked = totalItems > 0 && checkedCount === totalItems;
                          return (
                          <div
                            className="border-t border-slate-200/60 bg-slate-50/70 px-4 py-3"
                            data-testid="logistica-row-detail"
                          >
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                {totalItems} producto{totalItems === 1 ? "" : "s"} · {totalUnits} unidad{totalUnits === 1 ? "" : "es"}
                                {totalItems > 1 && (
                                  <span
                                    data-testid="logistica-row-progress"
                                    className={
                                      allChecked
                                        ? 'ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-emerald-700'
                                        : 'ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700'
                                    }
                                  >
                                    {checkedCount}/{totalItems}
                                  </span>
                                )}
                              </p>
                              {row.state !== 'PENDIENTE' && (
                                <button
                                  type="button"
                                  onClick={() => revertRow(row)}
                                  disabled={pendingRow === row.rowKey}
                                  data-testid="logistica-row-revert"
                                  className="text-[11px] font-medium text-rose-600 hover:underline disabled:opacity-60"
                                  title="Volver a PENDIENTE (corrige un misclick)"
                                >
                                  Revertir a pendiente
                                </button>
                              )}
                            </div>
                            {/* Bloque B item 3.7 #2 — summary line at the
                                top, SKU/alias concatenated. Same content
                                as the `producto` column on the collapsed
                                view; surfaced here so the armador can see
                                the full cart at a glance. */}
                            <p
                              data-testid="logistica-row-summary"
                              className="mb-2 rounded bg-white/60 px-2 py-1 font-mono text-[11px] text-slate-700"
                            >
                              {row.producto}
                            </p>
                            <ul className="space-y-1.5">
                              {row.items.map((it, idx) => {
                                const k = itemKeyFor(it, idx);
                                const ticked = checkedSet.has(k);
                                // Marcos 2026-06-25: una vez que la
                                // fila está LISTO o despachada, los
                                // items quedan congelados — no se
                                // permiten cambios post-hoc para que
                                // el estado tildado al despachar quede
                                // como evidencia auditable si después
                                // hay un reclamo. Para corregirlos hay
                                // que revertir la fila a PENDIENTE.
                                const itemsLocked = row.state === 'LISTO' || row.isDispatched;
                                return (
                                <li
                                  key={`${row.rowKey}-${idx}-${it.sku ?? "no-sku"}`}
                                  data-testid="logistica-row-detail-item"
                                  data-item-key={k}
                                  data-item-checked={ticked ? 'true' : 'false'}
                                  data-zebra={idx % 2 === 0 ? 'odd' : 'even'}
                                  className={
                                    // Marcos 2026-06-10: zebra-stripe
                                    // the multi-item list — even +
                                    // odd rows alternate white/grey
                                    // so the picker can't mix up
                                    // adjacent SKUs at a glance.
                                    // SKU + quantity bumped from
                                    // 10/11 px to 14 px so the
                                    // numbers read clearly across
                                    // the warehouse screen.
                                    'grid grid-cols-[24px_minmax(0,1fr)_auto_auto_auto] items-center gap-3 rounded-md px-3 py-2 text-sm ' +
                                    (ticked
                                      ? 'bg-emerald-50/70'
                                      : (idx % 2 === 0 ? 'bg-white' : 'bg-slate-100/70'))
                                  }
                                >
                                  <input
                                    type="checkbox"
                                    checked={ticked}
                                    onChange={() => toggleItemCheck(row, k, !ticked)}
                                    disabled={itemsLocked}
                                    title={itemsLocked
                                      ? 'El paquete ya está LISTO/despachado — los items quedaron congelados como evidencia. Para corregirlos revertí a Pendiente.'
                                      : undefined}
                                    data-testid="logistica-item-check"
                                    aria-label={ticked ? `Desmarcar ${it.alias ?? it.name}` : `Marcar ${it.alias ?? it.name} en la caja`}
                                    className={
                                      'h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-300 ' +
                                      (itemsLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')
                                    }
                                  />
                                  <div className="min-w-0">
                                    <p className={'truncate font-medium ' + (ticked ? 'text-slate-500 line-through' : 'text-slate-800')}>
                                      {it.alias ?? it.name}
                                    </p>
                                    {it.alias && it.name && it.alias !== it.name && (
                                      <p className="truncate text-[11px] text-slate-400">
                                        {it.name}
                                      </p>
                                    )}
                                  </div>
                                  {/* Marcos 2026-06-10: warehouse
                                      location. Loaded from
                                      Product.warehouseLocation
                                      via the SKU→UBI sheet upload.
                                      Pill stands out so the armador
                                      can read it from across the
                                      galpón without zooming. */}
                                  {it.warehouseLocation && (
                                    <span
                                      data-testid="logistica-item-ubi"
                                      title="Ubicación en el galpón"
                                      className="inline-flex items-center rounded-md bg-teal-600 px-2 py-0.5 text-sm font-bold text-white tabular-nums"
                                    >
                                      UBI: {it.warehouseLocation}
                                    </span>
                                  )}
                                  {it.sku && (
                                    <span className="font-mono text-sm font-semibold text-slate-700">
                                      SKU: {it.sku}
                                    </span>
                                  )}
                                  <span className="tabular-nums text-base font-bold text-slate-900">
                                    × {it.quantity}
                                  </span>
                                </li>
                                );
                              })}
                            </ul>
                          </div>
                          );
                        })()}
                      </li>
                      </Fragment>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Marcos 2026-06-10: confirmation dialog for "Eliminar
          cancelada(s)". Per the standing UI rule the destructive
          confirm must use the styled AlertDialog, not native
          confirm(). On accept we call archiveCancelled and clear
          the target so the dialog closes. */}
      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}
      >
        <AlertDialogContent
          data-testid="logistica-archive-confirm"
          className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150"
        >
          <AlertDialogHeader className="space-y-3">
            <AlertDialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              ¿Eliminar {archiveTarget?.length === 1 ? 'esta venta cancelada' : `${archiveTarget?.length ?? 0} ventas canceladas`}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-slate-600">
              Las filas se sacan del panel y pasan al módulo de canceladas. Esta acción confirma que ya no hay que armarlas. Podés revertir desde el módulo de canceladas si fuera necesario.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel
              data-testid="logistica-archive-cancel"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97]"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="logistica-archive-confirm-action"
              onClick={async () => {
                const keys = archiveTarget ?? [];
                setArchiveTarget(null);
                await archiveCancelled(keys);
              }}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(239_68_68/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(239_68_68/0.65)] active:translate-y-0 active:scale-[0.97]"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
