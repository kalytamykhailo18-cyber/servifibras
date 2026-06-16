"use client";

import { useEffect, useState } from "react";

const PAGE_SIZE_KEY = "servifibras-page-size";

/**
 * Client-side pagination for a fully-loaded list. Use this when the
 * backend returns the entire dataset and we slice in the browser. For
 * server-paginated endpoints (contacts, knowledge, conversations) stick
 * with the server-driven `page`/`totalPages` state — this hook is for
 * the rest of the lists where the backend still returns everything in
 * one response.
 *
 * Page-size preference is persisted under `servifibras-page-size:<key>`
 * so each page remembers the user's choice independently.
 */
export function useClientPagination<T>(items: T[], opts: { storageKey?: string; defaultPageSize?: number } = {}) {
  const { storageKey, defaultPageSize = 25 } = opts;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() => {
    if (typeof window === "undefined") return defaultPageSize;
    if (!storageKey) return defaultPageSize;
    const raw = window.localStorage.getItem(`${PAGE_SIZE_KEY}:${storageKey}`);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : defaultPageSize;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !storageKey) return;
    window.localStorage.setItem(`${PAGE_SIZE_KEY}:${storageKey}`, String(pageSize));
  }, [pageSize, storageKey]);

  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);

  // Snap back to page 1 when the underlying list shrinks below the window
  // (e.g. after a delete or a search filter narrows the result set).
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const slice = items.slice((safePage - 1) * pageSize, safePage * pageSize);

  return {
    page: safePage,
    pageSize,
    totalPages,
    totalItems,
    slice,
    setPage,
    setPageSize: (n: number) => {
      setPageSize(n);
      setPage(1);
    },
  };
}
