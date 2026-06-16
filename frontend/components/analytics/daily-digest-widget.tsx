"use client";

// ADMIN-only widget that previews today's digest in plain text. Same
// content the cron will deliver via WhatsApp once the recipient phone is
// configured. "Enviar ahora" lets Marcos send it on demand.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api/endpoints";
import { useAuthStore, selectUserRole } from "@/lib/store/auth-store";
import { UserRole } from "@/types";
import EmailIcon from "@mui/icons-material/Email";
import RefreshIcon from "@mui/icons-material/Refresh";
import SendIcon from "@mui/icons-material/Send";

export function DailyDigestWidget() {
  const role = useAuthStore(selectUserRole);
  const [text, setText] = useState<string | null>(null);
  const [delivered, setDelivered] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setBusy(true);
      const r = await api.digest.preview();
      setText(r.text);
      setDelivered(r.delivered);
    } catch {
      // Soft-hide on error; widget is non-critical.
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (role !== UserRole.ADMIN) return;
    void refresh();
  }, [role]);

  const sendNow = async () => {
    setBusy(true);
    try {
      const r = await api.digest.run();
      if (r.delivered) toast.success(`Digest enviado a ${r.recipient}`);
      else             toast.message('Digest no entregado', { description: r.reason ?? 'Sin destinatario configurado' });
      setText(r.text);
      setDelivered(r.delivered);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? err?.message ?? 'Error');
    } finally {
      setBusy(false);
    }
  };

  if (role !== UserRole.ADMIN) return null;
  if (text == null) {
    return (
      <div className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <p className="text-sm text-slate-500">Cargando resumen diario…</p>
      </div>
    );
  }

  return (
    <div className="min-w-0 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-400 text-white">
            <EmailIcon sx={{ fontSize: 18 }} />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">Resumen diario</h3>
            <p className="text-[11px] text-slate-500">
              {delivered ? 'Enviado por WhatsApp' : 'Vista previa — configurá DAILY_DIGEST_RECIPIENT_PHONE para que se envíe solo'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            aria-label="Refrescar"
            className="inline-flex h-8 items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60 sm:px-3"
          >
            <RefreshIcon sx={{ fontSize: 14 }} />
            <span className="hidden sm:inline">Refrescar</span>
          </button>
          <button
            type="button"
            onClick={sendNow}
            disabled={busy}
            aria-label="Enviar ahora"
            className="inline-flex h-8 items-center gap-1 rounded-full bg-gradient-to-r from-emerald-600 to-teal-500 px-2.5 text-xs font-medium text-white shadow-[0_4px_12px_-2px_rgb(16_185_129/0.5)] hover:from-emerald-700 hover:to-teal-600 disabled:opacity-60 sm:px-3"
          >
            <SendIcon sx={{ fontSize: 14 }} />
            <span className="hidden sm:inline">Enviar ahora</span>
          </button>
        </div>
      </div>

      <pre className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50/70 p-3 font-sans text-xs leading-relaxed text-slate-700">
        {text}
      </pre>
    </div>
  );
}
