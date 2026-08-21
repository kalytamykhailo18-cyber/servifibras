"use client";

/**
 * Order-registration dialog opened from the conversation composer.
 *
 * Captures: optional explicit order number (Marcos's paper system uses
 * its own numbering and we should respect that when given), currency,
 * one or more product rows (name + qty + unit price; total is computed),
 * an optional notes field, and a derived total amount that the operator
 * can override.
 *
 * Posts to POST /admin/orders with `conversationId` so the order
 * back-links to this chat thread. The wholesale-alert path
 * (notifyIfWholesale) fires automatically server-side when the contact's
 * customerType qualifies, so this dialog doesn't need to know about it.
 */

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, productsApi, type Product } from "@/lib/api/endpoints";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import SearchIcon from "@mui/icons-material/Search";
import { toast } from "sonner";

interface ProductRow {
  name: string;
  category: string;
  quantity: string;
  unitPrice: string;
  // Marcos 2026-08-21: SKU visible bajo el picker para que el
  // operador pueda repasar qué producto matcheó, incluso cuando el
  // nombre no entra completo en la celda.
  sku?: string;
}

const EMPTY_ROW: ProductRow = { name: "", category: "", quantity: "1", unitPrice: "" };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  contactId: string;
  contactName: string | null | undefined;
  onRegistered: () => void;
}

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

