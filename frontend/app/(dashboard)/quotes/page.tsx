"use client";

// Presupuestos. Page split:
//   - Composer on the left: buyer fields + line items, generates a Quote
//     and opens the rendered PDF in a new tab.
//   - History on the right: list of past quotes with status pill +
//     "Ver PDF" / mark sent / delete.
// Restricted to ADMIN + VENTAS via useRoleGuard; matches the backend.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type Quote } from "@/lib/api/endpoints";
import { UserRole } from "@/types";
import { useAuthStore } from "@/lib/store/auth-store";
import { useRoleGuard } from "@/lib/hooks/use-role-guard";
import { useClientPagination } from "@/lib/hooks/use-client-pagination";
import { Pagination } from "@/components/ui/pagination";
import RequestQuoteIcon from "@mui/icons-material/RequestQuote";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteIcon from "@mui/icons-material/Delete";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
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

const STATUS_LABEL: Record<string, string> = {
  DRAFT:    "Borrador",
  SENT:     "Enviado",
  ACCEPTED: "Aceptado",
  REJECTED: "Rechazado",
  EXPIRED:  "Vencido",
};
const STATUS_PILL: Record<string, string> = {
  DRAFT:    "border-slate-200 bg-slate-50 text-slate-700",
  SENT:     "border-blue-200 bg-blue-50 text-blue-700",
  ACCEPTED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  REJECTED: "border-rose-200 bg-rose-50 text-rose-700",
  EXPIRED:  "border-amber-200 bg-amber-50 text-amber-700",
};

interface ItemRow { quantity: string; description: string; unitPrice: string; }

const EMPTY_ITEM: ItemRow = { quantity: "", description: "", unitPrice: "" };

