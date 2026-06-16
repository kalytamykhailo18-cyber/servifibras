"use client";

// Marcos 2026-06-15 — admin-curated tarifa por (mensajería, zona) que
// alimenta el "estimado a pagar" del card de Despachos en Analíticas.
// Sin esta tabla el card solo muestra lo cobrado al cliente desde TN/ML;
// con ella aparece la estimación junto al cobrado, para poder cotejar
// la factura del courier independientemente de qué tan completo venga
// el dato desde la plataforma.

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { dispatchTariffsApi, type DispatchTariff } from "@/lib/api/endpoints";
import { toast } from "sonner";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import LocalAtmIcon from "@mui/icons-material/LocalAtm";
import SaveIcon from "@mui/icons-material/Save";

type Draft = {
  carrier: string;
  zone: string;
  costPerPackage: string;
  notes: string;
};

const EMPTY_DRAFT: Draft = { carrier: "", zone: "", costPerPackage: "", notes: "" };

function fmtMoney(n: number, currency = "ARS"): string {
  return `${currency} ${Math.round(n).toLocaleString("es-AR")}`;
}

export function DispatchTariffsForm() {
  const [rows, setRows] = useState<DispatchTariff[] | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Record<string, Partial<DispatchTariff>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const data = await dispatchTariffsApi.list();
      setRows(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudieron cargar las tarifas");
      setRows([]);
    }
  };
  useEffect(() => { void refresh(); }, []);

  const grouped = useMemo(() => {
    if (!rows) return null;
    const byCarrier = new Map<string, DispatchTariff[]>();
    for (const r of rows) {
      const arr = byCarrier.get(r.carrier) ?? [];
      arr.push(r);
      byCarrier.set(r.carrier, arr);
    }
    for (const [, arr] of byCarrier) arr.sort((a, b) => a.zone.localeCompare(b.zone));
    return Array.from(byCarrier.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const onCreate = async () => {
    const carrier = draft.carrier.trim();
    const zone = draft.zone.trim();
    const cost = Number(draft.costPerPackage);
    if (!carrier) { toast.error("Cargá el nombre de la mensajería"); return; }
    if (!zone) { toast.error("Cargá la zona"); return; }
    if (!Number.isFinite(cost) || cost < 0) { toast.error("El costo por paquete tiene que ser un número ≥ 0"); return; }
    setCreating(true);
    try {
      await dispatchTariffsApi.create({
        carrier,
        zone,
        costPerPackage: cost,
        notes: draft.notes.trim() || null,
      });
      toast.success("Tarifa cargada");
      setDraft(EMPTY_DRAFT);
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo crear la tarifa");
    } finally {
      setCreating(false);
    }
  };

  const onSaveEdit = async (id: string) => {
    const patch = editing[id];
    if (!patch) return;
    setSavingId(id);
    try {
      const sanitised: any = {};
      if (patch.carrier !== undefined) sanitised.carrier = String(patch.carrier).trim();
      if (patch.zone !== undefined) sanitised.zone = String(patch.zone).trim();
      if (patch.costPerPackage !== undefined) sanitised.costPerPackage = Number(patch.costPerPackage);
      if (patch.notes !== undefined) sanitised.notes = patch.notes === '' ? null : patch.notes;
      if (patch.active !== undefined) sanitised.active = patch.active;
      await dispatchTariffsApi.update(id, sanitised);
      toast.success("Tarifa actualizada");
      setEditing((prev) => { const n = { ...prev }; delete n[id]; return n; });
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo actualizar");
    } finally {
      setSavingId(null);
    }
  };

  const onDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await dispatchTariffsApi.remove(id);
      toast.success("Tarifa eliminada");
      await refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo eliminar");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-500 text-white">
          <LocalAtmIcon sx={{ fontSize: 16 }} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Tarifas por mensajería y zona</h2>
          <p className="text-[11px] text-slate-500">
            Cargá lo que cobra cada courier por paquete según la zona. El card de Despachos en Analíticas usa
            estos valores para mostrar el estimado a pagar junto al cobrado al cliente.
          </p>
        </div>
      </div>

      {/* Create draft row */}
      <div className="mb-4 grid grid-cols-1 gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/40 p-3 sm:grid-cols-[1fr_1fr_140px_1fr_auto]">
        <Input
          value={draft.carrier}
          onChange={(e) => setDraft({ ...draft, carrier: e.target.value })}
          placeholder="Mensajería (Andreani, JyJ…)"
          data-testid="dispatch-tariff-new-carrier"
        />
        <Input
          value={draft.zone}
          onChange={(e) => setDraft({ ...draft, zone: e.target.value })}
          placeholder="Zona (CABA, GBA 1, Interior…)"
          data-testid="dispatch-tariff-new-zone"
        />
        <Input
          value={draft.costPerPackage}
          onChange={(e) => setDraft({ ...draft, costPerPackage: e.target.value })}
          placeholder="$ / paquete"
          inputMode="decimal"
          data-testid="dispatch-tariff-new-cost"
        />
        <Input
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          placeholder="Nota (opcional)"
          data-testid="dispatch-tariff-new-notes"
        />
        <button
          type="button"
          onClick={onCreate}
          disabled={creating}
          data-testid="dispatch-tariff-new-save"
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-500 px-3 text-xs font-semibold text-white shadow-sm hover:brightness-105 disabled:opacity-60"
        >
          {creating ? "Guardando…" : (<><AddIcon sx={{ fontSize: 14 }} /> Agregar</>)}
        </button>
      </div>

      {/* List */}
      {rows === null ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : grouped?.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-6 text-center text-xs text-slate-500" data-testid="dispatch-tariffs-empty">
          Todavía no cargaste tarifas. Empezá agregando una arriba.
        </p>
      ) : (
        <ul className="space-y-3" data-testid="dispatch-tariffs-list">
          {grouped!.map(([carrier, tariffs]) => (
            <li key={carrier} className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 bg-slate-50/60 px-3 py-2 text-sm font-semibold text-slate-800">
                {carrier}
              </div>
              <ul className="divide-y divide-slate-100">
                {tariffs.map((t) => {
                  const edit = editing[t.id];
                  const isEditing = !!edit;
                  const zoneVal = (edit?.zone ?? t.zone) as string;
                  const costVal = String(edit?.costPerPackage ?? t.costPerPackage);
                  const notesVal = (edit?.notes ?? t.notes ?? '') as string;
                  return (
                    <li key={t.id} className="grid grid-cols-1 gap-2 px-3 py-2 sm:grid-cols-[1fr_140px_1fr_auto_auto] sm:items-center"
                        data-testid={`dispatch-tariff-row-${t.id}`}>
                      {isEditing ? (
                        <Input value={zoneVal} onChange={(e) => setEditing((p) => ({ ...p, [t.id]: { ...p[t.id], zone: e.target.value } }))} />
                      ) : (
                        <span className="text-sm text-slate-800">{t.zone}</span>
                      )}
                      {isEditing ? (
                        <Input value={costVal} onChange={(e) => setEditing((p) => ({ ...p, [t.id]: { ...p[t.id], costPerPackage: Number(e.target.value) } }))} inputMode="decimal" />
                      ) : (
                        <span className="font-mono text-sm tabular-nums text-emerald-700">{fmtMoney(t.costPerPackage, t.currency)}</span>
                      )}
                      {isEditing ? (
                        <Input value={notesVal} onChange={(e) => setEditing((p) => ({ ...p, [t.id]: { ...p[t.id], notes: e.target.value } }))} placeholder="Nota" />
                      ) : (
                        <span className="text-[11px] text-slate-500">{t.notes || '—'}</span>
                      )}
                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => onSaveEdit(t.id)}
                              disabled={savingId === t.id}
                              className="inline-flex h-8 items-center gap-1 rounded-md bg-emerald-600 px-2 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                              data-testid={`dispatch-tariff-save-${t.id}`}
                            >
                              <SaveIcon sx={{ fontSize: 13 }} />
                              {savingId === t.id ? "Guardando…" : "Guardar"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing((p) => { const n = { ...p }; delete n[t.id]; return n; })}
                              className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditing((p) => ({ ...p, [t.id]: {} }))}
                            className="inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                            data-testid={`dispatch-tariff-edit-${t.id}`}
                          >
                            Editar
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onDelete(t.id)}
                        disabled={deletingId === t.id}
                        className="inline-flex h-8 items-center justify-center rounded-md border border-rose-200 bg-rose-50 px-2 text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                        title="Eliminar tarifa"
                        data-testid={`dispatch-tariff-delete-${t.id}`}
                      >
                        <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
