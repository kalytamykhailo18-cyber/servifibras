"use client";

/**
 * Order create/edit dialog for the /orders page.
 *
 * Marcos 2026-06-12 ask (Pedidos manual-load — Phase 1 outstanding):
 * the legacy form had a JSON Textarea for products. Operators would
 * never use that, and Marcos called it out as the reason "carga
 * manual de ventas" stayed open. Refactored to a row-based UX —
 * same pattern as the in-conversation register-order dialog — so
 * the daily flow is: click "Nuevo Pedido" → pick contact → add
 * product rows (autocomplete from catalog) → submit. Total is
 * auto-computed from rows, with an explicit override input so the
 * operator can record a haggled price without un-toggling line
 * items.
 */

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api/endpoints";
import { ProductPicker } from "@/components/products/product-picker";
import type { Order, Contact } from "@/types";
import { toast } from "sonner";
import EditIcon from "@mui/icons-material/Edit";
import InventoryIcon from "@mui/icons-material/Inventory";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";

interface OrderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order?: Order;
  onSuccess?: () => void;
  /**
   * Marcos 2026-06-18: pre-carga el formulario con los datos de un
   * pedido existente PERO sin entrar en modo edición — el submit
   * sigue creando una fila nueva. Pensado para "Registrar devolución
   * desde un pedido" sin obligar al operador a re-tipear cliente,
   * carrier y costo.
   */
  seedFromOrder?: Order;
  /** Forzar la solapa inicial (PEDIDO / REPOSICION / DEVOLUCION). */
  initialModeOverride?: 'PEDIDO' | 'REPOSICION' | 'DEVOLUCION';
}

interface ProductRow {
  name: string;
  category: string;
  quantity: string;
  unitPrice: string;
  // Marcos 2026-06-17: SKU stamped on the row when the operator picks
  // from the catalog. The Logística panel uses it to look up the
  // warehouse UBI for the armado item list. Manually-typed product
  // names leave this empty.
  sku?: string;
}

const EMPTY_ROW: ProductRow = { name: "", category: "", quantity: "1", unitPrice: "", sku: "" };

function lineTotal(row: ProductRow): number {
  const q = Number(row.quantity);
  const p = Number(row.unitPrice);
  if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p < 0) return 0;
  return Math.round(q * p * 100) / 100;
}

