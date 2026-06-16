"use client";

/**
 * Reusable product autocomplete — searches the catalog by SKU or name
 * and reports the picked product back to the parent. Operators can
 * still type free-form product names for one-off items the catalog
 * doesn't have; the dropdown just disappears when no matches surface.
 *
 * Marcos 2026-06-12 ask (Pedidos manual-load): same picker the
 * register-order-dialog uses inside conversations is now reused on
 * the /orders form so the manual-creation flow has the same UX as
 * the inline registration from a chat. Extracted from
 * register-order-dialog so both surfaces share one implementation.
 *
 * Price field follows the active `currency` — USD picks
 * `basePriceUsd`, anything else picks `basePriceArs`. Parent decides
 * whether to clobber an already-typed price on select.
 */

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { productsApi, type Product } from "@/lib/api/endpoints";
import SearchIcon from "@mui/icons-material/Search";

export interface ProductPickerProps {
  value: string;
  currency: "ARS" | "USD";
  testId?: string;
  onTextChange: (text: string) => void;
  onSelect: (product: Product, price: number | null) => void;
}

export function ProductPicker({ value, currency, testId, onTextChange, onSelect }: ProductPickerProps) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