function fmtMoney(n: number, currency = "ARS"): string {
  const sign = currency === "USD" ? "USD " : "$ ";
  return sign + n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function QuotesPage() {
  const { isAllowed } = useRoleGuard(ROLES);
  // Backend matrix: DELETE /admin/quotes/:id is ADMIN-only. VENTAS can
  // create + read + change-status + view PDF, but only an admin can wipe
  // a presupuesto. Mirror that here so VENTAS sees the affordance disabled
  // rather than clicking and 403-ing.
  const myRole = useAuthStore((s) => s.user?.role);
  const canDelete = myRole === UserRole.ADMIN;

  const [history, setHistory] = useState<Quote[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Quote | null>(null);
  const pg = useClientPagination(history, { storageKey: "quotes", defaultPageSize: 25 });

  const [buyerName, setBuyerName] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [buyerLocality, setBuyerLocality] = useState("");
  const [buyerTaxId, setBuyerTaxId] = useState("");
  const [buyerTaxStatus, setBuyerTaxStatus] = useState("Responsable Inscripto");
  const [paymentMethod, setPaymentMethod] = useState("Contado Efectivo");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemRow[]>([{ ...EMPTY_ITEM }]);
  // Prefill origin (set when arriving from a lead detail page) so the
  // created quote can be back-linked. Cleared after first use.
  const [prefillOrigin, setPrefillOrigin] = useState<{ leadId?: string; contactId?: string } | null>(null);

  // Read sessionStorage prefill once on mount. We use sessionStorage
  // rather than query params so buyer fields don't leak into history.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem('quote.prefill');
      if (!raw) return;
      sessionStorage.removeItem('quote.prefill');
      const data = JSON.parse(raw);
      if (data.buyerName) setBuyerName(String(data.buyerName));
      if (data.productInterest) {
        setItems([{ quantity: '', description: String(data.productInterest), unitPrice: '' }]);
      }
      setPrefillOrigin({
        leadId: data.leadId || undefined,
        contactId: data.contactId || undefined,
      });
      toast.message('Datos del lead precargados', {
        description: 'Completá las líneas y generá el presupuesto.',
      });
    } catch { /* ignore malformed prefill */ }
  }, []);

  const refresh = async () => {
    try {
      setHistoryLoading(true);
      const list = await api.quotes.list();
      setHistory(list);
    } catch (err: any) {
      toast.error(err?.message ?? "Error cargando presupuestos");
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => { if (isAllowed) refresh(); }, [isAllowed]);

  // Live totals shown next to the items table.
  const liveTotals = (() => {
    const lines = items.map((i) => {
      const q = Number(i.quantity); const u = Number(i.unitPrice);
      return Number.isFinite(q) && Number.isFinite(u) ? q * u : 0;
    });
    const net = lines.reduce((a, b) => a + b, 0);
    const tax = net * 0.21;
    return { net, tax, total: net + tax };
  })();

  const setItem = (idx: number, patch: Partial<ItemRow>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const addItem = () => setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (idx: number) => setItems((prev) =>
    prev.length === 1 ? prev : prev.filter((_, i) => i !== idx),
  );

  const generate = async () => {
    if (!buyerName.trim()) { toast.error("Falta el nombre del comprador"); return; }
    const cleanItems = items
      .map((i) => ({ quantity: Number(i.quantity), description: i.description.trim(), unitPrice: Number(i.unitPrice) }))
      .filter((i) => i.description.length > 0 && Number.isFinite(i.quantity) && Number.isFinite(i.unitPrice) && i.quantity > 0);
    if (cleanItems.length === 0) {
      toast.error("Agregá al menos una línea con cantidad y precio");
      return;
    }
    setSaving(true);
    try {
      const created = await api.quotes.create({
        buyerName: buyerName.trim(),
        buyerAddress: buyerAddress || null,
        buyerLocality: buyerLocality || null,
        buyerTaxId: buyerTaxId || null,
        buyerTaxStatus: buyerTaxStatus || null,
        paymentMethod: paymentMethod || null,
        items: cleanItems,
        notes: notes || null,
        leadId: prefillOrigin?.leadId ?? null,
        contactId: prefillOrigin?.contactId ?? null,
      });
      toast.success(`Presupuesto ${created.quoteNumber} generado`);

      // Open the rendered PDF in a new tab
      const url = await api.quotes.getPdfBlobUrl(created.id);
      window.open(url, "_blank");

      // Reset form except buyerTaxStatus / paymentMethod which Marcos
      // reuses across most quotes. The origin link is consumed once so
      // a follow-up quote on the same page won't accidentally re-link.
      setBuyerName(""); setBuyerAddress(""); setBuyerLocality(""); setBuyerTaxId("");
      setNotes(""); setItems([{ ...EMPTY_ITEM }]);
      setPrefillOrigin(null);
      void refresh();
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? "Error al generar");
    } finally {
      setSaving(false);
    }
  };

  const openPdf = async (id: string) => {
    try {
      const url = await api.quotes.getPdfBlobUrl(id);
      window.open(url, "_blank");
    } catch (err: any) {
      toast.error(err?.message ?? "Error al abrir PDF");
    }
  };

  const markSent = async (q: Quote) => {
    try {
      await api.quotes.setStatus(q.id, "SENT");
      toast.success("Marcado como enviado");
      void refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Error al actualizar estado");
    }
  };

  const removeQuote = (q: Quote) => setDeleting(q);
  const confirmRemoveQuote = async () => {
    if (!deleting) return;
    try {
      await api.quotes.delete(deleting.id);
      toast.success("Presupuesto eliminado");
      void refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Error al eliminar");
    } finally {
      setDeleting(null);
    }
  };

  if (!isAllowed) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-500 to-yellow-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(217_119_6/0.45)] sm:h-11 sm:w-11">
            <RequestQuoteIcon sx={{ fontSize: 20 }} className="sm:[font-size:22px]" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-3xl text-slate-900">Presupuestos</h1>
            <p className="hidden text-sm text-muted-foreground sm:block">
              Generá un presupuesto en PDF con el formato oficial de Servifibras.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        {/* COMPOSER */}
        <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] lg:col-span-2 space-y-5">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">Datos del comprador</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Sr./es"      value={buyerName}      onChange={setBuyerName} />
              <Field label="Localidad"   value={buyerLocality}  onChange={setBuyerLocality} />
              <Field label="Domicilio"   value={buyerAddress}   onChange={setBuyerAddress} />
              <Field label="CUIT"        value={buyerTaxId}     onChange={setBuyerTaxId} />
              <Field label="I.V.A."      value={buyerTaxStatus} onChange={setBuyerTaxStatus} />
              <Field label="F. de Pago"  value={paymentMethod}  onChange={setPaymentMethod} />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Líneas</h2>
              <button
                type="button"
                onClick={addItem}
                className="inline-flex h-8 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"
              >
                <AddIcon sx={{ fontSize: 14 }} className="text-amber-600" />
                Línea
              </button>
            </div>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2">
                  <input
                    type="number"
                    placeholder="Cant."
                    value={it.quantity}
                    onChange={(e) => setItem(idx, { quantity: e.target.value })}
                    className="col-span-2 h-10 rounded-xl border border-slate-200 bg-white px-2 text-sm outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
                  />
                  <input
                    type="text"
                    placeholder="Detalle"
                    value={it.description}
                    onChange={(e) => setItem(idx, { description: e.target.value })}
                    className="col-span-7 h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
                  />
                  <input
                    type="number"
                    placeholder="Unitario"
                    value={it.unitPrice}
                    onChange={(e) => setItem(idx, { unitPrice: e.target.value })}
                    className="col-span-2 h-10 rounded-xl border border-slate-200 bg-white px-2 text-sm outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    aria-label="Quitar"
                    className="col-span-1 grid place-items-center rounded-xl border border-slate-200 bg-white text-rose-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                  >
                    <RemoveIcon sx={{ fontSize: 16 }} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-2">Notas</h2>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <div className="space-y-0.5 text-slate-600">
              <div>Monto gravado: <span className="font-semibold tabular-nums text-slate-900">{fmtMoney(liveTotals.net)}</span></div>
              <div>IVA 21%: <span className="font-semibold tabular-nums text-slate-900">{fmtMoney(liveTotals.tax)}</span></div>
            </div>
            <div className="text-base font-bold text-slate-900">Total: {fmtMoney(liveTotals.total)}</div>
            <button
              type="button"
              onClick={generate}
              disabled={saving}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-amber-600 to-yellow-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(217_119_6/0.5)] hover:from-amber-700 hover:to-yellow-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <PictureAsPdfIcon sx={{ fontSize: 16 }} />
              )}
              Generar y abrir PDF
            </button>
          </div>
        </section>

        {/* HISTORY */}
        <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Historial</h2>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
            >
              <RefreshIcon sx={{ fontSize: 14 }} className="text-blue-600" />
              Refrescar
            </button>
          </div>
          {historyLoading ? (
            <p className="text-sm text-slate-500">Cargando…</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-slate-500">Aún no generaste presupuestos.</p>
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
              {pg.slice.map((q) => (
                <li key={q.id} className="space-y-1 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] font-semibold text-slate-900">
                      {q.quoteNumber}
                    </span>
                    <span className={
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium " +
                      (STATUS_PILL[q.status] ?? "border-slate-200 bg-slate-50 text-slate-700")
                    }>
                      {STATUS_LABEL[q.status] ?? q.status}
                    </span>
                  </div>
                  <div className="truncate text-xs font-semibold text-slate-900">{q.buyerName}</div>
                  <div className="text-[11px] text-slate-500">
                    {fmtMoney(q.totalAmount, q.currency)} · {new Date(q.issueDate).toLocaleDateString("es-AR")}
                  </div>
                  <div className="flex items-center gap-1 pt-1">
                    <button
                      type="button"
                      onClick={() => openPdf(q.id)}
                      className="inline-flex h-7 items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 text-[11px] text-slate-700 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700"
                    >
                      <PictureAsPdfIcon sx={{ fontSize: 13 }} className="text-rose-600" />
                      Ver PDF
                    </button>
                    {q.status === "DRAFT" && (
                      <button
                        type="button"
                        onClick={() => markSent(q)}
                        className="inline-flex h-7 items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 text-[11px] text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                      >
                        <CheckCircleOutlineIcon sx={{ fontSize: 13 }} />
                        Marcar enviado
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={canDelete ? () => removeQuote(q) : undefined}
                      disabled={!canDelete}
                      aria-label="Eliminar"
                      title={canDelete ? undefined : "Solo Administrador puede eliminar presupuestos"}
                      className={
                        "ml-auto grid h-7 w-7 place-items-center rounded-full " +
                        (canDelete
                          ? "text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          : "text-slate-400 cursor-not-allowed opacity-60")
                      }
                    >
                      <DeleteOutlineIcon sx={{ fontSize: 14 }} />
                    </button>
                  </div>
                </li>
              ))}
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
      </div>

      <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <AlertDialogContent className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150">
          <AlertDialogHeader className="space-y-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-red-500 to-rose-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(239_68_68/0.45)]">
              <DeleteIcon sx={{ fontSize: 22 }} />
            </span>
            <AlertDialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              ¿Eliminar presupuesto?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-slate-600">
              {deleting ? (
                <>
                  Vas a eliminar el presupuesto{" "}
                  <span className="font-mono font-semibold text-slate-900">{deleting.quoteNumber}</span>
                  {deleting.buyerName ? (
                    <> a nombre de <span className="font-semibold text-slate-900">{deleting.buyerName}</span></>
                  ) : null}
                  . Esta acción no se puede deshacer.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97]">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemoveQuote}
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

interface FieldProps { label: string; value: string; onChange: (v: string) => void; }
function Field({ label, value, onChange }: FieldProps) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
      />
    </div>
  );
}
