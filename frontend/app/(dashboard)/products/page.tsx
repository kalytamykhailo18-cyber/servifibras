"use client";

// Marcos's structured product catalog. ADMIN-only because catalog data
// drives AI replies, pricing and campaigns — too sensitive for any
// operator role to edit.
//
// One-page UX: search bar + table on top, simple inline form on the right
// for create / edit, and a CSV import button. Bulk import uses the same
// upsert path as the (future) TiendaNube sync.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, type Product } from "@/lib/api/endpoints";
import { UserRole } from "@/types";
import { useRoleGuard } from "@/lib/hooks/use-role-guard";
import { useAuthStore, selectUserRole } from "@/lib/store/auth-store";
import { useClientPagination } from "@/lib/hooks/use-client-pagination";
import { Pagination } from "@/components/ui/pagination";
import CategoryIcon from "@mui/icons-material/Category";
import AddIcon from "@mui/icons-material/Add";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import RefreshIcon from "@mui/icons-material/Refresh";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { CompetitorsDialog } from "@/components/products/competitors-dialog";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import SearchIcon from "@mui/icons-material/Search";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import HighlightOffIcon from "@mui/icons-material/HighlightOff";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Read is open to every role (matches backend GET /admin/products
// allowing all 4 roles) so operators can look up SKU + price + stock
// while replying to a customer. Writes (create / edit / delete /
// import) stay ADMIN-only via the canWrite gate below.
const ROLES = [UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA];
const ADMIN_ONLY_WRITE_TOOLTIP = "Solo Administrador puede modificar el catálogo";

const SOURCE_LABEL: Record<string, string> = {
  MANUAL:     "Manual",
  IMPORT:     "Importado",
  TIENDANUBE: "TiendaNube",
};

interface FormState {
  id: string | null;
  sku: string;
  name: string;
  category: string;
  description: string;
  baseUnit: string;
  basePriceArs: string;
  basePriceUsd: string;
  inStock: boolean;
  stockQuantity: string;
  lowStockThreshold: string;
  // Bloque C — Marcos 2026-06-06: short alias the warehouse picker
  // sees on the daily logistics file. Empty here = backend auto-seeds
  // from the first 40 chars of `name` on save.
  armadorAlias: string;
}

const EMPTY_FORM: FormState = {
  id: null, sku: "", name: "", category: "", description: "",
  baseUnit: "L", basePriceArs: "", basePriceUsd: "", inStock: true,
  stockQuantity: "", lowStockThreshold: "",
  armadorAlias: "",
};

export default function ProductsPage() {
  const { isAllowed } = useRoleGuard(ROLES);
  const role = useAuthStore(selectUserRole);
  const canWrite = role === UserRole.ADMIN;
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [competitorsTarget, setCompetitorsTarget] = useState<{ id: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pg = useClientPagination(items, { storageKey: "products", defaultPageSize: 25 });

  const refresh = async () => {
    try {
      setLoading(true);
      const list = await api.products.list({ search });
      setItems(list);
    } catch (err: any) {
      toast.error(err?.message ?? "Error cargando catálogo");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAllowed) refresh();
  }, [isAllowed]);

  // Search debounce
  useEffect(() => {
    if (!isAllowed) return;
    const t = setTimeout(() => { void refresh(); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const startEdit = (p: Product) => {
    setForm({
      id: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      description: p.description ?? "",
      baseUnit: p.baseUnit,
      basePriceArs: p.basePriceArs != null ? String(p.basePriceArs) : "",
      basePriceUsd: p.basePriceUsd != null ? String(p.basePriceUsd) : "",
      inStock: p.inStock,
      stockQuantity: p.stockQuantity != null ? String(p.stockQuantity) : "",
      lowStockThreshold: p.lowStockThreshold != null ? String(p.lowStockThreshold) : "",
      armadorAlias: p.armadorAlias ?? "",
    });
    setFormOpen(true);
  };

  const startCreate = () => {
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const cancelEdit = () => { setFormOpen(false); setForm(EMPTY_FORM); };

  const submit = async () => {
    if (!form.sku.trim() || !form.name.trim() || !form.category.trim()) {
      toast.error("SKU, nombre y categoría son obligatorios");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        sku: form.sku,
        name: form.name,
        category: form.category,
        description: form.description || null,
        baseUnit: form.baseUnit,
        basePriceArs: form.basePriceArs ? Number(form.basePriceArs) : null,
        basePriceUsd: form.basePriceUsd ? Number(form.basePriceUsd) : null,
        inStock: form.inStock,
        stockQuantity: form.stockQuantity !== "" ? Number(form.stockQuantity) : null,
        lowStockThreshold: form.lowStockThreshold !== "" ? Number(form.lowStockThreshold) : null,
        // Trimmed alias if the operator typed one; empty/whitespace
        // sends null and lets the backend keep / auto-seed it.
        armadorAlias: form.armadorAlias.trim() ? form.armadorAlias.trim() : null,
      };
      if (form.id) {
        await api.products.update(form.id, payload);
        toast.success("Producto actualizado");
      } else {
        await api.products.create(payload);
        toast.success("Producto creado");
      }
      setForm(EMPTY_FORM);
      setFormOpen(false);
      void refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const remove = (p: Product) => setDeleting(p);
  const confirmRemove = async () => {
    if (!deleting) return;
    try {
      await api.products.delete(deleting.id);
      toast.success("Producto eliminado");
      void refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Error al eliminar");
    } finally {
      setDeleting(null);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const result = await api.products.importCsv(file);
      toast.success(`Importado: ${result.created} nuevos · ${result.updated} actualizados`, {
        description: result.skipped > 0 ? `${result.skipped} filas saltadas` : undefined,
      });
      void refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? "Error al importar planilla");
    }
  };

  if (!isAllowed) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-cyan-500 to-sky-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(6_182_212/0.45)] sm:h-11 sm:w-11">
            <CategoryIcon sx={{ fontSize: 20 }} className="sm:[font-size:22px]" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl lg:text-3xl text-slate-900">Catálogo</h1>
            <p className="hidden text-sm text-muted-foreground sm:block">
              Productos con SKU, precio y stock. Alimenta directamente las respuestas de la IA.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleImport}
            className="hidden"
          />
          <button
            type="button"
            onClick={canWrite ? () => fileRef.current?.click() : undefined}
            disabled={!canWrite}
            aria-label="Importar CSV"
            title={canWrite ? undefined : ADMIN_ONLY_WRITE_TOOLTIP}
            className={
              "inline-flex h-10 items-center gap-2 rounded-full border px-3 text-sm font-medium sm:px-4 " +
              (canWrite
                ? "border-slate-200 bg-white text-slate-700 hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"
                : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400 opacity-60")
            }
          >
            <UploadFileIcon sx={{ fontSize: 16 }} className={canWrite ? "text-amber-600" : "text-slate-400"} />
            <span className="hidden sm:inline">Importar CSV</span>
          </button>
          <button
            type="button"
            onClick={refresh}
            aria-label="Refrescar"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 sm:px-4"
          >
            <RefreshIcon sx={{ fontSize: 16 }} className="text-blue-600" />
            <span className="hidden sm:inline">Refrescar</span>
          </button>
          <button
            type="button"
            onClick={canWrite ? startCreate : undefined}
            disabled={!canWrite}
            aria-label="Nuevo producto"
            title={canWrite ? undefined : ADMIN_ONLY_WRITE_TOOLTIP}
            className={
              "inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm font-medium transition-all duration-200 active:translate-y-0 active:scale-[0.97] sm:px-4 " +
              (canWrite
                ? "bg-gradient-to-r from-cyan-600 to-sky-500 text-white shadow-[0_8px_20px_-6px_rgb(6_182_212/0.5)] hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-6px_rgb(6_182_212/0.6)]"
                : "cursor-not-allowed bg-slate-300 text-white opacity-60")
            }
          >
            <AddIcon sx={{ fontSize: 16 }} />
            <span className="hidden sm:inline">Nuevo producto</span>
            <span className="sm:hidden">Nuevo</span>
          </button>
        </div>
      </div>

      <section className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
          <div className="relative mb-4">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por SKU, nombre o descripción..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/15"
            />
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">Cargando…</p>
          ) : items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              Sin productos. Cargá uno desde el formulario o importá un CSV.
            </p>
          ) : (
            <>
              <Pagination
                position="top"
                page={pg.page}
                totalPages={pg.totalPages}
                totalItems={pg.totalItems}
                pageSize={pg.pageSize}
                onPageChange={pg.setPage}
                onPageSizeChange={pg.setPageSize}
              />
              <ul className="divide-y divide-slate-100 mt-2">
                {pg.slice.map((p) => {
                const editing = form.id === p.id;
                return (
                <li
                  key={p.id}
                  className={
                    "relative flex min-w-0 items-center gap-2 py-3 px-3 -mx-3 rounded-xl transition-colors sm:gap-3 " +
                    (editing
                      ? "bg-cyan-50/70 ring-2 ring-cyan-300 shadow-[0_4px_12px_-6px_rgb(6_182_212/0.35)]"
                      : "")
                  }
                >
                  {editing && (
                    <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-gradient-to-b from-cyan-500 to-sky-400" aria-hidden />
                  )}
                  <span className="shrink-0 rounded-md bg-slate-900 px-2 py-0.5 font-mono text-[10px] font-semibold text-white">
                    {p.sku}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="truncate text-sm font-semibold text-slate-900">{p.name}</span>
                      <span className="text-[11px] text-slate-500">{p.category}</span>
                      {editing && (
                        <span className="inline-flex items-center rounded-full bg-cyan-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          editando
                        </span>
                      )}
                      {p.source !== "MANUAL" && (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          {SOURCE_LABEL[p.source] ?? p.source}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {p.basePriceArs != null && `ARS ${p.basePriceArs}`}
                      {p.basePriceArs != null && p.basePriceUsd != null && " · "}
                      {p.basePriceUsd != null && `USD ${p.basePriceUsd}`}
                      {(p.basePriceArs == null && p.basePriceUsd == null) && "Sin precio"}
                      {" · "}
                      {p.inStock ? "en stock" : "sin stock"} ({p.baseUnit})
                    </div>
                  </div>
                  <span className={p.inStock ? "text-emerald-600" : "text-slate-400"}>
                    {p.inStock
                      ? <CheckCircleIcon sx={{ fontSize: 16 }} />
                      : <HighlightOffIcon sx={{ fontSize: 16 }} />}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCompetitorsTarget({ id: p.id, name: p.name })}
                    aria-label="Competidores en ML"
                    title="Ver / agregar competidores en MercadoLibre"
                    data-testid={`product-row-competitors-${p.sku}`}
                    className="grid h-8 w-8 place-items-center rounded-lg text-orange-600 hover:bg-orange-50 hover:text-orange-700"
                  >
                    <VisibilityIcon sx={{ fontSize: 16 }} />
                  </button>
                  <button
                    type="button"
                    onClick={canWrite ? () => startEdit(p) : undefined}
                    disabled={!canWrite}
                    aria-label="Editar"
                    aria-pressed={editing}
                    title={canWrite ? undefined : ADMIN_ONLY_WRITE_TOOLTIP}
                    className={
                      "grid h-8 w-8 place-items-center rounded-lg " +
                      (!canWrite
                        ? "cursor-not-allowed bg-slate-100 text-slate-400 opacity-60"
                        : editing
                          ? "bg-cyan-600 text-white shadow-[0_4px_10px_-4px_rgb(6_182_212/0.6)]"
                          : "text-blue-600 hover:bg-blue-50 hover:text-blue-700")
                    }
                  >
                    <EditIcon sx={{ fontSize: 16 }} />
                  </button>
                  <button
                    type="button"
                    onClick={canWrite ? () => remove(p) : undefined}
                    disabled={!canWrite}
                    aria-label="Eliminar"
                    title={canWrite ? undefined : ADMIN_ONLY_WRITE_TOOLTIP}
                    className={
                      "grid h-8 w-8 place-items-center rounded-lg " +
                      (canWrite
                        ? "text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        : "cursor-not-allowed bg-slate-100 text-slate-400 opacity-60")
                    }
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                  </button>
                </li>
                );
              })}
              </ul>
              <div className="mt-3">
                <Pagination
                  position="bottom"
                  page={pg.page}
                  totalPages={pg.totalPages}
                  totalItems={pg.totalItems}
                  pageSize={pg.pageSize}
                  onPageChange={pg.setPage}
                  onPageSizeChange={pg.setPageSize}
                />
              </div>
            </>
          )}
        </section>

        {/* CREATE/EDIT MODAL */}
        <Dialog
          open={formOpen}
          onOpenChange={(open) => {
            if (!open) cancelEdit();
            else setFormOpen(true);
          }}
        >
          <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-200/70 bg-white/95 p-4 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150 sm:max-w-[560px] sm:p-6">
            <DialogHeader className="flex flex-row items-center gap-3 space-y-0">
              <span
                className={
                  "grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(6_182_212/0.45)] sm:h-11 sm:w-11 " +
                  (form.id
                    ? "bg-gradient-to-br from-cyan-500 to-sky-400"
                    : "bg-gradient-to-br from-emerald-500 to-teal-400")
                }
              >
                {form.id
                  ? <EditIcon sx={{ fontSize: 20 }} className="sm:[font-size:22px]" />
                  : <AddIcon sx={{ fontSize: 20 }} className="sm:[font-size:22px]" />}
              </span>
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
                  {form.id ? 'Editar producto' : 'Nuevo producto'}
                </DialogTitle>
                <DialogDescription className="truncate text-xs text-slate-500 sm:text-sm">
                  {form.id
                    ? `SKU ${form.sku || '—'} · ${form.category || 'sin categoría'}`
                    : 'Datos del producto en el catálogo'}
                </DialogDescription>
              </div>
            </DialogHeader>

            <div className="mt-2 space-y-3">
              <Field label="SKU" value={form.sku} onChange={(v) => setForm({ ...form, sku: v })} />
              <Field label="Nombre" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              <Field label="Categoría" value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
              <Field label="Unidad" value={form.baseUnit} onChange={(v) => setForm({ ...form, baseUnit: v })} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Precio ARS" value={form.basePriceArs} onChange={(v) => setForm({ ...form, basePriceArs: v })} />
                <Field label="Precio USD" value={form.basePriceUsd} onChange={(v) => setForm({ ...form, basePriceUsd: v })} />
              </div>
              <div>
                <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">Descripción</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/15"
                />
              </div>
              <div>
                <Field
                  label="Alias para armador (logística)"
                  value={form.armadorAlias}
                  onChange={(v) => setForm({ ...form, armadorAlias: v })}
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Lo ve el armador en el archivo diario de logística (Bloque C). Si lo dejás vacío se autocompleta con los primeros 40 caracteres del nombre.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Stock actual" value={form.stockQuantity} onChange={(v) => setForm({ ...form, stockQuantity: v })} />
                <Field label="Umbral de stock bajo" value={form.lowStockThreshold} onChange={(v) => setForm({ ...form, lowStockThreshold: v })} />
              </div>
              <p className="text-[11px] text-slate-500">
                Si el umbral queda vacío se usa el global (.env <span className="font-mono">PRODUCT_LOW_STOCK_DEFAULT_THRESHOLD</span>).
                Cuando el stock cae al umbral o por debajo, ADMIN y LOGÍSTICA reciben un aviso en tiempo real.
              </p>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.inStock}
                  onChange={(e) => setForm({ ...form, inStock: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                />
                En stock
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={saving}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-sky-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(6_182_212/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(6_182_212/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  {saving ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Guardando...
                    </>
                  ) : form.id ? 'Guardar cambios' : 'Crear producto'}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <AlertDialogContent className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150">
          <AlertDialogHeader className="space-y-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-red-500 to-rose-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(239_68_68/0.45)]">
              <DeleteIcon sx={{ fontSize: 22 }} />
            </span>
            <AlertDialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              ¿Eliminar producto?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-slate-600">
              {deleting ? (
                <>
                  Vas a eliminar <span className="font-semibold text-slate-900">{deleting.name}</span>{" "}
                  (SKU <span className="font-mono text-slate-900">{deleting.sku}</span>) del catálogo.
                  Esta acción no se puede deshacer.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(239_68_68/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(239_68_68/0.65)] active:translate-y-0 active:scale-[0.97]"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CompetitorsDialog
        open={competitorsTarget !== null}
        onOpenChange={(v) => { if (!v) setCompetitorsTarget(null); }}
        productId={competitorsTarget?.id ?? null}
        productName={competitorsTarget?.name ?? null}
      />
    </div>
  );
}

interface FieldProps { label: string; value: string; onChange: (v: string) => void; }
function Field({ label, value, onChange }: FieldProps) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/15"
      />
    </div>
  );
}