export function RegisterOrderDialog({
  open,
  onOpenChange,
  conversationId,
  contactId,
  contactName,
  onRegistered,
}: Props) {
  const [orderNumber, setOrderNumber] = useState("");
  const [currency, setCurrency] = useState<"ARS" | "USD">("ARS");
  const [rows, setRows] = useState<ProductRow[]>([{ ...EMPTY_ROW }]);
  const [notes, setNotes] = useState("");
  const [amountOverride, setAmountOverride] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setOrderNumber("");
    setCurrency("ARS");
    setRows([{ ...EMPTY_ROW }]);
    setNotes("");
    setAmountOverride("");
  }, [open]);

  const computedTotal = rows.reduce((s, r) => s + lineTotal(r), 0);
  const finalTotal = amountOverride !== "" ? Number(amountOverride) || 0 : computedTotal;

  const updateRow = (idx: number, patch: Partial<ProductRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, { ...EMPTY_ROW }]);
  const removeRow = (idx: number) =>
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));

  const submit = async () => {
    const cleaned = rows
      .map((r) => ({
        name: r.name.trim(),
        category: r.category.trim() || "General",
        quantity: Number(r.quantity),
        unitPrice: Number(r.unitPrice),
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
    setSubmitting(true);
    try {
      const products = cleaned.map((r) => ({
        name: r.name,
        category: r.category,
        quantity: r.quantity,
        unitPrice: r.unitPrice,
        totalPrice: Math.round(r.quantity * r.unitPrice * 100) / 100,
      }));
      const created = await api.orders.create({
        contactId,
        conversationId,
        orderNumber: orderNumber.trim() || undefined,
        amount: finalTotal,
        currency,
        products,
        notes: notes.trim() || undefined,
      });
      toast.success(`Pedido ${created.orderNumber ?? ""} registrado`);
      onOpenChange(false);
      onRegistered();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo registrar el pedido");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl rounded-2xl border border-slate-200/70 bg-white/95 p-0 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150"
        data-testid="register-order-dialog"
      >
        <div className="flex items-start gap-3 border-b border-slate-200/60 p-5">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(16_185_129/0.45)]">
            <ReceiptLongIcon sx={{ fontSize: 22 }} />
          </span>
          <div className="min-w-0 flex-1">
            <DialogHeader>
              <DialogTitle className="text-base text-slate-900">Registrar pedido</DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                {contactName ? `Cliente: ${contactName}` : "Pedido vinculado a esta conversación"}
              </DialogDescription>
            </DialogHeader>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Número (opcional)
              </label>
              <Input
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                placeholder="auto-generado si vacío"
                data-testid="order-number-input"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Moneda
              </label>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                {(["ARS", "USD"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCurrency(c)}
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
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Productos
              </label>
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
              >
                <AddIcon sx={{ fontSize: 14 }} /> Agregar fila
              </button>
            </div>
            <ul className="space-y-2" data-testid="order-product-rows">
              {rows.map((row, idx) => (
                <li
                  key={idx}
                  className="grid grid-cols-[1fr_88px_1fr_110px_36px] items-center gap-2 rounded-xl border border-slate-200 bg-white p-2"
                >
                  <div className="min-w-0">
                    <ProductPicker
                      value={row.name}
                      currency={currency}
                      testId={`order-row-name-${idx}`}
                      onTextChange={(text) => updateRow(idx, { name: text })}
                      onSelect={(p, price) => {
                        // Auto-fill from catalog: name, category, and the
                        // matching-currency price (Marcos's ask — drop
                        // the manual price entry when the SKU is known).
                        // We don't clobber a price the operator already
                        // typed in case they're overriding for this sale.
                        const patch: Partial<ProductRow> = {
                          name: p.name,
                          category: p.category || row.category,
                          sku: p.sku || row.sku,
                        };
                        if (price != null && !row.unitPrice) {
                          patch.unitPrice = String(price);
                        }
                        updateRow(idx, patch);
                      }}
                    />
                    {row.sku && (
                      <div
                        className="mt-1 truncate font-mono text-[10px] text-slate-500"
                        title={row.sku}
                        data-testid={`order-row-sku-${idx}`}
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
                    data-testid={`order-row-quantity-${idx}`}
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
                    placeholder="Precio U."
                    className="text-right"
                    data-testid={`order-row-price-${idx}`}
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    disabled={rows.length === 1}
                    aria-label="Quitar fila"
                    className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                  >
                    <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Subtotal calculado</span>
              <span className="font-mono text-slate-700">{fmt(currency, computedTotal)}</span>
            </div>
            <div className="mt-2 grid grid-cols-[1fr_140px] items-end gap-2">
              <label className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                Monto total (override opcional)
              </label>
              <Input
                type="number"
                inputMode="decimal"
                value={amountOverride}
                onChange={(e) => setAmountOverride(e.target.value)}
                placeholder={String(computedTotal.toFixed(2))}
                className="text-right"
                data-testid="order-amount-override"
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-sm font-semibold text-slate-900">
              <span>Total final</span>
              <span className="font-mono" data-testid="order-final-total">{fmt(currency, finalTotal)}</span>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Notas
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Observaciones internas (opcional)"
              data-testid="order-notes"
            />
          </div>
        </div>

        <DialogFooter className="border-t border-slate-200/60 bg-slate-50/60 p-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            data-testid="order-submit"
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-600 to-teal-500 px-5 py-2 text-xs font-medium text-white shadow-[0_8px_20px_-6px_rgb(16_185_129/0.5)] hover:from-emerald-700 hover:to-teal-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <ReceiptLongIcon sx={{ fontSize: 14 }} />
            )}
            Registrar pedido
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Product picker — autocomplete that searches the catalog by SKU or name
// and fills price + category on select. Operators can still type free-form
// product names for one-off items the catalog doesn't have; the dropdown
// just disappears when no matches surface.
//
// History: pre-2026-05-14 this was a plain <Input> and operators had to
// remember SKU + price + spelling. Marcos flagged it the same day his
// admin user got created; the fix routes the search through
// /admin/products which is already populated by the TiendaNube sync.
// ---------------------------------------------------------------------------

interface ProductPickerProps {
  value: string;
  currency: "ARS" | "USD";
  testId?: string;
  onTextChange: (text: string) => void;
  onSelect: (product: Product, price: number | null) => void;
}

function ProductPicker({ value, currency, testId, onTextChange, onSelect }: ProductPickerProps) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDoc(ev: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Debounced fetch on every input change.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value || value.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const list = await productsApi.list({ search: value.trim(), activeOnly: true });
        setResults(Array.isArray(list) ? list.slice(0, 8) : []);
        setHighlight(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  function priceFor(p: Product): number | null {
    const v = currency === "USD" ? p.basePriceUsd : p.basePriceArs;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }

  function pick(p: Product) {
    onSelect(p, priceFor(p));
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const p = results[highlight];
      if (p) pick(p);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <Input
          value={value}
          onChange={(e) => {
            onTextChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Buscá por SKU o nombre"
          data-testid={testId}
          className="pl-7"
        />
      </div>
      {open && value.trim().length >= 2 && (
        <div
          className="absolute z-30 mt-1 max-h-64 w-[24rem] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
          data-testid={testId ? `${testId}-results` : undefined}
        >
          {loading && results.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-slate-500">Buscando…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-slate-500">
              Sin productos. Podés escribir uno nuevo manualmente.
            </div>
          ) : (
            <ul>
              {results.map((p, i) => {
                const price = priceFor(p);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setHighlight(i)}
                      onMouseDown={(e) => {
                        // mousedown not click — click happens after blur
                        // which would close the popover before the
                        // selection registers.
                        e.preventDefault();
                        pick(p);
                      }}
                      className={
                        "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors " +
                        (i === highlight ? "bg-emerald-50" : "hover:bg-slate-50")
                      }
                    >
                      <span className="mt-0.5 inline-flex shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                        {p.sku}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-slate-900">
                          {p.name}
                        </span>
                        <span className="block truncate text-[10px] text-slate-500">
                          {p.category}{p.baseUnit ? ` · ${p.baseUnit}` : ""}
                          {price != null ? ` · ${currency} ${price.toLocaleString("es-AR")}` : ""}
                          {!p.inStock ? " · sin stock" : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
