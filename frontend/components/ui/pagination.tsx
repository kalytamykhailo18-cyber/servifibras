"use client";

import { useMemo } from "react";

export interface PaginationProps {
  page: number;
  totalPages: number;
  /** Optional metadata for the "Showing X–Y of Z" line. */
  totalItems?: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  disabled?: boolean;
  /** Identifies top vs bottom for E2E selectors. */
  position?: "top" | "bottom";
  className?: string;
}

const ELLIPSIS = "…" as const;

/**
 * Build the page-number list with smart ellipsis. Always shows first +
 * last + a window of `windowSize` around the current page. Anything
 * collapsed renders as ELLIPSIS.
 *
 *   total=20 page=1   → 1 2 3 4 5 ... 20
 *   total=20 page=10  → 1 ... 8 9 10 11 12 ... 20
 *   total=20 page=20  → 1 ... 16 17 18 19 20
 */
function buildPageList(page: number, totalPages: number, windowSize = 1): Array<number | typeof ELLIPSIS> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const set = new Set<number>([1, totalPages, page]);
  for (let d = 1; d <= windowSize; d++) {
    set.add(page - d);
    set.add(page + d);
  }
  // Always show 2nd / 2nd-to-last when adjacent for cleaner layout
  if (page <= 4) {
    for (let i = 2; i <= 5; i++) set.add(i);
  }
  if (page >= totalPages - 3) {
    for (let i = totalPages - 4; i < totalPages; i++) set.add(i);
  }

  const sorted = [...set].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const out: Array<number | typeof ELLIPSIS> = [];
  let prev = 0;
  for (const n of sorted) {
    if (prev && n - prev > 1) out.push(ELLIPSIS);
    out.push(n);
    prev = n;
  }
  return out;
}

export function Pagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
  disabled = false,
  position = "bottom",
  className = "",
}: PaginationProps) {
  const pages = useMemo(() => buildPageList(page, Math.max(1, totalPages)), [page, totalPages]);

  // Hide entirely only when there's truly nothing to show: no extra
  // pages, no page-size knob, and no count/range to display. If the
  // caller supplied totalItems, always render so the user has the
  // "Mostrando X–Y de Z" affordance even on single-page lists.
  if (totalPages <= 1 && !onPageSizeChange && totalItems == null) return null;

  const showRange = (() => {
    if (totalItems == null || pageSize == null) return null;
    const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, totalItems);
    return { start, end };
  })();

  const navBtn =
    "inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-60 disabled:hover:border-slate-200 disabled:hover:bg-slate-50";
  const activeBtn =
    "inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-blue-300 bg-blue-50 px-2 text-xs font-semibold text-blue-700";

  return (
    <div
      data-testid={`pagination-${position}`}
      className={`flex flex-col items-center justify-between gap-2 rounded-xl border border-slate-200/70 bg-white/60 px-3 py-2 sm:flex-row ${className}`}
    >
      <div className="flex items-center gap-3 text-xs text-slate-500">
        {showRange && totalItems != null && (
          <span>
            {totalItems === 0 ? (
              <>0 resultados</>
            ) : (
              <>
                Mostrando <span className="font-semibold text-slate-900">{showRange.start}–{showRange.end}</span>{" "}
                de <span className="font-semibold text-slate-900">{totalItems}</span>
              </>
            )}
          </span>
        )}
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5">
            <span className="text-slate-500">Por página:</span>
            <select
              data-testid={`pagination-page-size-${position}`}
              value={pageSize ?? pageSizeOptions[0]}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              disabled={disabled}
              className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-blue-300 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {totalPages > 1 && (
        <>
          {/* Mobile (compact): ‹ page/total › with first/last on the outside */}
          <div className="flex items-center gap-1 sm:hidden">
            <button
              type="button"
              data-testid={`pagination-first-${position}`}
              disabled={disabled || page === 1}
              onClick={() => onPageChange(1)}
              aria-label="Primera página"
              className={navBtn}
            >
              «
            </button>
            <button
              type="button"
              data-testid={`pagination-prev-${position}`}
              disabled={disabled || page === 1}
              onClick={() => onPageChange(page - 1)}
              aria-label="Página anterior"
              className={navBtn}
            >
              ‹
            </button>
            <span
              data-testid={`pagination-current-${position}`}
              className="inline-flex h-8 items-center justify-center rounded-lg border border-blue-300 bg-blue-50 px-3 text-xs font-semibold text-blue-700 tabular-nums"
            >
              {page} / {totalPages}
            </span>
            <button
              type="button"
              data-testid={`pagination-next-${position}`}
              disabled={disabled || page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              aria-label="Página siguiente"
              className={navBtn}
            >
              ›
            </button>
            <button
              type="button"
              data-testid={`pagination-last-${position}`}
              disabled={disabled || page >= totalPages}
              onClick={() => onPageChange(totalPages)}
              aria-label="Última página"
              className={navBtn}
            >
              »
            </button>
          </div>

          {/* sm+ (full): page-number list with ellipsis */}
          <div className="hidden items-center gap-1 sm:flex">
            <button
              type="button"
              data-testid={`pagination-first-${position}-desktop`}
              disabled={disabled || page === 1}
              onClick={() => onPageChange(1)}
              aria-label="Primera página"
              className={navBtn}
            >
              «
            </button>
            <button
              type="button"
              data-testid={`pagination-prev-${position}-desktop`}
              disabled={disabled || page === 1}
              onClick={() => onPageChange(page - 1)}
              aria-label="Página anterior"
              className={navBtn}
            >
              ‹
            </button>

            {pages.map((p, i) =>
              p === ELLIPSIS ? (
                <span key={`e${i}`} className="px-1 text-xs text-slate-400">{ELLIPSIS}</span>
              ) : (
                <button
                  key={p}
                  type="button"
                  data-testid={`pagination-page-${p}-${position}`}
                  aria-current={p === page ? "page" : undefined}
                  aria-label={`Página ${p}`}
                  disabled={disabled}
                  onClick={() => onPageChange(p as number)}
                  className={p === page ? activeBtn : navBtn}
                >
                  {p}
                </button>
              ),
            )}

            <button
              type="button"
              data-testid={`pagination-next-${position}-desktop`}
              disabled={disabled || page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              aria-label="Página siguiente"
              className={navBtn}
            >
              ›
            </button>
            <button
              type="button"
              data-testid={`pagination-last-${position}-desktop`}
              disabled={disabled || page >= totalPages}
              onClick={() => onPageChange(totalPages)}
              aria-label="Última página"
              className={navBtn}
            >
              »
            </button>
          </div>
        </>
      )}
    </div>
  );
}
