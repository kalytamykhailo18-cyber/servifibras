"use client";

/**
 * Send-Presupuesto action button for the conversation composer.
 *
 * Sits next to the attach-file / mic / send buttons. Click pops a small
 * picker listing this contact's recent presupuestos; pressing a row
 * dispatches that quote PDF to the customer through the channel pipeline.
 *
 * History: this button used to also offer "Enviar transcripción al
 * cliente" but it duplicated visually with the header's "Exportar PDF"
 * (which downloads the transcript for the operator). Marcos flagged the
 * confusion on 2026-05-14; we kept download in the header, removed the
 * send-transcript option here, and renamed the button so its only
 * purpose — sending a presupuesto — is unambiguous.
 *
 * Quotes are loaded lazily the first time the picker opens to keep the
 * chat-detail mount cheap.
 */

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import ReceiptLongIcon from "@mui/icons-material/ReceiptLong";
import { api, type Quote } from "@/lib/api/endpoints";

interface Props {
  conversationId: string;
  contactId: string | null | undefined;
  disabled?: boolean;
  disabledReason?: string;
  onSent: () => void;
}

function formatMoney(currency: string | null | undefined, amount: number): string {
  const c = (currency ?? "ARS").toUpperCase();
  const symbol = c === "USD" ? "US$ " : "$ ";
  return `${symbol}${amount.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function SendPdfButton({
  conversationId,
  contactId,
  disabled,
  disabledReason,
  onSent,
}: Props) {
  const [open, setOpen] = useState(false);
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(ev: MouseEvent) {
      if (popRef.current && !popRef.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open || quotes !== null || !contactId) return;
    setLoading(true);
    api.quotes
      .list({ contactId })
      .then((rows) => setQuotes(rows.slice(0, 8)))
      .catch(() => setQuotes([]))
      .finally(() => setLoading(false));
  }, [open, quotes, contactId]);

  async function sendQuote(quoteId: string, label: string) {
    setSending(quoteId);
    try {
      await api.conversations.sendQuotePdf(conversationId, quoteId);
      toast.success(`Presupuesto ${label} enviado`);
      setOpen(false);
      onSent();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "No se pudo enviar el presupuesto");
    } finally {
      setSending(null);
    }
  }


  const isDisabled = disabled === true;

  return (
    <div className="relative" ref={popRef}>
      <button
        type="button"
        onClick={() => !isDisabled && setOpen((v) => !v)}
        disabled={isDisabled}
        aria-label="Enviar presupuesto"
        title={isDisabled ? (disabledReason || "Tomá la conversación para responder") : "Enviar un presupuesto al cliente por el canal del chat"}
        data-testid="send-pdf-button"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-60 disabled:hover:border-slate-200 disabled:hover:bg-slate-50 disabled:hover:text-slate-400"
      >
        <ReceiptLongIcon sx={{ fontSize: 18 }} />
      </button>

      {open && (
        <div
          data-testid="send-pdf-popover"
          className="absolute bottom-12 left-0 z-30 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
        >
          <div className="mb-1 px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Enviar presupuesto al cliente
          </div>

          {!contactId ? (
            <div className="px-2 py-2 text-[11px] text-slate-500">
              Sin contacto asociado.
            </div>
          ) : loading ? (
            <div className="px-2 py-2 text-[11px] text-slate-500">Cargando…</div>
          ) : quotes && quotes.length > 0 ? (
            <ul className="max-h-60 overflow-y-auto" data-testid="send-pdf-quote-list">
              {quotes.map((q) => (
                <li key={q.id}>
                  <button
                    type="button"
                    data-testid="send-pdf-quote-row"
                    data-quote-id={q.id}
                    onClick={() => sendQuote(q.id, q.quoteNumber)}
                    disabled={sending !== null}
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-emerald-100 text-emerald-700">
                      <ReceiptLongIcon sx={{ fontSize: 16 }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-slate-800">
                        {q.quoteNumber}
                      </span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {q.buyerName} · {formatMoney(q.currency, q.totalAmount)}
                      </span>
                    </span>
                    {sending === q.id && (
                      <span className="ml-auto mt-1.5 h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-2 py-2 text-[11px] text-slate-500">
              Este contacto todavía no tiene presupuestos.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
