"use client";

// Marcos 2026-06-22 — catálogo de responsables operativos (personal
// de depósito). Lo administra ADMIN desde Settings → Logística. El
// form de pedidos en el tab REPOSICIÓN consume la lista activa para
// que el operador marque quién armó mal el paquete; la card de
// "costo por responsable" en /analytics agrupa el shippingCost de
// las reposiciones por este id.

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { operationalResponsiblesApi, type OperationalResponsible } from "@/lib/api/endpoints";
import { toast } from "sonner";
import AddIcon from "@mui/icons-material/Add";
import SaveIcon from "@mui/icons-material/Save";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import RestoreIcon from "@mui/icons-material/Restore";
import PersonOutlineIcon from "@mui/icons-material/Person2Outlined";

export function OperationalResponsiblesForm() {
  const [rows, setRows] = useState<OperationalResponsible[] | null>(null);
  const [draftName, setDraftName] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const data = await operationalResponsiblesApi.list();
      setRows(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudieron cargar los responsables");
      setRows([]);
    }
  };
  useEffect(() => { void refresh(); }, []);

  const onCreate = async () => {
    const name = draftName.trim();
    if (!name) { toast.error("Cargá el nombre del responsable"); return; }
    setCreating(true);
    try {
      await operationalResponsiblesApi.create({ name });
      toast.success("Responsable agregado");
      setDraftName("");
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo crear el responsable");
    } finally {
      setCreating(false);
    }
  };

  const onSaveEdit = async (id: string) => {
    const name = (editing[id] ?? '').trim();
    if (!name) { toast.error("El nombre no puede quedar vacío"); return; }
    setSavingId(id);
    try {
      await operationalResponsiblesApi.update(id, { name });
      toast.success("Responsable actualizado");
      setEditing((prev) => { const n = { ...prev }; delete n[id]; return n; });
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo actualizar");
    } finally {
      setSavingId(null);
    }
  };

  const onToggleActive = async (r: OperationalResponsible) => {
    setTogglingId(r.id);
    try {
      if (r.active) {
        await operationalResponsiblesApi.archive(r.id);
        toast.success("Archivado — ya no aparece en el picker");
      } else {
        await operationalResponsiblesApi.update(r.id, { active: true });
        toast.success("Reactivado");
      }
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo cambiar el estado");
    } finally {
      setTogglingId(null);
    }
  };

  const actives = (rows ?? []).filter((r) => r.active);
  const archived = (rows ?? []).filter((r) => !r.active);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-amber-600 to-orange-500 text-white">
          <PersonOutlineIcon sx={{ fontSize: 16 }} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Responsables de depósito</h2>
          <p className="text-[11px] text-slate-500">
            Nombres que aparecen en el picker del tab REPOSICIÓN del form de Pedidos. El reporte de costo por
            responsable en Analíticas agrupa los shippingCost de los re-despachos por este nombre.
          </p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-2 rounded-xl border border-amber-200/70 bg-amber-50/40 p-3 sm:grid-cols-[1fr_auto]">
        <Input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder="Nombre y apellido"
          data-testid="responsible-new-name"
          onKeyDown={(e) => { if (e.key === 'Enter') void onCreate(); }}
        />
        <button
          type="button"
          onClick={onCreate}
          disabled={creating}
          data-testid="responsible-new-save"
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-600 to-orange-500 px-3 text-xs font-semibold text-white shadow-sm hover:brightness-105 disabled:opacity-60"
        >
          {creating ? "Guardando…" : (<><AddIcon sx={{ fontSize: 14 }} /> Agregar</>)}
        </button>
      </div>

      {rows === null ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : (rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-6 text-center text-xs text-slate-500" data-testid="responsibles-empty">
          Todavía no cargaste responsables. Sumá uno arriba para habilitar el picker del tab REPOSICIÓN.
        </p>
      ) : (
        <div className="space-y-4" data-testid="responsibles-list">
          {actives.length > 0 && (
            <div>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-amber-700">
                Activos ({actives.length})
              </h3>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {actives.map((r) => {
                  const isEditing = editing[r.id] !== undefined;
                  return (
                    <li key={r.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-3 py-2" data-testid={`responsible-row-${r.id}`}>
                      {isEditing ? (
                        <Input
                          value={editing[r.id]}
                          onChange={(e) => setEditing((p) => ({ ...p, [r.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') void onSaveEdit(r.id); }}
                        />
                      ) : (
                        <span className="text-sm text-slate-800">{r.name}</span>
                      )}
                      <div className="flex items-center gap-1">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => onSaveEdit(r.id)}
                              disabled={savingId === r.id}
                              className="inline-flex h-8 items-center gap-1 rounded-md bg-emerald-600 px-2 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                              data-testid={`responsible-save-${r.id}`}
                            >
                              <SaveIcon sx={{ fontSize: 13 }} />
                              {savingId === r.id ? "Guardando…" : "Guardar"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing((p) => { const n = { ...p }; delete n[r.id]; return n; })}
                              className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditing((p) => ({ ...p, [r.id]: r.name }))}
                            className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                            data-testid={`responsible-edit-${r.id}`}
                          >
                            Renombrar
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onToggleActive(r)}
                        disabled={togglingId === r.id}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                        title="Archivar (saca del picker pero preserva el historial)"
                        data-testid={`responsible-archive-${r.id}`}
                      >
                        <ArchiveOutlinedIcon sx={{ fontSize: 13 }} />
                        Archivar
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {archived.length > 0 && (
            <div>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Archivados ({archived.length})
              </h3>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50/40">
                {archived.map((r) => (
                  <li key={r.id} className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-2" data-testid={`responsible-row-${r.id}`}>
                    <span className="text-sm text-slate-500 line-through">{r.name}</span>
                    <button
                      type="button"
                      onClick={() => onToggleActive(r)}
                      disabled={togglingId === r.id}
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                      data-testid={`responsible-restore-${r.id}`}
                    >
                      <RestoreIcon sx={{ fontSize: 13 }} />
                      Reactivar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
