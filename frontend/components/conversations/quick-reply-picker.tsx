"use client";

// Floating menu shown above the composer when the operator types "/" at
// the start of the textarea. Filters by shortcut/title prefix as they
// keep typing; Enter picks the highlighted item, Escape dismisses.

import { useEffect, useRef, useState } from "react";

export interface QuickReplyOption {
  id: string;
  label: string;
  body: string;
  category: string | null;
}

interface Props {
  /** All available templates. The picker filters in-memory. */
  options: QuickReplyOption[];
  /** Current text after the leading "/" — empty string shows everything. */
  query: string;
  /** Called when the operator selects a template. */
  onPick: (option: QuickReplyOption) => void;
  /** Called when the operator dismisses (Escape) or types a non-matching token. */
  onDismiss: () => void;
}

export function QuickReplyPicker({ options, query, onPick, onDismiss }: Props) {
  const filtered = filterOptions(options, query);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // Reset highlight whenever the filtered list changes shape.
  useEffect(() => { setActive(0); }, [query, filtered.length]);

  // Keyboard navigation. Captures Arrow/Enter/Escape at the document level
  // so the textarea doesn't intercept them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const opt = filtered[active];
        if (opt) onPick(opt);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [filtered, active, onPick, onDismiss]);

  // Auto-scroll the active row into view when it changes.
  useEffect(() => {
    const ul = listRef.current;
    if (!ul) return;
    const el = ul.children[active] as HTMLElement | undefined;
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (filtered.length === 0) {
    return (
      <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500 shadow-[0_8px_24px_-6px_rgb(15_23_42/0.18)]">
        Sin coincidencias para <span className="font-mono">/{query}</span>
      </div>
    );
  }

  return (
    <div
      role="listbox"
      aria-label="Respuestas rápidas"
      className="absolute bottom-full left-0 right-0 mb-2 max-h-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_8px_24px_-6px_rgb(15_23_42/0.18)]"
    >
      <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-500">
        Respuestas rápidas — Enter para insertar, Esc para cerrar
      </div>
      <ul ref={listRef} className="max-h-64 overflow-y-auto py-1">
        {filtered.map((opt, idx) => (
          <li
            key={opt.id}
            role="option"
            aria-selected={idx === active}
            onMouseEnter={() => setActive(idx)}
            onMouseDown={(e) => { e.preventDefault(); onPick(opt); }}
            className={
              "flex cursor-pointer items-start gap-2 px-3 py-2 " +
              (idx === active
                ? "bg-blue-50 text-blue-900"
                : "text-slate-700 hover:bg-slate-50")
            }
          >
            <span className="mt-0.5 inline-flex shrink-0 items-center rounded-md bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
              {opt.label}
            </span>
            <div className="min-w-0 flex-1">
              <div className="line-clamp-2 text-[11px] leading-snug text-slate-700">
                {opt.body}
              </div>
            </div>
            {opt.category && (
              <span className="shrink-0 self-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                {opt.category}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function filterOptions(options: QuickReplyOption[], q: string): QuickReplyOption[] {
  const needle = q.toLowerCase();
  if (!needle) return options;
  return options.filter((o) =>
    o.label.toLowerCase().includes(needle) ||
    o.body.toLowerCase().includes(needle),
  );
}
