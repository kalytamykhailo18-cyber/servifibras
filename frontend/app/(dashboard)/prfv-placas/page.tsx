"use client";

// Bloque C — Marcos 2026-06-06: Placas PRFV lifecycle page.
// Three-column kanban mirroring the section order in the daily Excel:
//   PENDIENTE → LISTA / CORTADA → DESPACHADA / RETIRADA
// One-click "Avanzar" moves a row forward; the daily auto-Excel picks
// up the resulting state in real time without anyone retyping.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { useRoleGuard } from "@/lib/hooks/use-role-guard";
import { api, type PrfvPlaca, type PrfvPlacaState } from "@/lib/api/endpoints";
import { UserRole } from "@/types";
import { toast } from "sonner";
import { safeFormatDistanceToNow } from "@/lib/date";
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
import AddIcon from "@mui/icons-material/Add";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CategoryIcon from "@mui/icons-material/Category";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditIcon from "@mui/icons-material/Edit";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";

const PRFV_ROLES = [UserRole.ADMIN, UserRole.LOGISTICA, UserRole.ENCARGADO];

const STATE_META: Record<PrfvPlacaState, { label: string; tint: string; chip: string; rail: string }> = {
  PENDIENTE: {
    label: "PENDIENTES",
    tint: "border-rose-200/70 bg-rose-50/40",
    chip: "bg-rose-100 text-rose-700 border-rose-200/70",
    rail: "bg-gradient-to-b from-rose-500 to-pink-400",
  },
  LISTA_CORTADA: {
    label: "LISTAS / CORTADAS",
    tint: "border-amber-200/70 bg-amber-50/40",
    chip: "bg-amber-100 text-amber-800 border-amber-200/70",
    rail: "bg-gradient-to-b from-amber-500 to-orange-400",
  },
  DESPACHADA_RETIRADA: {
    label: "DESPACHADAS / RETIRADAS",
    tint: "border-emerald-200/70 bg-emerald-50/40",
    chip: "bg-emerald-100 text-emerald-700 border-emerald-200/70",
    rail: "bg-gradient-to-b from-emerald-500 to-teal-400",
  },
};

const STATE_ORDER: PrfvPlacaState[] = ["PENDIENTE", "LISTA_CORTADA", "DESPACHADA_RETIRADA"];

interface FormState {
  id: string | null;
  cliente: string;
  producto: string;
  state: PrfvPlacaState;
  notes: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  cliente: "",
  producto: "",
  state: "PENDIENTE",
  notes: "",
};

