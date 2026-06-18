"use client";

/**
 * Marcos 2026-06-18: librería de "Respuestas rápidas" (chips reusables).
 *
 * Reemplaza el modelo per-publication FAQ que en producción tenía 0
 * filas — curar por publicación nunca arrancó. El modelo correcto es
 * el que Marcos ya usa en el backoffice de ML: chips reusables
 * ("HAY STOCK", "ENVIOS", "MASILLA 10 MIN", "DIRECCIONES") con doble
 * función:
 *   (a) clickeables encima de la caja de respuesta para insertarse al
 *       cursor en una respuesta manual, y
 *   (b) cuando feedAi=true, se inyectan al system prompt de Claude
 *       como "FORMULACIONES APROBADAS" — así la IA copia las
 *       formulaciones validadas por el equipo en vez de inventar.
 *
 * La etiqueta se normaliza a mayúsculas en el backend; mostramos un
 * placeholder con esa convención para reforzar el lenguaje visual.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
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
import { api } from "@/lib/api/endpoints";
import { toast } from "sonner";
import AddIcon from "@mui/icons-material/Add";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import BoltIcon from "@mui/icons-material/Bolt";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditIcon from "@mui/icons-material/Edit";
import RefreshIcon from "@mui/icons-material/Refresh";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";

type Row = {
  id: string;
  label: string;
  body: string;
  category: string | null;
  active: boolean;
  feedAi: boolean;
  sortOrder: number;
  hitCount: number;
  lastUsedAt: string | null;
};

type FormState = {
  id: string | null;
  label: string;
  body: string;
  category: string;
  active: boolean;
  feedAi: boolean;
  sortOrder: number;
};

const EMPTY_FORM: FormState = {
  id: null,
  label: "",
  body: "",
  category: "",
  active: true,
  feedAi: true,
  sortOrder: 0,
};

export function QuickRepliesForm() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Row | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api.conversations.listAllQuickReplies();
      setRows(list as Row[]);
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudieron cargar las respuestas rápidas");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const grouped = useMemo(() => {
    const active = rows.filter((r) => r.active);
    const inactive = rows.filter((r) => !r.active);
    return { active, inactive };
  }, [rows]);

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const startEdit = (row: Row) => {
    setForm({
      id: row.id,
      label: row.label,
      body: row.body,
      category: row.category ?? "",
      active: row.active,
      feedAi: row.feedAi,
      sortOrder: row.sortOrder,
    });
    setFormOpen(true);
  };

  const cancelEdit = () => {
    setForm(EMPTY_FORM);
    setFormOpen(false);
  };

  const submit = async () => {
    const label = form.label.trim();
    const body = form.body.trim();
    if (!label) {
      toast.error("La etiqueta es obligatoria");
      return;
    }
    if (!body) {
      toast.error("El cuerpo es obligatorio");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        label,
        body,
        category: form.category.trim() || null,
        active: form.active,
        feedAi: form.feedAi,
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (form.id) {
        await api.conversations.updateQuickReply(form.id, payload);
        toast.success("Respuesta actualizada");
      } else {
        await api.conversations.createQuickReply(payload);
        toast.success("Respuesta creada");
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

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await api.conversations.deleteQuickReply(deleting.id);
      toast.success("Respuesta eliminada");
      setDeleting(null);
      void load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "Error al eliminar");
    }
  };

  const fmtLastUsed = (iso: string | null): string => {
    if (!iso) return "nunca";
    const diff = Date.now() - new Date(iso).getTime();
    const d = Math.floor(diff / 86400_000);
    if (d >= 1) return `hace ${d}d`;
    const h = Math.floor(diff / 3600_000);
    if (h >= 1) return `hace ${h}h`;
    const m = Math.floor(diff / 60_000);
    return m > 0 ? `hace ${m}min` : "recién";
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-48 rounded-xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="quick-replies-settings">
      {/* HEADER */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(99_102_241/0.45)]">
          <BoltIcon sx={{ fontSize: 18 }} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-900">Respuestas rápidas</h3>
          <p className="text-xs text-slate-500">
            Chips reutilizables — se insertan al cursor con un click y, las marcadas con <span className="font-semibold text-violet-700">IA</span>, alimentan el system prompt del agente como formulaciones aprobadas.
          </p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          data-testid="quick-replies-create"
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-500 px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgb(99_102_241/0.5)] hover:-translate-y-0.5 transition"
        >
          <AddIcon sx={{ fontSize: 18 }} />
          Nueva respuesta
        </button>
        <button
          type="button"
          onClick={() => { setRefreshing(true); void load(); }}
          disabled={refreshing}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshIcon sx={{ fontSize: 16 }} className={`text-violet-600 ${refreshing ? "animate-spin" : ""}`} />
          Recargar
        </button>
      </div>

      {/* ACTIVE LIST */}
      {grouped.active.length === 0 && grouped.inactive.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-8 text-center text-sm text-slate-500">
          Todavía no hay respuestas rápidas. Tocá "Nueva respuesta" para empezar — empezá por las recurrentes (stock, envíos, dirección).
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {grouped.active.map((r) => (
            <li
              key={r.id}
              data-testid={`quick-reply-row-${r.label}`}
              className="rounded-xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] hover:shadow-[0_8px_20px_-8px_rgb(15_23_42/0.15)] transition"
            >
              <div className="flex items-start gap-2">
                <span className="inline-flex shrink-0 items-center rounded-md bg-slate-900 px-2 py-0.5 font-mono text-[11px] font-semibold text-white">
                  {r.label}
                </span>
                {r.feedAi && (
                  <span
                    title="Se inyecta al system prompt de la IA"
                    className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700"
                  >
                    <AutoFixHighIcon sx={{ fontSize: 11 }} />
                    IA
                  </span>
                )}
                {r.category && (
                  <span className="inline-flex shrink-0 items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                    {r.category}
                  </span>
                )}
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-slate-400">
                  {r.hitCount} uso{r.hitCount === 1 ? "" : "s"} · {fmtLastUsed(r.lastUsedAt)}
                </span>
              </div>
              <p className="mt-2 line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-slate-700">
                {r.body}
              </p>
              <div className="mt-2 flex items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => startEdit(r)}
                  title="Editar"
                  className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  <EditIcon sx={{ fontSize: 14 }} />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(r)}
                  title="Eliminar"
                  className="grid h-7 w-7 place-items-center rounded-md text-rose-600 hover:bg-rose-50"
                >
                  <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {grouped.inactive.length > 0 && (
        <details className="rounded-xl border border-slate-200/70 bg-slate-50/40 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-600">
            Inactivas ({grouped.inactive.length})
          </summary>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {grouped.inactive.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-slate-200/70 bg-white/60 p-3 opacity-70"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-md bg-slate-400 px-2 py-0.5 font-mono text-[11px] font-semibold text-white">
                    {r.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => startEdit(r)}
                    className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                  >
                    <VisibilityIcon sx={{ fontSize: 12 }} />
                    Reactivar
                  </button>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">{r.body}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* FORM DIALOG */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-900">
              {form.id ? "Editar respuesta rápida" : "Nueva respuesta rápida"}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              La etiqueta es lo que ve el operador en el chip; el cuerpo es lo que se inserta o aparece en el prompt de la IA.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Etiqueta <span className="text-slate-400">(MAYÚSCULAS, sin espacios largos)</span>
                </label>
                <Input
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder='Ej. "HAY STOCK", "ENVIOS", "MASILLA 10 MIN"'
                  disabled={saving}
                  data-testid="quick-reply-form-label"
                  maxLength={40}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Cuerpo
                </label>
                <textarea
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  rows={5}
                  placeholder="El texto que se inserta al cursor. Sin saludo ni firma — eso lo agrega el canal."
                  disabled={saving}
                  data-testid="quick-reply-form-body"
                  className="w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-sm leading-relaxed placeholder:text-slate-400 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-500/15"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
                    Categoría (opcional)
                  </label>
                  <Input
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    placeholder="envios, stock, técnico…"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
                    Orden visual
                  </label>
                  <Input
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                    disabled={saving}
                  />
                </div>
              </div>
              <div className="flex items-center gap-4 rounded-xl border border-slate-200/70 bg-slate-50/50 px-3 py-2">
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                    disabled={saving}
                  />
                  <span className="inline-flex items-center gap-1">
                    {form.active ? <VisibilityIcon sx={{ fontSize: 14 }} /> : <VisibilityOffIcon sx={{ fontSize: 14 }} />}
                    Activa
                  </span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.feedAi}
                    onChange={(e) => setForm({ ...form, feedAi: e.target.checked })}
                    disabled={saving}
                  />
                  <span className="inline-flex items-center gap-1">
                    <AutoFixHighIcon sx={{ fontSize: 14 }} className="text-violet-600" />
                    Alimentar a la IA (inyectar al system prompt)
                  </span>
                </label>
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
                data-testid="quick-reply-form-save"
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-6px_rgb(124_58_237/0.5)] hover:bg-violet-700 disabled:opacity-60"
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

      {/* DELETE CONFIRM */}
      <AlertDialog open={deleting != null} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar respuesta rápida</AlertDialogTitle>
            <AlertDialogDescription>
              Se va a eliminar la respuesta <strong>{deleting?.label}</strong>. Si la usás para alimentar a la IA, la formulación dejará de aparecer en el prompt de Claude.
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