function fmt(currency: string, amount: number): string {
  const c = (currency || "ARS").toUpperCase();
  const sym = c === "USD" ? "US$ " : "$ ";
  return `${sym}${amount.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function rowsFromOrder(o: Order | undefined): ProductRow[] {
  if (!o?.products) return [{ ...EMPTY_ROW }];
  const arr = Array.isArray(o.products) ? o.products : [];
  if (arr.length === 0) return [{ ...EMPTY_ROW }];
  return arr.map((p: any) => ({
    name: typeof p?.name === "string" ? p.name : "",
    category: typeof p?.category === "string" ? p.category : "",
    quantity: p?.quantity != null ? String(p.quantity) : "1",
    unitPrice: p?.unitPrice != null ? String(p.unitPrice) : "",
    sku: typeof p?.sku === "string" ? p.sku : "",
  }));
}

export function OrderFormDialog({
  open,
  onOpenChange,
  order,
  onSuccess,
  seedFromOrder,
  initialModeOverride,
}: OrderFormDialogProps) {
  const isEditing = !!order;
  // El "seed" mantiene isEditing=false (es una fila nueva) pero los
  // valores iniciales salen del pedido origen. Marcos 2026-06-18.
  const initialSource: Order | undefined = order ?? seedFromOrder;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [contactId, setContactId] = useState<string>(initialSource?.contactId ?? "");
  const [currency, setCurrency] = useState<"ARS" | "USD">((initialSource?.currency as "ARS" | "USD") ?? "ARS");
  const [rows, setRows] = useState<ProductRow[]>(rowsFromOrder(initialSource));
  const [notes, setNotes] = useState<string>((initialSource as any)?.notes ?? "");
  const [amountOverride, setAmountOverride] = useState<string>(
    initialSource?.amount != null ? String(initialSource.amount) : "",
  );
  // Marcos 2026-06-12: where the manual pedido should land in the
  // daily logística panel. Mandatory on create — defaults to MOTOS
  // (covers the most common case) and the operator can flip it.
  const [sectionOverride, setSectionOverride] = useState<'MOTOS' | 'MICROS' | 'RETIRA_CASEROS' | 'LAMINADOS_PRFV'>(
    ((initialSource as any)?.sectionOverride as any) || 'MOTOS',
  );
  // Marcos 2026-06-17/06-18: form mode — PEDIDO (sale), REPOSICION
  // (re-shipment, Servifibras pays courier, customer keeps wrong
  // item), DEVOLUCION (courier brings wrong package back; tracked
  // until "Volvió"). REPOSICION and DEVOLUCION share the same
  // form shape (carrier + zone + cost) and both stay out of
  // facturación / ventas. The legacy `isReposicion` state is
  // derived from the mode so existing checks keep working.
  const initialMode: 'PEDIDO' | 'REPOSICION' | 'DEVOLUCION' =
    initialModeOverride
    ?? (((order as any)?.orderType === 'REPOSICION' || (order as any)?.isReposicion) ? 'REPOSICION'
      : (order as any)?.orderType === 'DEVOLUCION' ? 'DEVOLUCION'
      : 'PEDIDO');
  const [orderMode, setOrderMode] = useState<'PEDIDO' | 'REPOSICION' | 'DEVOLUCION'>(initialMode);
  const isReposicion = orderMode !== 'PEDIDO';
  const setIsReposicion = (v: boolean) => setOrderMode(v ? 'REPOSICION' : 'PEDIDO');
  const [repCarrier, setRepCarrier] = useState<string>((initialSource as any)?.carrier ?? '');
  const [repZone, setRepZone] = useState<string>((initialSource as any)?.shippingZone ?? '');
  const [repCost, setRepCost] = useState<string>(
    (initialSource as any)?.shippingCost != null ? String((initialSource as any).shippingCost) : ''
  );
  // Tariff table + carriers list pulled from the same source the
  // dispatch-stats card uses, so the operator sees a deterministic
  // dropdown of valid pairs.
  const [tariffs, setTariffs] = useState<Array<{ carrier: string; zone: string; costPerPackage: number; currency: string }>>([]);
  // Inline "Nuevo cliente" sub-form state.
  const [newContactOpen, setNewContactOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  // Marcos 2026-06-15: optional shipping/fiscal fields, expandable
  // so the basic flow still shows only Name + Tel + Email. These
  // land on Contact.metadata and feed the order PDF directly.
  const [newMoreOpen, setNewMoreOpen] = useState(false);
  const [newFiscalId, setNewFiscalId] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newStreetNumber, setNewStreetNumber] = useState("");
  const [newLocality, setNewLocality] = useState("");
  const [newPostalCode, setNewPostalCode] = useState("");
  const [newContactSaving, setNewContactSaving] = useState(false);

  // Reset state every time the dialog re-opens. Without this, closing
  // mid-edit and re-opening for a fresh "Nuevo" would leak the
  // previous state into the form.
  useEffect(() => {
    if (!open) return;
    const src = order ?? seedFromOrder;
    setContactId(src?.contactId ?? "");
    setCurrency((src?.currency as "ARS" | "USD") ?? "ARS");
    setRows(rowsFromOrder(src));
    setNotes((src as any)?.notes ?? "");
    setAmountOverride(src?.amount != null ? String(src.amount) : "");
    setSectionOverride(((src as any)?.sectionOverride as any) || 'MOTOS');
    setNewContactOpen(false);
    setNewName("");
    setNewPhone("");
    setNewEmail("");
    setNewMoreOpen(false);
    setNewFiscalId("");
    setNewAddress("");
    setNewStreetNumber("");
    setNewLocality("");
    setNewPostalCode("");
    setOrderMode(
      initialModeOverride
      ?? (((order as any)?.orderType === 'REPOSICION' || (order as any)?.isReposicion) ? 'REPOSICION'
        : (order as any)?.orderType === 'DEVOLUCION' ? 'DEVOLUCION'
        : 'PEDIDO'),
    );
    setRepCarrier((src as any)?.carrier ?? '');
    setRepZone((src as any)?.shippingZone ?? '');
    setRepCost((src as any)?.shippingCost != null ? String((src as any).shippingCost) : '');
  }, [open, order, seedFromOrder, initialModeOverride]);

  // Marcos 2026-06-12: quick-add a contact without leaving the order
  // dialog. POSTs through the standard contacts endpoint so the new
  // row is searchable everywhere else immediately.
  const createInlineContact = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error('El nombre del cliente es obligatorio');
      return;
    }
    setNewContactSaving(true);
    try {
      // Pack the optional shipping/fiscal fields into metadata. They
      // round-trip to the order PDF via Contact.metadata so the
      // operator never has to re-type them on the printable.
      const fiscalId = newFiscalId.trim();
      const address = newAddress.trim();
      const streetNumber = newStreetNumber.trim();
      const locality = newLocality.trim();
      const postalCode = newPostalCode.trim();
      const metadata: Record<string, string> = {};
      if (fiscalId) metadata.fiscalId = fiscalId;
      if (address) metadata.address = address;
      if (streetNumber) metadata.streetNumber = streetNumber;
      if (locality) metadata.locality = locality;
      if (postalCode) metadata.postalCode = postalCode;
      const created: any = await api.contacts.create({
        name,
        phone: newPhone.trim() || undefined,
        email: newEmail.trim() || undefined,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      } as any);
      const newId: string = created?.id ?? created?.data?.id;
      const safeName: string = created?.name ?? created?.data?.name ?? name;
      if (!newId) throw new Error('Backend no devolvió el id del cliente');
      setContacts((prev) => [{ id: newId, name: safeName } as any, ...prev]);
      setContactId(newId);
      setNewContactOpen(false);
      setNewName("");
      setNewPhone("");
      setNewEmail("");
      setNewMoreOpen(false);
      setNewFiscalId("");
      setNewAddress("");
      setNewStreetNumber("");
      setNewLocality("");
      setNewPostalCode("");
      toast.success('Cliente creado y seleccionado');
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || 'No se pudo crear el cliente');
    } finally {
      setNewContactSaving(false);
    }
  };

  // Contacts only fetched when the dialog opens — keeps the /orders
  // page light when nobody's adding anything.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.contacts.list({ limit: 200 });
        const arr = Array.isArray((res as any)?.contacts)
          ? ((res as any).contacts as Contact[])
          : (Array.isArray(res as any) ? (res as unknown as Contact[]) : []);
        if (!cancelled) setContacts(arr);
      } catch {
        if (!cancelled) setContacts([]);
      }
      // Marcos 2026-06-17: tariff table for the REPOSICIÓN form
      // (carrier + zone → cost). Failures are non-fatal — the cost
      // input stays manual.
      try {
        const tr = await (api as any).dispatchTariffs?.list?.();
        if (!cancelled && Array.isArray(tr)) {
          setTariffs(tr.filter((t: any) => t.active !== false));
        }
      } catch {/* non-fatal */}
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Marcos 2026-06-17: auto-fill the shipping cost when carrier+zone
  // match a tariff row. Operator can still edit the value manually
  // after the auto-fill.
  useEffect(() => {
    if (!isReposicion) return;
    if (!repCarrier || !repZone) return;
    const hit = tariffs.find(
      (t) => t.carrier.trim().toLowerCase() === repCarrier.trim().toLowerCase()
          && t.zone.trim().toLowerCase() === repZone.trim().toLowerCase(),
    );
    if (hit) setRepCost(String(hit.costPerPackage));
  }, [isReposicion, repCarrier, repZone, tariffs]);

  const computedTotal = useMemo(() => rows.reduce((s, r) => s + lineTotal(r), 0), [rows]);
  const finalTotal = amountOverride !== "" ? Number(amountOverride) || 0 : computedTotal;
  const overrideActive = amountOverride !== "" && Number(amountOverride) !== computedTotal;

  const updateRow = (idx: number, patch: Partial<ProductRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, { ...EMPTY_ROW }]);
  const removeRow = (idx: number) =>
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));

  const onSubmit = async () => {
    if (!contactId) { toast.error("Elegí un cliente"); return; }

    // Marcos 2026-06-17/06-18: REPOSICIÓN + DEVOLUCIÓN share the
    // same form — courier + zone + cost are mandatory and there's
    // no product list. Reposición = Servifibras paga el envío del
    // reemplazo (cliente se queda con lo errado). Devolución = la
    // mensajería trae el paquete equivocado de vuelta; queda en
    // "Pendientes de regreso" hasta que se marque que volvió.
    // Both stay out of facturación + ventas.
    if (orderMode !== 'PEDIDO') {
      const carrier = repCarrier.trim();
      const zone = repZone.trim();
      const cost = Number(repCost);
      const label = orderMode === 'DEVOLUCION' ? 'devolución' : 'reposición';
      if (!carrier) { toast.error(`Cargá la mensajería de la ${label}`); return; }
      if (!zone) { toast.error("Cargá la zona"); return; }
      if (!Number.isFinite(cost) || cost < 0) { toast.error("Cargá el costo de logística"); return; }
      setSubmitting(true);
      try {
        const prefix = orderMode === 'DEVOLUCION' ? 'Devolución' : 'Reposición';
        await api.orders.create({
          contactId,
          amount: cost,
          currency: 'ARS',
          products: [{ name: `${prefix} ${carrier} ${zone}`, category: prefix, quantity: 1, unitPrice: cost, totalPrice: cost }],
          notes: notes.trim() || undefined,
          sectionOverride,
          orderType: orderMode,
          carrier,
          shippingZone: zone,
          shippingCost: cost,
        } as any);
        toast.success(orderMode === 'DEVOLUCION' ? 'Devolución registrada' : 'Reposición registrada');
        onOpenChange(false);
        onSuccess?.();
      } catch (err: any) {
        toast.error(err?.response?.data?.error || err?.message || `No se pudo guardar la ${label}`);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const cleaned = rows
      .map((r) => ({
        name: r.name.trim(),
        category: r.category.trim() || "General",
        quantity: Number(r.quantity),
        unitPrice: Number(r.unitPrice),
        sku: (r.sku || '').trim() || undefined,
      }))
      .filter((r) => r.name.length > 0 && r.quantity > 0 && Number.isFinite(r.unitPrice) && r.unitPrice >= 0);
    if (cleaned.length === 0) {
      toast.error("Agregá al menos un producto con nombre, cantidad y precio.");
      return;
    }
    if (!Number.isFinite(finalTotal) || finalTotal < 0) {
      toast.error("Monto total inválido");
      return;
    }
    const products = cleaned.map((r) => ({
      name: r.name,
      category: r.category,
      quantity: r.quantity,
      unitPrice: r.unitPrice,
      totalPrice: Math.round(r.quantity * r.unitPrice * 100) / 100,
      ...(r.sku ? { sku: r.sku } : {}),
    }));
    setSubmitting(true);
    try {
      if (isEditing && order) {
        await api.orders.update(order.id, {
          amount: finalTotal,
          currency,
          products,
          notes: notes.trim() || undefined,
        });
        toast.success("Pedido actualizado");
      } else {
        await api.orders.create({
          contactId,
          amount: finalTotal,
          currency,
          products,
          notes: notes.trim() || undefined,
          sectionOverride,
        } as any);
        toast.success("Pedido creado");
      }
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo guardar el pedido");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-200/70 bg-white/95 p-4 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150 sm:max-w-[640px] sm:p-6"
        data-testid="order-form-dialog"
      >
        <DialogHeader className="flex flex-row items-center gap-3 space-y-0">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-green-500 to-emerald-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(34_197_94/0.45)] sm:h-11 sm:w-11">
            {isEditing ? <EditIcon sx={{ fontSize: 20 }} /> : <InventoryIcon sx={{ fontSize: 20 }} />}
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
              {isEditing ? "Editar Pedido" : "Nuevo Pedido"}
            </DialogTitle>
            <DialogDescription className="truncate text-xs text-slate-500 sm:text-sm">
              {isEditing ? "Actualizá productos y monto del pedido" : "Cargá un pedido manualmente"}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="mt-3 space-y-4">
          {/* Marcos 2026-06-17: PEDIDO / REPOSICIÓN tabs. Reposición
              is a re-shipment after armado error — needs courier +
              zone + cost (auto-fills from tariffs) and stays out of
              sales metrics + invoicing queue. */}
          {!isEditing && (
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-100/60 p-1">
              {([
                { id: 'PEDIDO',     label: 'Pedido',     active: 'bg-white text-slate-900 shadow-[0_1px_2px_0_rgb(15_23_42/0.06)]' },
                { id: 'REPOSICION', label: 'Reposición', active: 'bg-amber-500 text-white shadow-[0_1px_2px_0_rgb(15_23_42/0.06)]' },
                { id: 'DEVOLUCION', label: 'Devolución', active: 'bg-rose-500 text-white shadow-[0_1px_2px_0_rgb(15_23_42/0.06)]' },
              ] as const).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setOrderMode(t.id)}
                  data-testid={`order-form-tab-${t.id.toLowerCase()}`}
                  className={
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors " +
                    (orderMode === t.id ? t.active : "text-slate-500 hover:text-slate-700")
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Contact picker — disabled in edit mode (same lock-in as before). */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Cliente <span className="text-emerald-600">*</span>
            </label>
            {isEditing ? (
              <div
                className="flex h-11 min-w-0 items-center rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-700"
                data-testid="order-form-contact-locked"
              >
                <span className="truncate">
                  {(order as any)?.contact?.name
                    || (order as any)?.contact?.phone
                    || (order as any)?.contact?.email
                    || contacts.find((c) => c.id === contactId)?.name
                    || contactId}
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    value={contactId}
                    onChange={(e) => setContactId(e.target.value)}
                    data-testid="order-form-contact-select"
                    className="block h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                  >
                    <option value="">Seleccioná un cliente…</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name || c.phone || c.email || c.id}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setNewContactOpen((s) => !s)}
                    data-testid="order-form-new-contact-toggle"
                    title="Agregar un cliente nuevo"
                    className="inline-flex h-11 shrink-0 items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                  >
                    <AddIcon sx={{ fontSize: 14 }} />
                    Nuevo
                  </button>
                </div>
                {newContactOpen && (
                  <div
                    data-testid="order-form-new-contact-form"
                    className="grid grid-cols-1 gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/40 p-3 sm:grid-cols-3"
                  >
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Nombre *"
                      data-testid="order-form-new-contact-name"
                    />
                    <Input
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      placeholder="Teléfono (opcional)"
                      data-testid="order-form-new-contact-phone"
                    />
                    <Input
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="Email (opcional)"
                      data-testid="order-form-new-contact-email"
                    />
                    {/* Marcos 2026-06-15: optional fiscal + shipping
                        fields. Collapsed by default — only operators
                        who need the printable Pedido with envío
                        completo expand this. Fields land on
                        Contact.metadata and feed the order PDF. */}
                    <div className="sm:col-span-3">
                      <button
                        type="button"
                        onClick={() => setNewMoreOpen((s) => !s)}
                        data-testid="order-form-new-contact-more-toggle"
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:underline"
                      >
                        {newMoreOpen ? '▾ Ocultar más información' : '▸ Más información (CUIT/DNI, domicilio, CP)'}
                      </button>
                    </div>
                    {newMoreOpen && (
                      <>
                        <Input
                          value={newFiscalId}
                          onChange={(e) => setNewFiscalId(e.target.value)}
                          placeholder="CUIT / DNI"
                          data-testid="order-form-new-contact-fiscal-id"
                        />
                        <Input
                          value={newAddress}
                          onChange={(e) => setNewAddress(e.target.value)}
                          placeholder="Domicilio (calle)"
                          data-testid="order-form-new-contact-address"
                        />
                        <Input
                          value={newStreetNumber}
                          onChange={(e) => setNewStreetNumber(e.target.value)}
                          placeholder="Número"
                          data-testid="order-form-new-contact-street-number"
                        />
                        <Input
                          value={newLocality}
                          onChange={(e) => setNewLocality(e.target.value)}
                          placeholder="Localidad"
                          data-testid="order-form-new-contact-locality"
                        />
                        <Input
                          value={newPostalCode}
                          onChange={(e) => setNewPostalCode(e.target.value)}
                          placeholder="Código postal"
                          data-testid="order-form-new-contact-postal-code"
                        />
                      </>
                    )}
                    <div className="flex items-center justify-end gap-2 sm:col-span-3">
                      <button
                        type="button"
                        onClick={() => setNewContactOpen(false)}
                        disabled={newContactSaving}
                        className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={createInlineContact}
                        disabled={newContactSaving}
                        data-testid="order-form-new-contact-save"
                        className="inline-flex h-9 items-center rounded-lg bg-gradient-to-r from-emerald-600 to-teal-500 px-3 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {newContactSaving ? 'Guardando…' : 'Crear y elegir'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Currency + Enviar-a selector — Marcos 2026-06-12:
              section preselect drives the daily logística panel. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Moneda
              </label>
              <div className="grid w-44 grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                {(["ARS", "USD"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCurrency(c)}
                    data-testid={`order-form-currency-${c}`}
                    className={
                      "rounded-md px-2 py-1 text-xs font-semibold transition-colors " +
                      (currency === c
                        ? "bg-white text-slate-900 shadow-[0_1px_2px_0_rgb(15_23_42/0.06)]"
                        : "text-slate-500 hover:text-slate-700")
                    }
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            {!isEditing && (
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  Enviar a <span className="text-emerald-600">*</span>
                </label>
                <select
                  value={sectionOverride}
                  onChange={(e) => setSectionOverride(e.target.value as any)}
                  data-testid="order-form-section-select"
                  className="block h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-200"
                >
                  <option value="MOTOS">Motos</option>
                  <option value="MICROS">Micros</option>
                  <option value="RETIRA_CASEROS">Retira Caseros</option>
                  <option value="LAMINADOS_PRFV">Laminados PRFV</option>
                </select>
              </div>
            )}
          </div>

          {/* Marcos 2026-06-17: REPOSICIÓN block — courier + zone +
              cost. Cost auto-fills from the tariff table when the
              pair matches; the operator can still override. */}
          {isReposicion && (
            <div className={
              "space-y-3 rounded-xl p-3 " +
              (orderMode === 'DEVOLUCION'
                ? "border border-rose-300 bg-rose-50/40"
                : "border border-amber-300 bg-amber-50/40")
            }>
              <p className={
                "text-[11px] font-medium uppercase tracking-wider " +
                (orderMode === 'DEVOLUCION' ? "text-rose-800" : "text-amber-800")
              }>
                {orderMode === 'DEVOLUCION' ? 'Datos de la devolución' : 'Datos de la reposición'}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_140px]">
                <select
                  value={repCarrier}
                  onChange={(e) => setRepCarrier(e.target.value)}
                  data-testid="order-form-reposicion-carrier"
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="">Mensajería…</option>
                  {Array.from(new Set(tariffs.map((t) => t.carrier))).sort().map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <select
                  value={repZone}
                  onChange={(e) => setRepZone(e.target.value)}
                  data-testid="order-form-reposicion-zone"
                  className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="">Zona…</option>
                  {Array.from(new Set(tariffs.filter((t) => !repCarrier || t.carrier === repCarrier).map((t) => t.zone))).sort().map((z) => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={repCost}
                  onChange={(e) => setRepCost(e.target.value)}
                  placeholder="Costo logística"
                  data-testid="order-form-reposicion-cost"
                  className="text-right"
                />
              </div>
              <p className={
                "text-[11px] " +
                (orderMode === 'DEVOLUCION' ? "text-rose-700" : "text-amber-700")
              }>
                {orderMode === 'DEVOLUCION'
                  ? 'Queda en "Pendientes de regreso" hasta marcar que volvió el paquete. No entra en facturación ni ventas.'
                  : 'Esta fila no entra en facturación ni en métricas de ventas. Solo suma al cómputo de despachos.'}
              </p>
            </div>
          )}

          {/* Product rows — the actual manual-load surface. */}
          {!isReposicion && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Productos <span className="text-emerald-600">*</span>
              </label>
              <button
                type="button"
                onClick={addRow}
                data-testid="order-form-add-row"
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
              >
                <AddIcon sx={{ fontSize: 14 }} /> Agregar fila
              </button>
            </div>
            <ul className="space-y-2" data-testid="order-form-rows">
              {rows.map((row, idx) => (
                <li
                  key={idx}
                  data-testid={`order-form-row-${idx}`}
                  className="grid grid-cols-[1fr_80px_1fr_110px_36px] items-center gap-2 rounded-xl border border-slate-200 bg-white p-2"
                >
                  <ProductPicker
                    value={row.name}
                    currency={currency}
                    testId={`order-form-row-name-${idx}`}
                    onTextChange={(text) => updateRow(idx, { name: text })}
                    onSelect={(p, price) => {
                      const patch: Partial<ProductRow> = {
                        name: p.name,
                        category: p.category || row.category,
                        // Marcos 2026-06-17: stamp the SKU so the
                        // Logística panel can pull the UBI from
                        // Product.warehouseLocation.
                        sku: p.sku || row.sku,
                      };
                      if (price != null && !row.unitPrice) patch.unitPrice = String(price);
                      updateRow(idx, patch);
                    }}
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={row.quantity}
                    onChange={(e) => updateRow(idx, { quantity: e.target.value })}
                    placeholder="Cant."
                    className="text-right"
                    data-testid={`order-form-row-quantity-${idx}`}
                  />
                  <Input
                    value={row.category}
                    onChange={(e) => updateRow(idx, { category: e.target.value })}
                    placeholder="Categoría"
                  />
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={row.unitPrice}
                    onChange={(e) => updateRow(idx, { unitPrice: e.target.value })}
                    placeholder="Precio unit."
                    className="text-right"
                    data-testid={`order-form-row-price-${idx}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    disabled={rows.length === 1}
                    aria-label="Eliminar fila"
                    data-testid={`order-form-row-remove-${idx}`}
                    className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          )}

          {/* Total + override — hidden in reposición mode (the cost
              from the carrier+zone tariff IS the total). */}
          {!isReposicion && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Total calculado
              </label>
              <div
                className="flex h-11 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-mono text-slate-700"
                data-testid="order-form-computed-total"
              >
                {fmt(currency, computedTotal)}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Monto a facturar
              </label>
              <Input
                type="number"
                inputMode="decimal"
                value={amountOverride}
                onChange={(e) => setAmountOverride(e.target.value)}
                placeholder={String(computedTotal.toFixed(2))}
                data-testid="order-form-amount-override"
              />
              {overrideActive && (
                <p className="mt-1 text-[10px] text-amber-600" data-testid="order-form-override-warning">
                  Override activo · usando {fmt(currency, finalTotal)}
                </p>
              )}
            </div>
          </div>
          )}

          {/* Notes */}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Notas
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Instrucciones de entrega, observaciones…"
              rows={3}
              className="resize-none"
              data-testid="order-form-notes"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting}
              data-testid="order-form-submit"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-green-600 to-emerald-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(34_197_94/0.5)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(34_197_94/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
            >
              {submitting ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Guardando…
                </>
              ) : isEditing ? "Actualizar" : "Crear"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