export default function PrfvPlacasPage() {
  const { isAllowed } = useRoleGuard(PRFV_ROLES);
  const [placas, setPlacas] = useState<PrfvPlaca[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<PrfvPlaca | null>(null);
  const [advancingId, setAdvancingId] = useState<string | null>(null);

  // Debounce the search input — same pattern as the ML QA panel.
  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(searchInput), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    try {
      const rows = await api.prfvPlacas.list({
        search: searchDebounced || undefined,
      });
      setPlacas(rows);
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudieron cargar las placas");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [searchDebounced]);

  useEffect(() => {
    if (isAllowed) void load();
  }, [isAllowed, load]);

  // Group by state — backend orderBy is [state asc, stateChangedAt
  // desc], so the freshest movement appears at the top of each column.
  const grouped = useMemo(() => {
    const out: Record<PrfvPlacaState, PrfvPlaca[]> = {
      PENDIENTE: [],
      LISTA_CORTADA: [],
      DESPACHADA_RETIRADA: [],
    };
    for (const p of placas) out[p.state].push(p);
    return out;
  }, [placas]);

  const counts = useMemo(() => ({
    PENDIENTE: grouped.PENDIENTE.length,
    LISTA_CORTADA: grouped.LISTA_CORTADA.length,
    DESPACHADA_RETIRADA: grouped.DESPACHADA_RETIRADA.length,
  }), [grouped]);

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const startEdit = (placa: PrfvPlaca) => {
    setForm({
      id: placa.id,
      cliente: placa.cliente,
      producto: placa.producto,
      state: placa.state,
      notes: placa.notes ?? "",
    });
    setFormOpen(true);
  };

  const cancelEdit = () => {
    setFormOpen(false);
    setForm(EMPTY_FORM);
  };

  const submit = async () => {
    if (!form.cliente.trim() || !form.producto.trim()) {
      toast.error("Cliente y producto son obligatorios");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        cliente: form.cliente.trim(),
        producto: form.producto.trim(),
        state: form.state,
        notes: form.notes.trim() || null,
      };
      if (form.id) {
        await api.prfvPlacas.update(form.id, payload);
        toast.success("Placa actualizada");
      } else {
        await api.prfvPlacas.create(payload);
        toast.success("Placa creada");
      }
      setFormOpen(false);
      setForm(EMPTY_FORM);
      void load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const advance = async (placa: PrfvPlaca) => {
    setAdvancingId(placa.id);
    try {
      await api.prfvPlacas.advance(placa.id);
      toast.success("Placa avanzada");
      void load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "No se pudo avanzar");
    } finally {
      setAdvancingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.prfvPlacas.remove(deleting.id);
      toast.success("Placa eliminada");
      setDeleting(null);
      void load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "Error al eliminar");
    }
  };

  if (!isAllowed) return null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* HEADER */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(245_158_11/0.45)] sm:h-11 sm:w-11">
          <CategoryIcon sx={{ fontSize: 20 }} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight sm:text-3xl text-slate-900">Placas PRFV</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">
            Pendientes, listas / cortadas y despachadas / retiradas. Lo que esté acá se publica en el archivo diario de logística.
          </p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          data-testid="prfv-create-btn"
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-br from-amber-600 to-orange-500 px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgb(245_158_11/0.5)] transition-all duration-200 hover:-translate-y-0.5"
        >
          <AddIcon sx={{ fontSize: 18 }} />
          Nueva placa
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
          <RefreshIcon sx={{ fontSize: 16 }} className={`text-amber-600 ${refreshing ? "animate-spin" : ""}`} />
          Recargar
        </button>
      </div>

      {/* SEARCH */}
      <div className="relative max-w-md">
        <SearchIcon sx={{ fontSize: 16 }} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Buscar por cliente, producto o notas…"
          className="h-10 pl-9 pr-9"
          data-testid="prfv-search"
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

      {/* COLUMNS */}
      {loading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {STATE_ORDER.map((state) => {
            const meta = STATE_META[state];
            const rows = grouped[state];
            return (
              <div
                key={state}
                data-testid={`prfv-column-${state}`}
                className={`flex min-h-[200px] flex-col gap-2 rounded-2xl border p-3 ${meta.tint}`}
              >
                <div className="flex items-center gap-2 px-1 pb-1">
                  <span className={`h-2 w-8 rounded-full ${meta.rail}`} />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-700">
                    {meta.label}
                  </span>
                  <span className={`ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full border px-1.5 text-[10px] font-semibold ${meta.chip}`}>
                    {counts[state]}
                  </span>
                </div>
                {rows.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-white/40 px-3 py-6 text-center text-[11px] text-slate-500">
                    Sin placas en este estado.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {rows.map((p) => (
                      <li
                        key={p.id}
                        data-testid="prfv-row"
                        data-state={p.state}
                        className="group rounded-xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-shadow hover:shadow-[0_8px_20px_-8px_rgb(15_23_42/0.15)]"
                      >
                        <p className="text-sm font-medium text-slate-900">{p.cliente}</p>
                        <p className="mt-0.5 text-xs text-slate-600">{p.producto}</p>
                        {p.notes && (
                          <p className="mt-1 rounded-md bg-slate-50 px-2 py-1 text-[11px] italic text-slate-500">
                            {p.notes}
                          </p>
                        )}
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="text-[10px] text-slate-400">
                            {safeFormatDistanceToNow(p.stateChangedAt)}
                            {(p as any).createdBy?.name && (
                              <span
                                className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                                title={`Cargado por ${(p as any).createdBy.name}`}
                                data-testid="prfv-row-created-by"
                              >
                                por {(p as any).createdBy.name}
                              </span>
                            )}
                          </span>
                          <div className="flex items-center gap-1">
                            {p.state !== "DESPACHADA_RETIRADA" && (
                              <button
                                type="button"
                                onClick={() => advance(p)}
                                disabled={advancingId === p.id}
                                data-testid="prfv-advance-btn"
                                title="Avanzar al siguiente estado"
                                className="inline-flex h-7 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700 transition-colors hover:border-emerald-300 hover:bg-emerald-100 disabled:opacity-60"
                              >
                                {advancingId === p.id ? (
                                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-300 border-t-emerald-700" />
                                ) : (
                                  <ArrowForwardIcon sx={{ fontSize: 12 }} />
                                )}
                                Avanzar
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => startEdit(p)}
                              aria-label="Editar"
                              title="Editar placa"
                              data-testid="prfv-edit-btn"
                              className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                            >
                              <EditIcon sx={{ fontSize: 14 }} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleting(p)}
                              aria-label="Eliminar"
                              title="Eliminar placa"
                              data-testid="prfv-delete-btn"
                              className="grid h-7 w-7 place-items-center rounded-md text-rose-600 hover:bg-rose-50"
                            >
                              <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* FORM DIALOG (create / edit) */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-900">
              {form.id ? "Editar placa" : "Nueva placa"}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Cliente y producto son texto libre — el formato es el mismo que usás en el Excel actual.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">Cliente</label>
                <Input
                  value={form.cliente}
                  onChange={(e) => setForm({ ...form, cliente: e.target.value })}
                  placeholder='Ej. "Adrian Geuna NORTHTRAIL - WSP PAGA EFE"'
                  disabled={saving}
                  data-testid="prfv-form-cliente"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">Producto</label>
                <Input
                  value={form.producto}
                  onChange={(e) => setForm({ ...form, producto: e.target.value })}
                  placeholder='Ej. "Lámina 2,2 x 16 (750)"'
                  disabled={saving}
                  data-testid="prfv-form-producto"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">Estado</label>
                <select
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value as PrfvPlacaState })}
                  disabled={saving}
                  data-testid="prfv-form-state"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-500/15"
                >
                  {STATE_ORDER.map((s) => (
                    <option key={s} value={s}>{STATE_META[s].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">Notas (opcional)</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                  disabled={saving}
                  className="w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-sm leading-relaxed placeholder:text-slate-400 outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-500/15"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={saving}
                data-testid="prfv-form-save"
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-amber-600 px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgb(245_158_11/0.5)] hover:bg-amber-700 disabled:opacity-60"
              >
                {saving ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : null}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION */}
      <AlertDialog open={deleting != null} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar placa</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminará la placa de {deleting?.cliente} —{" "}
              {deleting?.producto}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
