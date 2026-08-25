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
  // Marcos 2026-06-23: descuento % opcional aplicado a esta línea.
  // Si el operador prefiere usar el descuento general del pedido,
  // este campo queda vacío y el descuento global hace el efecto.
  discountPercent?: string;
}

const EMPTY_ROW: ProductRow = { name: "", category: "", quantity: "1", unitPrice: "", sku: "", discountPercent: "" };

function lineTotal(row: ProductRow): number {
  const q = Number(row.quantity);
  const p = Number(row.unitPrice);
  if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p < 0) return 0;
  const gross = q * p;
  const d = Number(row.discountPercent ?? '');
  const disc = Number.isFinite(d) && d > 0 && d <= 100 ? d : 0;
  return Math.round(gross * (1 - disc / 100) * 100) / 100;
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
    discountPercent: p?.discountPercent != null ? String(p.discountPercent) : "",
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
  // Marcos 2026-06-22: el picker antes mostraba los primeros 200 sin
  // filtro server-side. Ahora hay input de búsqueda con debounce —
  // matchea name / phone / email / DNI / CUIT contra toda la base.
  const [contactSearch, setContactSearch] = useState<string>("");
  const [contactSearchDebounced, setContactSearchDebounced] = useState<string>("");
  const [contactSearchLoading, setContactSearchLoading] = useState(false);
  // Cache del contacto seleccionado para mostrar su nombre cuando la
  // lista de resultados ya no lo contiene (el usuario buscó otra cosa
  // pero la selección sigue válida).
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [contactId, setContactId] = useState<string>(initialSource?.contactId ?? "");
  const [currency, setCurrency] = useState<"ARS" | "USD">((initialSource?.currency as "ARS" | "USD") ?? "ARS");
  const [rows, setRows] = useState<ProductRow[]>(rowsFromOrder(initialSource));
  const [notes, setNotes] = useState<string>((initialSource as any)?.notes ?? "");
  // Marcos 2026-06-23: descuento general % aplicado al pedido entero.
  // Caso típico: cliente paga por transferencia y la lista contempla
  // 10/15%. Convive con el descuento por línea (cada row.discountPercent);
  // el descuento general se aplica DESPUÉS del subtotal con descuentos
  // por línea, así el operador puede combinar (ej. ítem específico con
  // 5% extra y 10% general por transferencia).
  const [discountPercent, setDiscountPercent] = useState<string>(
    (initialSource as any)?.discountPercent != null ? String((initialSource as any).discountPercent) : ""
  );
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
  // Marcos 2026-06-22: responsable del paquete mal despachado.
  // Required en REPOSICION — sin esto la card de costos por
  // responsable en /analytics no puede atribuir el gasto.
  const [responsibleId, setResponsibleId] = useState<string>((initialSource as any)?.responsibleId ?? '');
  // Marcos 2026-07-03: motivo del error obligatorio en REPOSICION.
  // 5 opciones fijas + OTRO que habilita el free-text `errorReasonNote`.
  const [errorReason, setErrorReason] = useState<string>((initialSource as any)?.errorReason ?? '');
  const [errorReasonNote, setErrorReasonNote] = useState<string>((initialSource as any)?.errorReasonNote ?? '');
  const [responsibles, setResponsibles] = useState<Array<{ id: string; name: string }>>([]);
  // Marcos 2026-06-23: REPOSICION ahora tiene un toggle "Producto
  // vuelve / Queda en cliente". Default = sin devolución (false).
  // Si true se muestran los campos de la mensajería del retorno y
  // se crea el pendiente en /orders?view=pendientes-regreso.
  const [withReturn, setWithReturn] = useState<boolean>(((initialSource as any)?.returnState === 'PENDING') || ((initialSource as any)?.returnState === 'RETURNED') || ((initialSource as any)?.returnState === 'LOST'));
  // Producto + valor opcional — disponible en ambos modos del toggle.
  const [productLabel, setProductLabel] = useState<string>((initialSource as any)?.productLabel ?? '');
  const [productValue, setProductValue] = useState<string>((initialSource as any)?.productValue != null ? String((initialSource as any).productValue) : '');
  // Mensajería del retorno (solo aplica cuando withReturn=true).
  const [returnCarrier, setReturnCarrier] = useState<string>((initialSource as any)?.returnCarrier ?? '');
  const [returnShippingCost, setReturnShippingCost] = useState<string>((initialSource as any)?.returnShippingCost != null ? String((initialSource as any).returnShippingCost) : '');
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
  // Marcos 2026-08-24 (mismo síntoma que reportó en la conversación,
  // ahora aplicado al /orders standalone): persistir el borrador del
  // "Nuevo Pedido" en sessionStorage mientras se carga. Sólo aplica
  // a nuevos pedidos (no cuando estás editando uno existente ni
  // seedeando desde otro). Se restaura al abrir y se limpia al crear.
  const isNewOrderDraft = !order && !seedFromOrder;
  const draftKey = 'order-form-draft:new';
  useEffect(() => {
    if (!open) return;
    const src = order ?? seedFromOrder;
    // Try restoring from sessionStorage before applying defaults, but
    // only for the "nuevo pedido desde cero" path.
    if (isNewOrderDraft && typeof window !== "undefined") {
      try {
        const raw = window.sessionStorage.getItem(draftKey);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved && typeof saved === 'object') {
            setContactId(saved.contactId ?? "");
            setCurrency(saved.currency === 'USD' ? 'USD' : 'ARS');
            setRows(Array.isArray(saved.rows) && saved.rows.length > 0 ? saved.rows : rowsFromOrder(src));
            setNotes(saved.notes ?? "");
            setAmountOverride(saved.amountOverride ?? "");
            setDiscountPercent(saved.discountPercent ?? "");
            setSectionOverride(saved.sectionOverride ?? 'MOTOS');
            setOrderMode(saved.orderMode ?? 'PEDIDO');
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
            setRepCarrier((src as any)?.carrier ?? '');
            setRepZone((src as any)?.shippingZone ?? '');
            setResponsibleId((src as any)?.responsibleId ?? '');
            setErrorReason((src as any)?.errorReason ?? '');
            setErrorReasonNote((src as any)?.errorReasonNote ?? '');
            setWithReturn(false);
            setProductLabel('');
            setProductValue('');
            setReturnCarrier('');
            setReturnShippingCost('');
            setRepCost('');
            return;
          }
        }
      } catch { /* fall through */ }
    }
    setContactId(src?.contactId ?? "");
    setCurrency((src?.currency as "ARS" | "USD") ?? "ARS");
    setRows(rowsFromOrder(src));
    setNotes((src as any)?.notes ?? "");
    setAmountOverride(src?.amount != null ? String(src.amount) : "");
    setDiscountPercent((src as any)?.discountPercent != null ? String((src as any).discountPercent) : "");
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
    setResponsibleId((src as any)?.responsibleId ?? '');
    setErrorReason((src as any)?.errorReason ?? '');
    setErrorReasonNote((src as any)?.errorReasonNote ?? '');
    setWithReturn(((src as any)?.returnState === 'PENDING') || ((src as any)?.returnState === 'RETURNED') || ((src as any)?.returnState === 'LOST'));
    setProductLabel((src as any)?.productLabel ?? '');
    setProductValue((src as any)?.productValue != null ? String((src as any).productValue) : '');
    setReturnCarrier((src as any)?.returnCarrier ?? '');
    setReturnShippingCost((src as any)?.returnShippingCost != null ? String((src as any).returnShippingCost) : '');
    setRepCost((src as any)?.shippingCost != null ? String((src as any).shippingCost) : '');
  }, [open, order, seedFromOrder, initialModeOverride]);

  // Autosave the draft while the dialog is open (nuevo pedido only).
  useEffect(() => {
    if (!open || !isNewOrderDraft) return;
    if (typeof window === "undefined") return;
    try {
      const payload = { contactId, currency, rows, notes, amountOverride, discountPercent, sectionOverride, orderMode };
      window.sessionStorage.setItem(draftKey, JSON.stringify(payload));
    } catch { /* storage disabled — skip */ }
  }, [open, isNewOrderDraft, contactId, currency, rows, notes, amountOverride, discountPercent, sectionOverride, orderMode]);

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
  // Marcos 2026-06-22: debounce del input → query backend cada 300ms.
  useEffect(() => {
    const t = window.setTimeout(() => setContactSearchDebounced(contactSearch.trim()), 300);
    return () => window.clearTimeout(t);
  }, [contactSearch]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        setContactSearchLoading(true);
        const params: any = { limit: 50 };
        if (contactSearchDebounced.length > 0) params.search = contactSearchDebounced;
        const res = await api.contacts.list(params);
        const arr = Array.isArray((res as any)?.contacts)
          ? ((res as any).contacts as Contact[])
          : (Array.isArray(res as any) ? (res as unknown as Contact[]) : []);
        if (!cancelled) setContacts(arr);
      } catch {
        if (!cancelled) setContacts([]);
      } finally {
        if (!cancelled) setContactSearchLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, contactSearchDebounced]);

  // Tariffs sólo se cargan al abrir el diálogo — no dependen del
  // search del cliente.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const tr = await (api as any).dispatchTariffs?.list?.();
        if (!cancelled && Array.isArray(tr)) {
          setTariffs(tr.filter((t: any) => t.active !== false));
        }
      } catch {/* non-fatal */}
      // Marcos 2026-06-22: catálogo de responsables (solo activos)
      // para el picker del tab REPOSICION.
      try {
        const rs = await (api as any).operationalResponsibles?.list?.({ activeOnly: true });
        if (!cancelled && Array.isArray(rs)) {
          setResponsibles(rs.map((r: any) => ({ id: r.id, name: r.name })));
        }
      } catch {/* non-fatal — el picker queda vacío y el form bloquea */}
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Marcos 2026-06-22: cuando el form se abre en modo edición /
  // seed, hidratamos el contacto pre-seleccionado con su .name
  // explícito en lugar de depender del .find en la lista. Esto evita
  // que el chip vaya a "[contactId]" cuando el operador busca otra
  // cosa y el seleccionado deja de estar en la página actual.
  useEffect(() => {
    if (!open || !contactId) { setSelectedContact(null); return; }
    if (initialSource && (initialSource as any).contact?.id === contactId) {
      setSelectedContact((initialSource as any).contact as Contact);
      return;
    }
    const hit = contacts.find((c) => c.id === contactId);
    if (hit) setSelectedContact(hit);
  }, [open, contactId, initialSource, contacts]);

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

  const subtotalAfterLineDiscounts = useMemo(() => rows.reduce((s, r) => s + lineTotal(r), 0), [rows]);
  // Marcos 2026-06-23: descuento general aplicado AL SUBTOTAL (que ya
  // tiene los descuentos por línea aplicados). Convive con override
  // manual del monto a facturar; si el operador escribe un override,
  // ese gana sobre todo el cálculo.
  const orderDiscount = (() => {
    const d = Number(discountPercent);
    return Number.isFinite(d) && d > 0 && d <= 100 ? d : 0;
  })();
  const computedTotal = Math.round(subtotalAfterLineDiscounts * (1 - orderDiscount / 100) * 100) / 100;
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
      // Marcos 2026-06-22: REPOSICION requiere responsable cargado —
      // sin esto el reporte de costo por responsable queda incompleto.
      // DEVOLUCION no aplica.
      if (orderMode === 'REPOSICION' && !errorReason) {
        toast.error("Elegí el motivo del error de la reposición");
        return;
      }
      if (orderMode === 'REPOSICION' && errorReason === 'OTRO' && !errorReasonNote.trim()) {
        toast.error("Detallá el motivo del error (opción 'Otro' requiere descripción)");
        return;
      }
      if (orderMode === 'REPOSICION' && !responsibleId) {
        toast.error("Elegí el responsable del paquete mal despachado");
        return;
      }
      // Marcos 2026-06-23: si el operador tildó "CON DEVOLUCION" tiene
      // que dejar al menos un carrier del retorno; si no, se asume
      // SIN DEVOLUCION y los campos de retorno se ignoran.
      const pv = productValue.trim() === '' ? null : Number(productValue);
      if (pv !== null && (!Number.isFinite(pv) || pv < 0)) {
        toast.error("Valor del producto inválido");
        return;
      }
      const rsc = returnShippingCost.trim() === '' ? null : Number(returnShippingCost);
      if (orderMode === 'REPOSICION' && withReturn) {
        if (!returnCarrier.trim()) {
          toast.error("Cargá la mensajería del retorno (o destildá 'Producto vuelve')");
          return;
        }
        if (rsc !== null && (!Number.isFinite(rsc) || rsc < 0)) {
          toast.error("Costo del retorno inválido");
          return;
        }
      }
      setSubmitting(true);
      try {
        const prefix = orderMode === 'DEVOLUCION' ? 'Devolución' : 'Reposición';
        // Marcos 2026-07-14: si el operador cargó productos en la
        // fila (para que el armador sepa qué reenviar), los adjuntamos.
        // Si no cargó nada, dejamos el placeholder que existía
        // (`${prefix} ${carrier} ${zone}`) para no perder la línea.
        const cleanedReposProducts = rows
          .map((r) => ({
            name: r.name.trim(),
            category: (r.category || '').trim() || 'General',
            quantity: Number(r.quantity),
            unitPrice: Number(r.unitPrice),
            sku: (r.sku || '').trim() || undefined,
          }))
          .filter((r) => r.name.length > 0 && r.quantity > 0)
          .map((r) => ({
            ...r,
            totalPrice: Math.round(r.quantity * (Number.isFinite(r.unitPrice) ? r.unitPrice : 0) * 100) / 100,
          }));
        const reposicionProducts = cleanedReposProducts.length > 0
          ? cleanedReposProducts
          : [{ name: `${prefix} ${carrier} ${zone}`, category: prefix, quantity: 1, unitPrice: cost, totalPrice: cost }];
        await api.orders.create({
          contactId,
          amount: cost,
          currency: 'ARS',
          products: reposicionProducts,
          notes: notes.trim() || undefined,
          sectionOverride,
          orderType: orderMode,
          carrier,
          shippingZone: zone,
          shippingCost: cost,
          responsibleId: orderMode === 'REPOSICION' ? responsibleId : null,
          errorReason: orderMode === 'REPOSICION' ? errorReason : null,
          errorReasonNote:
            orderMode === 'REPOSICION' && errorReason === 'OTRO'
              ? (errorReasonNote.trim() || null)
              : null,
          // Marcos 2026-06-23: nuevos campos del ciclo de retorno.
          // En REPOSICION respetamos el toggle; en DEVOLUCION
          // forzamos withReturn=true (el caso de uso ES devolver).
          withReturn: orderMode === 'REPOSICION' ? withReturn : (orderMode === 'DEVOLUCION'),
          productValue: pv,
          productLabel: productLabel.trim() || null,
          returnCarrier: orderMode === 'REPOSICION' && withReturn ? returnCarrier.trim() || null : null,
          returnShippingCost: orderMode === 'REPOSICION' && withReturn ? rsc : null,
        } as any);
        toast.success(orderMode === 'DEVOLUCION' ? 'Devolución registrada' : 'Reposición registrada');
        if (isNewOrderDraft && typeof window !== "undefined") {
          try { window.sessionStorage.removeItem(draftKey); } catch {}
        }
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
      .map((r) => {
        const d = Number(r.discountPercent ?? '');
        const lineDisc = Number.isFinite(d) && d > 0 && d <= 100 ? d : 0;
        return {
          name: r.name.trim(),
          category: r.category.trim() || "General",
          quantity: Number(r.quantity),
          unitPrice: Number(r.unitPrice),
          sku: (r.sku || '').trim() || undefined,
          discountPercent: lineDisc > 0 ? lineDisc : undefined,
        };
      })
      .filter((r) => r.name.length > 0 && r.quantity > 0 && Number.isFinite(r.unitPrice) && r.unitPrice >= 0);
    if (cleaned.length === 0) {
      toast.error("Agregá al menos un producto con nombre, cantidad y precio.");
      return;
    }
    if (!Number.isFinite(finalTotal) || finalTotal < 0) {
      toast.error("Monto total inválido");
      return;
    }
    const products = cleaned.map((r) => {
      const gross = r.quantity * r.unitPrice;
      const net = r.discountPercent ? gross * (1 - r.discountPercent / 100) : gross;
      return {
        name: r.name,
        category: r.category,
        quantity: r.quantity,
        unitPrice: r.unitPrice,
        totalPrice: Math.round(net * 100) / 100,
        ...(r.sku ? { sku: r.sku } : {}),
        ...(r.discountPercent ? { discountPercent: r.discountPercent } : {}),
      };
    });
    setSubmitting(true);
    try {
      if (isEditing && order) {
        await api.orders.update(order.id, {
          amount: finalTotal,
          currency,
          products,
          notes: notes.trim() || undefined,
          discountPercent: orderDiscount > 0 ? orderDiscount : null,
        } as any);
        toast.success("Pedido actualizado");
      } else {
        await api.orders.create({
          contactId,
          amount: finalTotal,
          currency,
          products,
          notes: notes.trim() || undefined,
          sectionOverride,
          discountPercent: orderDiscount > 0 ? orderDiscount : null,
        } as any);
        toast.success("Pedido creado");
      }
      if (isNewOrderDraft && typeof window !== "undefined") {
        try { window.sessionStorage.removeItem(draftKey); } catch {}
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
        className="max-h-[90dvh] overflow-y-auto rounded-2xl border border-slate-200/70 bg-white/95 p-4 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150 sm:max-w-[960px] sm:p-6"
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
                {/* Marcos 2026-06-22: picker buscable. El input dispara
                   búsqueda server-side debounced contra toda la base
                   de contactos (name / phone / email / DNI / CUIT). El
                   chip verde de abajo muestra el seleccionado actual
                   y se puede limpiar con la X. */}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Input
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                      placeholder="Buscar por nombre, teléfono, email, DNI o CUIT…"
                      data-testid="order-form-contact-search"
                      className="h-11"
                    />
                    {contactSearchLoading && (
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">…</span>
                    )}
                  </div>
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
                {/* Chip del seleccionado actual — siempre visible
                   cuando hay contactId, incluso si el operador busca
                   otra cosa después. */}
                {contactId && selectedContact && (
                  <div
                    data-testid="order-form-contact-selected"
                    className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800"
                  >
                    <span className="truncate max-w-[280px]">
                      {selectedContact.name || selectedContact.phone || selectedContact.email || contactId}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setContactId(""); setSelectedContact(null); }}
                      title="Limpiar selección"
                      className="grid h-5 w-5 place-items-center rounded-full text-emerald-700 hover:bg-emerald-200"
                    >
                      ×
                    </button>
                  </div>
                )}
                {/* Resultados — sólo se muestran si hay search OR no
                   hay nada seleccionado todavía. Cap 50; el operador
                   refina el search si hay muchos. */}
                {/* Marcos 2026-06-23: ocultar los primeros sugeridos
                   hasta que el operador empiece a buscar. Antes
                   abriamos el form y se llenaba la mitad del modal
                   con una lista de los 50 ultimos contactos — innecesario
                   porque el operador casi siempre llega con un nombre
                   o un dni en la cabeza. Ahora la lista solo aparece
                   despues de tipear (>=1 char). */}
                {contactSearchDebounced.length > 0 && contacts.length > 0 && (
                  <ul
                    data-testid="order-form-contact-results"
                    className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white"
                  >
                    {contacts.map((c) => {
                      const isSel = c.id === contactId;
                      const meta = (c as any).metadata as any;
                      const fiscalId = meta?.fiscalId ?? meta?.cuit ?? meta?.dni ?? null;
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setContactId(c.id);
                              setSelectedContact(c);
                              setContactSearch("");
                            }}
                            className={
                              "flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors " +
                              (isSel ? "bg-emerald-50 text-emerald-900" : "text-slate-700 hover:bg-slate-50")
                            }
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{c.name || "(sin nombre)"}</span>
                              <span className="block truncate text-[11px] text-slate-500">
                                {[c.phone, c.email, fiscalId].filter(Boolean).join(" · ") || c.id}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {contactSearchDebounced.length > 0 && !contactSearchLoading && contacts.length === 0 && (
                  <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    Sin coincidencias para "{contactSearchDebounced}". Probá con otro criterio o tocá "Nuevo" para crearlo.
                  </p>
                )}
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
                {/* Marcos 2026-06-23: el picker de mensajería pasa a
                   ser input libre + sugerencias (datalist). Cuando la
                   reposición va por Uber / Didi / particular —
                   couriers ad-hoc que NO están en la tabla de tarifas
                   — el operador escribe el nombre y queda registrado
                   en Order.carrier. No se cruza con la analitica de
                   "deudas a mensajerías": el card de despachos solo
                   muestra estimated cost cuando hay tarifa cargada;
                   sin tarifa, esa columna queda en null para esa
                   mensajería puntual. */}
                <Input
                  list="reposicion-carrier-suggestions"
                  value={repCarrier}
                  onChange={(e) => setRepCarrier(e.target.value)}
                  placeholder="Mensajería (Andreani, Uber, Didi…)"
                  data-testid="order-form-reposicion-carrier"
                  className="h-10"
                />
                <datalist id="reposicion-carrier-suggestions">
                  {Array.from(new Set(tariffs.map((t) => t.carrier))).sort().map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                {/* Marcos 2026-06-23: zona también libre. Para
                   carriers con tarifa, filtramos sugerencias por
                   carrier; para carriers ad-hoc (Uber, etc) ofrecemos
                   todas las zonas conocidas como sugerencia y el
                   operador escribe lo que quiera. */}
                <Input
                  list="reposicion-zone-suggestions"
                  value={repZone}
                  onChange={(e) => setRepZone(e.target.value)}
                  placeholder="Zona"
                  data-testid="order-form-reposicion-zone"
                  className="h-10"
                />
                <datalist id="reposicion-zone-suggestions">
                  {Array.from(new Set(
                    tariffs
                      .filter((t) => !repCarrier || t.carrier === repCarrier)
                      .map((t) => t.zone)
                      .concat(
                        // Si el carrier no tiene tarifas, fallback a la
                        // union de todas las zonas conocidas.
                        repCarrier && !tariffs.some((t) => t.carrier === repCarrier)
                          ? tariffs.map((t) => t.zone)
                          : []
                      )
                  )).sort().map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
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
                  : 'Esta fila no entra en facturación ni en métricas de ventas, pero sí cuenta en métricas de logística por responsable.'}
              </p>
              {/* Marcos 2026-06-22: responsable del paquete mal
                 despachado — sólo en REPOSICION (no aplica a DEVOLUCION,
                 donde el paquete vuelve pero no hay re-trabajo). El
                 ADMIN administra la lista desde Settings → Logística. */}
              {orderMode === 'REPOSICION' && (
                <div className="mt-2">
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-amber-800">
                    Responsable <span className="text-rose-600">*</span>
                  </label>
                  <select
                    value={responsibleId}
                    onChange={(e) => setResponsibleId(e.target.value)}
                    data-testid="order-form-reposicion-responsible"
                    className="block h-10 w-full rounded-lg border border-amber-300 bg-white px-3 text-sm text-slate-700 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
                  >
                    <option value="">Seleccioná un responsable…</option>
                    {responsibles.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  {responsibles.length === 0 && (
                    <p className="mt-1 text-[10px] text-rose-700">
                      No hay responsables cargados. Pedile al admin que los configure en Settings → Logística.
                    </p>
                  )}
                </div>
              )}

              {/* Marcos 2026-07-03: motivo del error obligatorio en REPOSICION.
                  5 opciones fijas; OTRO habilita free text abajo. Los reportes
                  agrupan por este enum para ver qué tipo de error repite cada
                  responsable. */}
              {orderMode === 'REPOSICION' && (
                <div className="mt-2">
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-amber-800">
                    Motivo del error <span className="text-rose-600">*</span>
                  </label>
                  <select
                    value={errorReason}
                    onChange={(e) => setErrorReason(e.target.value)}
                    data-testid="order-form-reposicion-error-reason"
                    className="block h-10 w-full rounded-lg border border-amber-300 bg-white px-3 text-sm text-slate-700 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
                  >
                    <option value="">Seleccioná el motivo…</option>
                    <option value="PRODUCTO_EQUIVOCADO">Producto equivocado</option>
                    <option value="PRODUCTO_FALTANTE">Producto faltante</option>
                    <option value="ROTO_MAL_EMBALADO">Roto / mal embalado</option>
                    <option value="DIRECCION_MAL_CARGADA">Dirección mal cargada</option>
                    <option value="OTRO">Otro (habilita texto libre)</option>
                  </select>
                  {errorReason === 'OTRO' && (
                    <Input
                      value={errorReasonNote}
                      onChange={(e) => setErrorReasonNote(e.target.value)}
                      placeholder="Describí el motivo del error…"
                      data-testid="order-form-reposicion-error-reason-note"
                      className="mt-2 h-10"
                    />
                  )}
                </div>
              )}

              {/* Marcos 2026-06-23: toggle CON/SIN devolución + campos
                 "qué producto" + "cuánto vale". Sólo se muestra en
                 REPOSICION. El producto/valor son opcionales (faltante
                 puro no se carga); cuando se llenan, el destino depende
                 del toggle:
                   SIN DEVOLUCION  → valor va al panel del responsable
                   CON DEVOLUCION  → crea pendiente de regreso. Cierre
                                     posterior con Volvió / No volvió. */}
              {orderMode === 'REPOSICION' && (
                <div className="mt-3 rounded-xl border border-amber-300/70 bg-white/70 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <label className="text-[11px] font-medium uppercase tracking-wider text-amber-900">
                        ¿El producto vuelve?
                      </label>
                      <p className="text-[10px] text-slate-500">
                        {withReturn
                          ? 'CON DEVOLUCIÓN — se crea un pendiente de regreso. Cargá la mensajería del retorno abajo.'
                          : 'SIN DEVOLUCIÓN — el producto queda en el cliente. El valor (si lo cargás) suma al panel del responsable.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={withReturn}
                      onClick={() => setWithReturn((v) => !v)}
                      data-testid="order-form-reposicion-with-return-toggle"
                      className={
                        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors " +
                        (withReturn ? 'bg-amber-600' : 'bg-slate-300')
                      }
                    >
                      <span
                        className={
                          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform " +
                          (withReturn ? 'translate-x-5' : 'translate-x-0.5') + ' translate-y-0.5'
                        }
                      />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_160px]">
                    <Input
                      value={productLabel}
                      onChange={(e) => setProductLabel(e.target.value)}
                      placeholder="Producto involucrado (opcional)"
                      data-testid="order-form-reposicion-product-label"
                      className="h-10"
                    />
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={productValue}
                      onChange={(e) => setProductValue(e.target.value)}
                      placeholder="Valor (opcional)"
                      data-testid="order-form-reposicion-product-value"
                      className="h-10 text-right"
                    />
                  </div>

                  {withReturn && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_160px]">
                      {/* Marcos 2026-06-23: mismo combobox libre que el
                         carrier de salida — admite Uber/Didi/particular
                         además de las mensajerías con tarifa cargada. */}
                      <Input
                        list="reposicion-return-carrier-suggestions"
                        value={returnCarrier}
                        onChange={(e) => setReturnCarrier(e.target.value)}
                        placeholder="Mensajería del retorno (Andreani, Uber, Didi…)"
                        data-testid="order-form-reposicion-return-carrier"
                        className="h-10"
                      />
                      <datalist id="reposicion-return-carrier-suggestions">
                        {Array.from(new Set(tariffs.map((t) => t.carrier))).sort().map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                      <Input
                        type="number"
                        inputMode="decimal"
                        value={returnShippingCost}
                        onChange={(e) => setReturnShippingCost(e.target.value)}
                        placeholder="Costo del retorno"
                        data-testid="order-form-reposicion-return-cost"
                        className="h-10 text-right"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Product rows — the actual manual-load surface.
              Marcos 2026-07-14: antes esto se ocultaba en REPOSICION /
              DEVOLUCION y el armador quedaba sin saber qué producto
              tenía que reenviar (sólo tenía la mensajería + costo).
              Ahora el picker aparece siempre — en reposicion es
              opcional y va a `products` para que el armador lo vea. */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                {isReposicion ? 'Producto(s) a reenviar' : (<>Productos <span className="text-emerald-600">*</span></>)}
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
                  className="grid grid-cols-[minmax(260px,2.5fr)_70px_minmax(140px,1fr)_100px_70px_36px] items-center gap-2 rounded-xl border border-slate-200 bg-white p-2"
                >
                  <div className="min-w-0">
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
                    {/* Marcos 2026-08-21: mostramos el SKU debajo del
                        input así el operador ve qué producto matcheó
                        aunque el nombre no entre completo en la
                        celda. Antes sólo quedaba el nombre visible y
                        no había forma de repasar la selección. */}
                    {row.sku && (
                      <div
                        className="mt-1 truncate font-mono text-[10px] text-slate-500"
                        title={row.sku}
                        data-testid={`order-form-row-sku-${idx}`}
                      >
                        SKU: {row.sku}
                      </div>
                    )}
                  </div>
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
                  {/* Marcos 2026-06-23: descuento % por línea (opcional). */}
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    value={row.discountPercent ?? ''}
                    onChange={(e) => updateRow(idx, { discountPercent: e.target.value })}
                    placeholder="Desc. %"
                    className="text-right"
                    data-testid={`order-form-row-discount-${idx}`}
                    title="Descuento porcentual aplicado solo a esta línea"
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

          {/* Marcos 2026-06-23: descuento general % aplicado al pedido
             entero. Se cobra después de los descuentos por línea, así
             el operador puede combinar ítem específico + transferencia. */}
          {!isReposicion && (
          <div className="grid grid-cols-[1fr_120px] gap-3 items-end">
            <p className="text-[11px] text-slate-500">
              <strong className="text-slate-700">Descuento general:</strong> aplicado al subtotal después de descuentos por línea. Útil para "paga por transferencia" sin tocar cada ítem.
            </p>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Descuento %
              </label>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                value={discountPercent}
                onChange={(e) => setDiscountPercent(e.target.value)}
                placeholder="0"
                data-testid="order-form-discount-percent"
                className="h-10 text-right"
              />
            </div>
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
                {orderDiscount > 0 && (
                  <span className="ml-2 text-[10px] text-emerald-700">
                    (−{orderDiscount}%, subtotal {fmt(currency, subtotalAfterLineDiscounts)})
                  </span>
                )}
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
