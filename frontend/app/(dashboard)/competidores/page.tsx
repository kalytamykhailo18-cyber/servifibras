"use client";

/**
 * Marcos 2026-06-24: página centralizada de Competidores.
 *
 * Antes este feature vivía como diálogo dentro de /products — había
 * que ir a la fila del producto y clickear el ícono de competidores
 * para abrirlo. Marcos no la encontraba ("¿en qué panel está?"). Esta
 * página agrega TODOS los productos con watches cargados en un solo
 * lugar, con un alta rápida arriba (producto + MLA ID + label
 * opcional). Una fila por producto, dentro de cada una la lista de
 * competidores con título / precio / stock / link a la publicación.
 */

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoleGuard } from "@/lib/hooks/use-role-guard";
import { api, competitorRowId, type CompetitorList, type CompetitorWatch } from "@/lib/api/endpoints";
import { UserRole } from "@/types";
import { toast } from "sonner";
import VisibilityIcon from "@mui/icons-material/Visibility";
import RefreshIcon from "@mui/icons-material/Refresh";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import AddIcon from "@mui/icons-material/Add";
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

const ROLES = [UserRole.ADMIN, UserRole.VENTAS];

function fmtArs(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `ARS ${Math.round(v).toLocaleString("es-AR")}`;
}

function priceDelta(ours: number | null, theirs: number | null | undefined): { label: string; tone: 'down' | 'up' | 'flat' | 'na' } {
  if (ours == null || theirs == null || !Number.isFinite(ours) || !Number.isFinite(theirs)) return { label: '—', tone: 'na' };
  const diff = theirs - ours;
  if (diff === 0) return { label: '= mismo precio', tone: 'flat' };
  const pct = (diff / ours) * 100;
  if (diff > 0) return { label: `+${pct.toFixed(0)}% más caro`, tone: 'down' };
  return { label: `${pct.toFixed(0)}% más barato`, tone: 'up' };
}

