"use client";

import { useCallback, useEffect, useState } from "react";
import { useRealtimeEvent } from "@/lib/realtime/use-realtime";
import { api } from "@/lib/api/endpoints";
import { safeFormatDistanceToNow } from "@/lib/date";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import RefreshIcon from "@mui/icons-material/Refresh";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import PendingActionsIcon from "@mui/icons-material/PendingActions";

interface SummaryPayload {
  summary: string;
  products: string[];
  status: string;
  keyFacts: string[];
  updatedAt: string;
  messageCount: number;
}

interface ConversationSummaryPanelProps {
  conversationId: string;
}

// AI-generated context panel for the operator. Reads the cached summary
// stored on the conversation; the backend regenerates it after enough
// new customer messages have arrived (see CONVERSATION_SUMMARY_* env
// vars). Marcos #2 from the 4-improvements thread.
export function ConversationSummaryPanel({ conversationId }: ConversationSummaryPanelProps) {
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.conversations.getSummary(conversationId);
      setSummary(data);
    } catch {
      // network blip — keep the previous summary visible
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [conversationId]);

  useEffect(() => {
    setLoading(true);
    setSummary(null);
    load();
  }, [conversationId, load]);

  // Live refresh — backend broadcasts whenever it regenerates. We filter
  // by conversationId since the event is sent to every connected client.
  useRealtimeEvent<{ conversationId: string }>(
    "conversation:summary:updated",
    (payload) => {
      if (payload?.conversationId === conversationId) {
        setRefreshing(true);
        load();
      }
    },
  );

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      // Force a backend regenerate, then refetch. The socket event will
      // also fire when the regen completes — fine to handle both, the
      // second call is idempotent.
      await api.conversations.regenerateSummary(conversationId);
    } catch {
      // If the regenerate POST fails (rare), still try to refetch so
      // the user sees whatever cached summary is there.
    }
    // Brief delay so Claude has a chance to land before we refetch.
    setTimeout(() => {
      load();
    }, 1500);
  };

  return (
    <div className="rounded-2xl border border-violet-200/70 bg-gradient-to-br from-violet-50/40 to-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_4px_10px_-2px_rgb(139_92_246/0.4)]">
            <AutoAwesomeIcon sx={{ fontSize: 14 }} />
          </span>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Resumen del agente
          </h3>
        </div>
        <button
          type="button"
          onClick={handleManualRefresh}
          disabled={refreshing}
          aria-label="Refrescar resumen"
          title="Refrescar resumen"
          className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-violet-600 disabled:opacity-60"
        >
          <RefreshIcon sx={{ fontSize: 14 }} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {loading ? (
        <div className="space-y-2.5">
          <div className="h-3 w-3/4 animate-pulse rounded bg-slate-200" />
          <div className="h-3 w-full animate-pulse rounded bg-slate-200" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-slate-200" />
        </div>
      ) : !summary ? (
        <p className="text-xs leading-relaxed text-slate-500">
          Sin resumen todavía — el agente lo arma cuando entran suficientes mensajes del cliente.
        </p>
      ) : (
        <div className="space-y-4">
          {/* Summary text */}
          {summary.summary && (
            <p className="text-sm leading-relaxed text-slate-700">{summary.summary}</p>
          )}

          {/* Status pill */}
          {summary.status && (
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-600">
                <PendingActionsIcon sx={{ fontSize: 14 }} />
              </span>
              <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">
                {summary.status}
              </span>
            </div>
          )}

          {/* Products mentioned */}
          {summary.products.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <Inventory2OutlinedIcon sx={{ fontSize: 12 }} className="text-blue-600" />
                Productos
              </div>
              <div className="flex flex-wrap gap-1.5">
                {summary.products.map((p, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center rounded-full border border-blue-200/70 bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-700"
                  >
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Key facts */}
          {summary.keyFacts.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <FactCheckOutlinedIcon sx={{ fontSize: 12 }} className="text-emerald-600" />
                Datos clave
              </div>
              <ul className="space-y-1.5 text-sm text-slate-700">
                {summary.keyFacts.map((f, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
                    <span className="leading-relaxed">{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Footer — updated-ago */}
          <p className="border-t border-slate-200/60 pt-3 text-[10px] text-slate-400">
            Actualizado {safeFormatDistanceToNow(summary.updatedAt)} · {summary.messageCount} mensajes
          </p>
        </div>
      )}
    </div>
  );
}
