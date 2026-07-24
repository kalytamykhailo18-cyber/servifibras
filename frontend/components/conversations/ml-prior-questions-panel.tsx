"use client";

// Marcos 2026-07-24: espejo del "N preguntas anteriores del comprador"
// que muestra la propia interfaz de ML. Se despliega on-demand así
// no cargamos contexto que el operador no siempre pide. Cuando expandís
// llama GET /admin/mercadolibre/qa/prior?contactId=...&itemId=... y
// muestra los pares pregunta+respuesta anteriores del mismo comprador
// sobre la misma publicación.

import { useState, useCallback } from "react";
import { api, type MlPriorQaPair } from "@/lib/api/endpoints";
import { safeFormatDistanceToNow } from "@/lib/date";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PersonOutlineIcon from "@mui/icons-material/PersonOutlineOutlined";

interface Props {
  contactId: string;
  itemId: string;
  excludeMessageId?: string;
  buyerName: string;
}

export function MlPriorQuestionsPanel({ contactId, itemId, excludeMessageId, buyerName }: Props) {
  const [open, setOpen] = useState(false);
  const [pairs, setPairs] = useState<MlPriorQaPair[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (next && pairs === null) {
      setLoading(true);
      setError(null);
      try {
        const data = await api.mercadolibre.priorQaForBuyerOnItem(contactId, itemId, excludeMessageId);
        setPairs(data);
      } catch (err: any) {
        setError(err?.response?.data?.error || err?.message || "No se pudieron cargar las preguntas anteriores");
        setPairs([]);
      } finally {
        setLoading(false);
      }
    }
  }, [open, pairs, contactId, itemId, excludeMessageId]);

  const count = pairs?.length ?? null;

  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/40">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-medium text-slate-700 hover:bg-slate-100 rounded-xl"
        data-testid="ml-prior-toggle"
      >
        {open ? <ExpandMoreIcon sx={{ fontSize: 14 }} /> : <ChevronRightIcon sx={{ fontSize: 14 }} />}
        <PersonOutlineIcon sx={{ fontSize: 12 }} className="text-slate-400" />
        <span>
          Preguntas anteriores de <strong className="text-slate-900">{buyerName}</strong> en esta publicación
          {count !== null && count > 0 && <span className="ml-1 text-slate-500">({count})</span>}
          {count === 0 && <span className="ml-1 italic text-slate-400">(ninguna)</span>}
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-200 px-3 py-2">
          {loading ? (
            <p className="text-[11px] italic text-slate-500">Cargando…</p>
          ) : error ? (
            <p className="text-[11px] text-rose-700">{error}</p>
          ) : !pairs || pairs.length === 0 ? (
            <p className="text-[11px] italic text-slate-500">Es la primera pregunta del comprador en esta publicación.</p>
          ) : (
            <ul className="space-y-2">
              {pairs.map((p, i) => (
                <li key={i} className="rounded-lg border border-slate-200 bg-white p-2 text-[12px]">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">Pregunta · {safeFormatDistanceToNow(p.questionAt)}</p>
                  <p className="mt-0.5 text-slate-800">{p.questionText}</p>
                  {p.replyText ? (
                    <>
                      <p className="mt-2 text-[10px] uppercase tracking-wider text-blue-700">Respuesta · {p.replyAt ? safeFormatDistanceToNow(p.replyAt) : ""}</p>
                      <p className="mt-0.5 whitespace-pre-line text-slate-700">{p.replyText}</p>
                    </>
                  ) : (
                    <p className="mt-1 text-[11px] italic text-slate-400">Sin respuesta registrada</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
