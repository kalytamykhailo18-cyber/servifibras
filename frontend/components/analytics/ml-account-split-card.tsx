"use client";

/**
 * Bloque B item 1 — ML cuenta split card.
 *
 * Marcos 2026-06-06: per-store breakdown of MercadoLibre activity so
 * Marcos can see how cuenta 1 vs cuenta 2 are pulling. Reads from
 * /admin/analytics/ml-account-split. Untagged-legacy rows (created
 * before Bloque B shipped) appear as a separate bucket so the
 * migration is visible.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api/endpoints";
import StorefrontIcon from "@mui/icons-material/Storefront";

interface AccountRow {
  mlAccountKey: string | null;
  label: string;
  totalConversations: number;
  activeConversations: number;
  newConversations: number;
  aiReplies: number;
}

const ACCOUNT_TINTS: Record<string, string> = {
  mercadolibre: "from-yellow-100 to-yellow-50 border-yellow-200 text-yellow-900",
  mercadolibre_cuenta2: "from-amber-100 to-amber-50 border-amber-200 text-amber-900",
  __legacy__: "from-slate-100 to-slate-50 border-slate-200 text-slate-700",
};

function tintFor(key: string | null): string {
  if (!key) return ACCOUNT_TINTS.__legacy__;
  return ACCOUNT_TINTS[key] ?? ACCOUNT_TINTS.__legacy__;
}

export function MlAccountSplitCard() {
  const [rows, setRows] = useState<AccountRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api.analytics.getMlAccountSplit();
        if (!cancelled) setRows(data.accounts);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "No se pudo cargar el desglose ML");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
      data-testid="ml-account-split-card"
    >
      <div className="mb-3 flex items-center gap-2">
        <StorefrontIcon sx={{ fontSize: 18 }} className="text-yellow-600" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          MercadoLibre por cuenta
        </h3>
      </div>

      {error && (
        <p className="text-xs text-rose-600">{error}</p>
      )}

      {!rows && !error && (
        <div className="space-y-2">
          <div className="h-12 animate-pulse rounded-xl bg-slate-100/70" />
          <div className="h-12 animate-pulse rounded-xl bg-slate-100/70" />
        </div>
      )}

      {rows && rows.length === 0 && (
        <p className="text-xs text-slate-500">
          Aún no hay actividad de MercadoLibre en la ventana.
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul className="space-y-2" data-testid="ml-account-split-list">
          {rows.map((row) => (
            <li
              key={row.mlAccountKey ?? "legacy"}
              className={`rounded-xl border bg-gradient-to-r p-3 ${tintFor(row.mlAccountKey)}`}
              data-testid={`ml-account-split-row-${row.mlAccountKey ?? "legacy"}`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">{row.label}</p>
                <p className="font-mono text-xs">
                  {row.totalConversations} convs
                </p>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
                <span>
                  <span className="font-semibold">{row.activeConversations}</span> activas
                </span>
                <span>
                  <span className="font-semibold">{row.aiReplies}</span> respuestas IA
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