export default function CompetidoresPage() {
  const { isAllowed } = useRoleGuard(ROLES);
  const [groups, setGroups] = useState<CompetitorList[] | null>(null);
  const [productPool, setProductPool] = useState<Array<{ id: string; name: string; sku: string | null }>>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<string>("");
  const [newProductSearch, setNewProductSearch] = useState<string>("");
  const [newProductId, setNewProductId] = useState<string>("");
  const [newItemId, setNewItemId] = useState<string>("");
  const [newLabel, setNewLabel] = useState<string>("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // Marcos 2026-08-12: eliminar competidor pasa por AlertDialog custom
  // — antes usaba window.confirm() (viola feedback_custom_confirm_modals
  // y no se puede seleccionar/copiar el mensaje). El estado guarda el
  // watch que el operador está por eliminar; null = cerrado.
  const [removingWatch, setRemovingWatch] = useState<CompetitorWatch | null>(null);
  const [removingBusy, setRemovingBusy] = useState<boolean>(false);

  const load = async (opts?: { force?: boolean }) => {
    if (opts?.force) setRefreshing(true);
    try {
      const data = await api.competitors.listAll(opts);
      setGroups(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudieron cargar los competidores");
      setGroups([]);
    } finally {
      if (opts?.force) setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!isAllowed) return;
    void load();
    void (async () => {
      try {
        const ps = await api.products.list({ activeOnly: true });
        setProductPool(ps.map((p: any) => ({ id: p.id, name: p.name, sku: p.sku ?? null })));
      } catch {/* non-fatal */}
    })();
  }, [isAllowed]);

  const filteredGroups = useMemo(() => {
    if (!groups) return null;
    const q = filter.trim().toLowerCase();
    if (q.length === 0) return groups;
    return groups.filter((g) => {
      if (g.productName.toLowerCase().includes(q)) return true;
      if ((g.productSku ?? '').toLowerCase().includes(q)) return true;
      return g.watches.some((w) => (w.title ?? '').toLowerCase().includes(q) || w.itemId.toLowerCase().includes(q));
    });
  }, [groups, filter]);

  const productSuggestions = useMemo(() => {
    const q = newProductSearch.trim().toLowerCase();
    if (q.length === 0) return [];
    return productPool
      .filter((p) => p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [productPool, newProductSearch]);

  const onAdd = async () => {
    if (!newProductId) { toast.error("Elegí un producto del listado"); return; }
    const itemId = newItemId.trim();
    if (!/^MLA\d{6,}$/i.test(itemId)) { toast.error("El item ID tiene que empezar con MLA seguido de números"); return; }
    setAdding(true);
    try {
      await api.competitors.add({
        productId: newProductId,
        itemId: itemId.toUpperCase(),
        label: newLabel.trim() || undefined,
      });
      toast.success("Competidor agregado");
      setNewProductSearch("");
      setNewProductId("");
      setNewItemId("");
      setNewLabel("");
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo agregar");
    } finally {
      setAdding(false);
    }
  };

  const doRemove = async (w: CompetitorWatch) => {
    const id = competitorRowId(w);
    if (!id) return;
    setRemovingBusy(true);
    setBusy((prev) => ({ ...prev, [id]: true }));
    try {
      await api.competitors.remove(id);
      toast.success("Competidor eliminado");
      await load();
      setRemovingWatch(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo eliminar");
    } finally {
      setBusy((prev) => ({ ...prev, [id]: false }));
      setRemovingBusy(false);
    }
  };
  const onRemove = (w: CompetitorWatch) => setRemovingWatch(w);

  if (!isAllowed) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
            <VisibilityIcon sx={{ fontSize: 20 }} />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Seguimiento de competidores</h1>
            <p className="text-xs text-slate-500">
              Publicaciones de ML que estás siguiendo para comparar precio + stock con tus propios productos.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load({ force: true })}
          disabled={refreshing}
          data-testid="competidores-refresh"
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshIcon sx={{ fontSize: 14 }} className={refreshing ? "animate-spin" : ""} />
          Refrescar precios
        </button>
      </div>

      {/* Alta rápida */}
      <section className="rounded-2xl border border-violet-200 bg-violet-50/40 p-4 space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-700">
          Agregar competidor
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1.5fr_1.5fr_auto]">
          <div className="relative">
            <Input
              value={newProductSearch}
              onChange={(e) => { setNewProductSearch(e.target.value); setNewProductId(""); }}
              placeholder="Buscar tu producto (nombre o SKU)"
              data-testid="competidores-new-product-search"
              className="h-10"
            />
            {productSuggestions.length > 0 && newProductId === "" && (
              <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                {productSuggestions.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => { setNewProductId(p.id); setNewProductSearch(`${p.name}${p.sku ? ` · ${p.sku}` : ''}`); }}
                      className="block w-full truncate px-3 py-2 text-left text-xs text-slate-700 hover:bg-violet-50"
                    >
                      <span className="font-medium">{p.name}</span>
                      {p.sku && <span className="ml-2 text-[10px] text-slate-500">SKU {p.sku}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Input
            value={newItemId}
            onChange={(e) => setNewItemId(e.target.value)}
            placeholder="MLA item del competidor"
            data-testid="competidores-new-item-id"
            className="h-10"
          />
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Etiqueta (opcional)"
            data-testid="competidores-new-label"
            className="h-10"
          />
          <button
            type="button"
            onClick={onAdd}
            disabled={adding || !newProductId || !newItemId.trim()}
            data-testid="competidores-new-save"
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 text-xs font-semibold text-white shadow-sm hover:brightness-105 disabled:opacity-60"
          >
            {adding ? "Agregando…" : (<><AddIcon sx={{ fontSize: 14 }} /> Agregar</>)}
          </button>
        </div>
      </section>

      {/* Filtro */}
      <div>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar por producto, SKU o item ID"
          data-testid="competidores-filter"
          className="h-10 max-w-md"
        />
      </div>

      {/* Listado */}
      {filteredGroups === null ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : filteredGroups.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 px-4 py-10 text-center text-sm text-slate-500" data-testid="competidores-empty">
          {filter ? `Sin resultados para "${filter}".` : "No hay competidores cargados. Sumá uno arriba para empezar a seguir su precio."}
        </p>
      ) : (
        <ul className="space-y-3" data-testid="competidores-list">
          {filteredGroups.map((g) => (
            <li key={g.productId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{g.productName}</p>
                  <p className="text-[11px] text-slate-500">
                    {g.productSku && <>SKU {g.productSku} · </>}
                    Mi precio: <span className="font-mono tabular-nums text-emerald-700">{fmtArs(g.productPriceArs)}</span>
                    {g.ourStock != null && <> · stock {g.ourStock}</>}
                  </p>
                </div>
                <span className="inline-flex h-5 items-center rounded-full bg-violet-100 px-2 text-[10px] font-semibold text-violet-700">
                  {g.watches.length} competidor{g.watches.length === 1 ? '' : 'es'}
                </span>
              </div>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {g.watches.map((w) => {
                  const id = competitorRowId(w);
                  const delta = priceDelta(g.productPriceArs, w.price ?? null);
                  return (
                    <li key={id || w.itemId} className="grid grid-cols-[1fr_120px_140px_auto] items-center gap-3 px-3 py-2" data-testid={`competidores-row-${w.itemId}`}>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-800">
                          {w.title || w.label || w.itemId}
                          {w.label && w.title && <span className="ml-2 text-[10px] text-slate-500">· {w.label}</span>}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {w.sellerNickname && <>{w.sellerNickname} · </>}
                          {w.itemId}
                          {w.error && <span className="ml-2 text-rose-600">· {w.error}</span>}
                        </p>
                      </div>
                      <span className="font-mono text-sm tabular-nums text-slate-800">
                        {fmtArs(w.price ?? null)}
                      </span>
                      <span className={
                        "text-[11px] font-medium " +
                        (delta.tone === 'up' ? 'text-emerald-700' : delta.tone === 'down' ? 'text-rose-700' : delta.tone === 'flat' ? 'text-slate-500' : 'text-slate-400')
                      }>
                        {delta.label}
                      </span>
                      <div className="flex items-center gap-1">
                        {w.permalink && (
                          <a
                            href={w.permalink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                            title="Abrir publicación en ML"
                          >
                            <OpenInNewIcon sx={{ fontSize: 14 }} />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemove(w)}
                          disabled={!!busy[id || '']}
                          className="grid h-8 w-8 place-items-center rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                          title="Sacar del seguimiento"
                          data-testid={`competidores-remove-${w.itemId}`}
                        >
                          <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={removingWatch !== null}
        onOpenChange={(v) => {
          if (!v && !removingBusy) setRemovingWatch(null);
        }}
      >
        <AlertDialogContent data-testid="competidores-remove-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Sacar competidor del seguimiento</AlertDialogTitle>
            <AlertDialogDescription>
              {removingWatch
                ? `Vas a dejar de seguir ${removingWatch.title || removingWatch.label || removingWatch.itemId} (${removingWatch.itemId}). No se pierde histórico; podés volver a agregarlo cuando quieras.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={removingBusy}
              data-testid="competidores-remove-confirm"
              onClick={() => { if (removingWatch) void doRemove(removingWatch); }}
            >
              {removingBusy ? 'Sacando…' : 'Sacar del seguimiento'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
