"use client";

/**
 * Marcos 2026-06-18: composer del panel de ML QA.
 *
 * Envuelve el textarea de borrador con dos affordances que Marcos pidió
 * espejando el backoffice de ML:
 *
 *   1. Chips reusables encima del textarea — la librería de Respuestas
 *      Rápidas. Click inserta el body al cursor. Misma fila de chips
 *      sirve para todos los borradores del panel.
 *
 *   2. Atajo "#" para insertar el link directo de otra publicación —
 *      el operador tipea # + nombre, aparece un menú typeahead con
 *      productos del catálogo que tienen mlPermalink, click inserta
 *      el URL exacto en el cursor. Reemplaza la fricción de tener que
 *      copiar el link a mano desde el listado de Productos.
 *
 * No reemplaza el textarea legacy del panel — lo monta encima/alrededor
 * para mantener el resto del flow intacto (debounced save, "guardado"
 * label, botones Descartar/Enviar a Mercado Libre). El padre sigue
 * dueño del estado del borrador.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api/endpoints";
import { toast } from "sonner";
import BoltIcon from "@mui/icons-material/Bolt";
import LinkIcon from "@mui/icons-material/Link";

type QuickReply = {
  id: string;
  label: string;
  body: string;
  category: string | null;
};

type ListingHit = {
  itemId: string;
  title: string;
  permalink: string;
  thumbnailUrl: string | null;
  accountKey: string;
};

interface Props {
  /** Identificador del borrador — usado para el data-testid. */
  draftId: string;
  /** Texto actual del borrador (controlado por el padre). */
  value: string;
  /** Notifica al padre que el texto cambió. */
  onChange: (next: string) => void;
  /** Disparado en blur para forzar el flush del save. */
  onBlur?: () => void;
  /** Bloquea la edición mientras el padre está enviando / descartando. */
  disabled?: boolean;
  /** Filas pre-cargadas — si las pasa el padre evita N requests por borrador. */
  quickReplies?: QuickReply[];
}

