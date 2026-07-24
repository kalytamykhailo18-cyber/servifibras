"use client";

// Marcos 2026-07-24: alias de mensajerías. El admin edita el mapa
// raw → nombre canónico (ej. "Servifibras" → "JyJ") sin toque de
// deploy. Se aplica antes de las reglas hardcoded de normalizeCarrier.

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { carrierAliasesApi, type CarrierAlias } from "@/lib/api/endpoints";
import { toast } from "sonner";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import SaveIcon from "@mui/icons-material/Save";

type Draft = { rawPattern: string; mappedName: string; notes: string };
const EMPTY: Draft = { rawPattern: "", mappedName: "", notes: "" };

export function CarrierAliasesForm() {
  const [rows, setRows] = useState<CarrierAlias[] | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, Partial<CarrierAlias>>>({});

  const refresh = async () => {
    try {
      const data = await carrierAliasesApi.list();
      setRows(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudieron cargar los alias");
      setRows([]);
    }
  };
  useEffect(() => { void refresh(); }, []);

  const onCreate = async () => {
    const raw = draft.rawPattern.trim();
    const mapped = draft.mappedName.trim();
    if (!raw) { toast.error("Cargá el texto que viene de la plataforma"); return; }
    if (!mapped) { toast.error("Cargá el nombre corto al que querés mapear"); return; }
    setCreating(true);
    try {
      await carrierAliasesApi.create({ rawPattern: raw, mappedName: mapped, notes: draft.notes.trim() || null });
      toast.success(`Alias cargado: "${raw}" → "${mapped}"`);
      setDraft(EMPTY);
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo crear el alias");
    } finally { setCreating(false); }
  };

  const onSave = async (id: string) => {
    const patch = editing[id];
    if (!patch || Object.keys(patch).length === 0) return;
    setSavingId(id);
    try {
      await carrierAliasesApi.update(id, patch);
      toast.success("Alias actualizado");
      setEditing((e) => { const c = { ...e }; delete c[id]; return c; });
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo actualizar");
    } finally { setSavingId(null); }
  };

  const onDelete = async (id: string) => {
    if (!confirm("¿Borrar este alias? Los pedidos con esa mensajería vuelven a la regla por defecto.")) return;
    setDeletingId(id);
    try {
      await carrierAliasesApi.remove(id);
      toast.success("Alias borrado");
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo borrar");
    } finally { setDeletingId(null); }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="mb-4 flex items-start gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-400 text-white">
          <SwapHorizIcon />
        </span>
        <div>
          <h3 className="text-base font-semibold text-slate-900">Alias de mensajerías</h3>
          <p className="text-xs text-slate-500">
            Cuando TN o ML mandan un nombre raro (ej. "Servifibras", "Flex_373"), acá lo mapeás al nombre corto que usás vos (JyJ, Andreani, etc.).
          </p>
        </div>
      </header>

      {/* CREATE ROW */}
      <div className="mb-5 grid gap-2 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 p-3 sm:grid-cols-[1.2fr_1fr_1.4fr_auto]">
        <Input
          placeholder="Texto que viene de TN/ML"
          value={draft.rawPattern}
          onChange={(e) => setDraft((d) => ({ ...d, rawPattern: e.target.value }))}
        />
        <Input
          placeholder="Mapear a…"
          value={draft.mappedName}
          onChange={(e) => setDraft((d) => ({ ...d, mappedName: e.target.value }))}
        />
        <Input
          placeholder="Nota opcional"
          value={draft.notes}
          onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
        />
        <button
          type="button"
          onClick={onCreate}
          disabled={creating}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          <AddIcon sx={{ fontSize: 16 }} /> Agregar
        </button>
      </div>

      {/* LIST */}
      {!rows ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => (<Skeleton key={i} className="h-11" />))}</div>
      ) : rows.length === 0 ? (
        <p className="text-sm italic text-slate-500">No hay alias configurados. Agregá uno arriba.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Raw (TN/ML)</th>
                <th className="px-3 py-2 text-left">Mapear a</th>
                <th className="px-3 py-2 text-left">Nota</th>
                <th className="px-3 py-2 text-center">Activo</th>
                <th className="w-24 px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const patch = editing[r.id] ?? {};
                const rawVal = patch.rawPattern ?? r.rawPattern;
                const mappedVal = patch.mappedName ?? r.mappedName;
                const notesVal = patch.notes ?? r.notes ?? "";
                const activeVal = patch.active ?? r.active;
                const dirty = Object.keys(patch).length > 0;
                return (
                  <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/40">
                    <td className="px-3 py-2">
                      <Input
                        value={rawVal}
                        onChange={(e) => setEditing((p) => ({ ...p, [r.id]: { ...p[r.id], rawPattern: e.target.value } }))}
                        className="h-8 text-sm"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={mappedVal}
                        onChange={(e) => setEditing((p) => ({ ...p, [r.id]: { ...p[r.id], mappedName: e.target.value } }))}
                        className="h-8 text-sm"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        value={notesVal}
                        onChange={(e) => setEditing((p) => ({ ...p, [r.id]: { ...p[r.id], notes: e.target.value } }))}
                        className="h-8 text-sm"
                        placeholder="—"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={activeVal}
                        onChange={(e) => setEditing((p) => ({ ...p, [r.id]: { ...p[r.id], active: e.target.checked } }))}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-1">
                        <button
                          type="button"
                          onClick={() => onSave(r.id)}
                          disabled={!dirty || savingId === r.id}
                          title={dirty ? "Guardar cambios" : "Sin cambios"}
                          className="inline-flex h-8 items-center gap-1 rounded-md bg-indigo-600 px-2 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
                        >
                          <SaveIcon sx={{ fontSize: 12 }} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(r.id)}
                          disabled={deletingId === r.id}
                          title="Borrar"
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-rose-200 bg-white px-2 text-[11px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                        >
                          <DeleteOutlineIcon sx={{ fontSize: 12 }} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