export function MlDraftComposer({
  draftId,
  value,
  onChange,
  onBlur,
  disabled,
  quickReplies: externalQR,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [localQR, setLocalQR] = useState<QuickReply[]>([]);
  const replies = externalQR ?? localQR;

  // Carga sólo si el padre no las pasó.
  useEffect(() => {
    if (externalQR) return;
    let cancelled = false;
    api.conversations
      .listQuickReplies()
      .then((rows) => { if (!cancelled) setLocalQR(rows as QuickReply[]); })
      .catch(() => { /* feature degrades silently */ });
    return () => { cancelled = true; };
  }, [externalQR]);

  // # typeahead state.
  const [hashOpen, setHashOpen] = useState(false);
  const [hashQuery, setHashQuery] = useState("");
  const [hashHits, setHashHits] = useState<ListingHit[]>([]);
  const [hashLoading, setHashLoading] = useState(false);
  const [hashActiveIdx, setHashActiveIdx] = useState(0);
  const [hashAnchor, setHashAnchor] = useState<{ start: number; end: number } | null>(null);

  // Debounced fetch — kicks 300ms after the operator stops typing the
  // # query so we don't fire on every keystroke. Marcos 2026-06-18 PM:
  // pega contra `/admin/mercadolibre/listings/search` que consulta las
  // publicaciones ACTIVAS de ML en tiempo real (no el catálogo local
  // TN — un link de tiendaservifibras.com pegado en ML es falta grave).
  useEffect(() => {
    if (!hashOpen) return;
    if (hashQuery.trim().length < 2) {
      // Two-char floor — la API de ML penaliza queries de 1 char con
      // muchísimos falsos positivos. Esperá a que el operador escriba
      // un poco antes de disparar.
      setHashHits([]);
      setHashLoading(false);
      return;
    }
    const t = window.setTimeout(async () => {
      setHashLoading(true);
      try {
        const list = await api.mercadolibre.searchListings(hashQuery, 8);
        setHashHits((list ?? []).slice(0, 8));
        setHashActiveIdx(0);
      } catch (err: any) {
        setHashHits([]);
      } finally {
        setHashLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [hashOpen, hashQuery]);

  const insertAtCursor = useCallback(
    (insertion: string, replaceRange?: { start: number; end: number }) => {
      const ta = textareaRef.current;
      const cur = ta?.selectionStart ?? value.length;
      const end = ta?.selectionEnd ?? cur;
      const start = replaceRange?.start ?? cur;
      const finish = replaceRange?.end ?? end;
      const next = value.slice(0, start) + insertion + value.slice(finish);
      onChange(next);
      // Restore cursor right after the insertion on the next tick (after
      // the controlled re-render flushes).
      window.requestAnimationFrame(() => {
        const t = textareaRef.current;
        if (!t) return;
        const pos = start + insertion.length;
        t.focus();
        t.setSelectionRange(pos, pos);
      });
    },
    [value, onChange],
  );

  const onChipClick = useCallback(
    async (r: QuickReply) => {
      insertAtCursor(r.body);
      // Best-effort usage bump — never blocks the operator. We log it
      // even on chip click (not only on send) so the admin panel sees
      // chip activity even when the operator edits the body before
      // sending. Edge case worth a +1: false hits if they click then
      // discard, acceptable for analytics granularity.
      api.conversations.markQuickReplyUsed(r.id).catch(() => {});
    },
    [insertAtCursor],
  );

  // Watch the textarea for "#" — open the typeahead.
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    onChange(next);
    const caret = e.target.selectionStart ?? next.length;
    // Find the last "#" before the caret (and require it to be at
    // start of line OR preceded by whitespace, so a hashtag in the
    // middle of a word doesn't trigger).
    let i = caret - 1;
    while (i >= 0 && !/\s/.test(next[i]) && next[i] !== '#') i--;
    if (i >= 0 && next[i] === '#') {
      const q = next.slice(i + 1, caret);
      // Cap how far we let the # query grow — past 40 chars we close
      // the popup automatically (operator probably abandoned it).
      if (q.length <= 40 && !/\s/.test(q)) {
        setHashOpen(true);
        setHashQuery(q);
        setHashAnchor({ start: i, end: caret });
        return;
      }
    }
    if (hashOpen) {
      setHashOpen(false);
      setHashQuery("");
      setHashAnchor(null);
    }
  };

  const closeHash = useCallback(() => {
    setHashOpen(false);
    setHashQuery("");
    setHashAnchor(null);
  }, []);

  const pickHash = useCallback(
    (hit: ListingHit) => {
      if (!hashAnchor) return;
      // Replace the "#query" with the ML article URL (and a trailing
      // space so the operator can keep typing without merging into
      // the URL).
      insertAtCursor(`${hit.permalink} `, hashAnchor);
      closeHash();
    },
    [hashAnchor, insertAtCursor, closeHash],
  );

  // Keyboard nav on the typeahead.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!hashOpen || hashHits.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHashActiveIdx((i) => (i + 1) % hashHits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHashActiveIdx((i) => (i - 1 + hashHits.length) % hashHits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hashHits[hashActiveIdx];
      if (hit) pickHash(hit);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeHash();
    }
  };

  const visibleChips = useMemo(() => replies.slice(0, 24), [replies]);

  return (
    <div className="relative space-y-2">
      {/* CHIPS — librería de respuestas rápidas */}
      {visibleChips.length > 0 && (
        <div
          className="flex flex-wrap gap-1.5"
          data-testid={`ml-draft-chips-${draftId}`}
        >
          {visibleChips.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => void onChipClick(r)}
              disabled={disabled}
              title={r.body}
              data-testid={`ml-draft-chip-${r.label}`}
              className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 hover:border-violet-300 hover:bg-violet-100 disabled:opacity-50"
            >
              <BoltIcon sx={{ fontSize: 11 }} />
              {r.label}
            </button>
          ))}
        </div>
      )}

      {/* TEXTAREA */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
        rows={Math.max(3, Math.min(8, Math.ceil(value.length / 90)))}
        disabled={disabled}
        data-testid={`ml-draft-textarea-${draftId}`}
        className="w-full resize-y rounded-lg border border-slate-200 bg-white p-2 text-sm leading-relaxed text-slate-900 outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-500/15 disabled:opacity-60"
        placeholder='Editá la respuesta. Tocá un chip o tipeá # para insertar el link de otra publicación.'
      />

      {/* # TYPEAHEAD POPUP */}
      {hashOpen && (
        <div
          role="listbox"
          aria-label="Publicaciones — insertar link"
          data-testid={`ml-draft-hash-popup-${draftId}`}
          className="absolute left-0 right-0 z-40 mt-1 max-h-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_8px_24px_-6px_rgb(15_23_42/0.18)]"
        >
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
            <span className="font-medium">
              Publicaciones — <span className="font-mono">#{hashQuery}</span>
            </span>
            <span className="text-[10px] text-slate-400">Enter para insertar · Esc para cerrar</span>
          </div>
          {hashLoading ? (
            <p className="px-3 py-3 text-xs text-slate-500">Buscando…</p>
          ) : hashHits.length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-500">
              Sin coincidencias con publicación de ML para esa búsqueda.
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {hashHits.map((hit, idx) => {
                const cuentaTag = hit.accountKey === 'mercadolibre_cuenta2' ? 'cuenta 2' : 'cuenta 1';
                return (
                  <li
                    key={hit.itemId}
                    role="option"
                    aria-selected={idx === hashActiveIdx}
                    onMouseEnter={() => setHashActiveIdx(idx)}
                    onMouseDown={(e) => { e.preventDefault(); pickHash(hit); }}
                    className={
                      "flex cursor-pointer items-start gap-2 px-3 py-2 " +
                      (idx === hashActiveIdx
                        ? "bg-blue-50 text-blue-900"
                        : "text-slate-700 hover:bg-slate-50")
                    }
                    data-testid={`ml-draft-hash-option-${hit.itemId}`}
                  >
                    {hit.thumbnailUrl ? (
                      <img
                        src={hit.thumbnailUrl}
                        alt=""
                        className="mt-0.5 h-8 w-8 shrink-0 rounded-md object-cover"
                      />
                    ) : (
                      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[9px] font-mono text-slate-500">
                        ML
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{hit.title}</div>
                      <div className="flex items-center gap-1.5 truncate text-[11px] text-slate-500">
                        <span className="inline-flex shrink-0 items-center rounded bg-slate-100 px-1 py-0.5 font-mono text-[9px] font-semibold text-slate-600">
                          {hit.itemId}
                        </span>
                        <span className="inline-flex shrink-0 items-center rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-800">
                          {cuentaTag}
                        </span>
                        <LinkIcon sx={{ fontSize: 11 }} className="shrink-0" />
                        <span className="truncate">{hit.permalink}</span>
                      </div>
                    </div>
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
