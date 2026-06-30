"use client";

// Marcos 2026-06-30: panel admin del canal WhatsApp QR (Baileys).
// Muestra status, QR escaneable y controles de disconnect/start.
// Polling cada 3s mientras la conexión NO esté en estado final
// (connected o disabled). Para escanear: WhatsApp en el celu →
// Dispositivos vinculados → Vincular un dispositivo → leer el QR.

import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@/lib/api/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import QrCode2Icon from "@mui/icons-material/QrCode2";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import RefreshIcon from "@mui/icons-material/Refresh";

type Status = {
  enabled: boolean;
  autoReply: boolean;
  accountLabel: string;
  status: "disabled" | "starting" | "waiting_qr" | "connecting" | "connected" | "disconnected" | "errored";
  connectedJid: string | null;
  connectedAt: string | null;
  startedAt: string | null;
  lastError: string | null;
  sessionDirExists: boolean;
};

const STATUS_LABELS: Record<Status["status"], { label: string; color: string }> = {
  disabled:     { label: "Desactivado",                color: "bg-slate-100 text-slate-600 border-slate-200" },
  starting:     { label: "Iniciando socket",           color: "bg-blue-50 text-blue-700 border-blue-200" },
  waiting_qr:   { label: "Esperando escaneo del QR",   color: "bg-amber-50 text-amber-700 border-amber-200" },
  connecting:   { label: "QR escaneado, conectando…",  color: "bg-blue-50 text-blue-700 border-blue-200" },
  connected:    { label: "Conectado",                  color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  disconnected: { label: "Desconectado",               color: "bg-slate-100 text-slate-600 border-slate-200" },
  errored:      { label: "Error",                      color: "bg-rose-50 text-rose-700 border-rose-200" },
};

async function getStatus(): Promise<Status> {
  const r = await apiClient.get<any>("/admin/whatsapp-qr/status");
  return r.data?.data ?? r.data;
}

async function getQr(): Promise<string | null> {
  const r = await apiClient.get<any>("/admin/whatsapp-qr/qr");
  return (r.data?.data ?? r.data)?.qrDataUrl ?? null;
}

async function postStart() {
  const r = await apiClient.post<any>("/admin/whatsapp-qr/start", {});
  return r.data?.data ?? r.data;
}

async function postDisconnect(wipeSession: boolean) {
  const r = await apiClient.post<any>("/admin/whatsapp-qr/disconnect", { wipeSession });
  return r.data?.data ?? r.data;
}

export function WhatsappQrCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, q] = await Promise.all([getStatus(), getQr()]);
      setStatus(s);
      setQr(q);
    } catch (e: any) {
      setError(e?.message || "fetch failed");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Polling: while not in a terminal state poll every 3s so the QR
  // appears as soon as the socket emits it, and "connected" lands
  // within seconds of scanning.
  useEffect(() => {
    if (!status) return;
    const terminal = status.status === "connected" || status.status === "disabled";
    if (terminal) return;
    const t = setInterval(() => { void refresh(); }, 3000);
    return () => clearInterval(t);
  }, [status, refresh]);

  const onStart = async () => {
    setBusy(true); setError(null);
    try { await postStart(); await refresh(); }
    catch (e: any) { setError(e?.message || "start failed"); }
    finally { setBusy(false); }
  };

  const onDisconnect = async (wipe: boolean) => {
    setBusy(true); setError(null);
    try { await postDisconnect(wipe); await refresh(); }
    catch (e: any) { setError(e?.message || "disconnect failed"); }
    finally { setBusy(false); setConfirmDisconnect(false); setConfirmWipe(false); }
  };

  const meta = status ? STATUS_LABELS[status.status] : null;

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 text-white shadow-[0_4px_12px_-2px_rgb(34_197_94/0.45)]">
          <WhatsAppIcon sx={{ fontSize: 22 }} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-900">WhatsApp vía QR</h3>
          <p className="text-xs text-slate-500">
            Canal alternativo (Baileys / WhatsApp Web) — no requiere verificación Meta. Vinculá una cuenta escaneando el QR desde el celular.
          </p>
        </div>
        {meta && (
          <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.color}`}>
            {meta.label}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-xl border border-rose-200/70 bg-rose-50 p-3 text-xs text-rose-700">
          {error}
        </div>
      )}

      {!status && <div className="text-xs text-slate-500">Cargando…</div>}

      {status && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* META row */}
          <div className="space-y-2 text-xs">
            <KeyVal k="Etiqueta" v={status.accountLabel} />
            <KeyVal k="Habilitado (.env)" v={status.enabled ? "sí" : "no"} />
            <KeyVal k="Auto-respuesta" v={status.autoReply ? "sí — el agente responde" : "no — solo recibe"} />
            <KeyVal k="Sesión persistida" v={status.sessionDirExists ? "sí" : "no"} />
            <KeyVal k="Número conectado" v={status.connectedJid ? status.connectedJid.split("@")[0] : "—"} />
            <KeyVal k="Conectado desde" v={status.connectedAt ? new Date(status.connectedAt).toLocaleString() : "—"} />
            {status.lastError && <KeyVal k="Último error" v={status.lastError} mono />}
          </div>

          {/* QR or status block */}
          <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-4">
            {!status.enabled && (
              <div className="text-center text-xs text-slate-600">
                <QrCode2Icon sx={{ fontSize: 40 }} className="mx-auto mb-2 text-slate-400" />
                Activá <span className="font-mono">WHATSAPP_QR_ENABLED=true</span> en .env para iniciar el socket.
              </div>
            )}
            {status.enabled && qr && (status.status === "waiting_qr" || status.status === "starting") && (
              <div className="text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="WhatsApp QR" className="mx-auto h-56 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-sm" />
                <p className="mt-2 text-[11px] text-slate-500">
                  Abrí WhatsApp → Dispositivos vinculados → Vincular dispositivo
                </p>
              </div>
            )}
            {status.enabled && status.status === "connected" && (
              <div className="text-center text-xs text-emerald-700">
                <WhatsAppIcon sx={{ fontSize: 40 }} className="mx-auto mb-2" />
                Conectado como <span className="font-mono">{status.connectedJid?.split("@")[0]}</span>
              </div>
            )}
            {status.enabled && (status.status === "disconnected" || status.status === "errored") && (
              <div className="text-center text-xs text-slate-600">
                <LinkOffIcon sx={{ fontSize: 40 }} className="mx-auto mb-2 text-slate-400" />
                Socket cerrado. Tocá "Reiniciar" para volver a abrir.
              </div>
            )}
            {status.enabled && !qr && (status.status === "starting" || status.status === "connecting") && (
              <div className="text-center text-xs text-slate-500">
                <RefreshIcon sx={{ fontSize: 28 }} className="mx-auto mb-2 animate-spin text-slate-400" />
                {STATUS_LABELS[status.status].label}…
              </div>
            )}
          </div>
        </div>
      )}

      {status && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onStart}
            disabled={busy || !status.enabled || status.status === "connected" || status.status === "waiting_qr"}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshIcon sx={{ fontSize: 14 }} />
            Reiniciar
          </button>
          <button
            type="button"
            onClick={() => setConfirmDisconnect(true)}
            disabled={busy || status.status !== "connected"}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LinkOffIcon sx={{ fontSize: 14 }} />
            Desconectar
          </button>
          <button
            type="button"
            onClick={() => setConfirmWipe(true)}
            disabled={busy || !status.sessionDirExists}
            className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:border-rose-300 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Borrar sesión y vincular otro número
          </button>
        </div>
      )}

      <AlertDialog open={confirmDisconnect} onOpenChange={(o) => { if (!o) setConfirmDisconnect(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar WhatsApp QR</AlertDialogTitle>
            <AlertDialogDescription>
              El socket se cierra. La sesión guardada queda intacta — el próximo Reiniciar reconecta el mismo número sin re-escanear.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => onDisconnect(false)}>Desconectar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmWipe} onOpenChange={(o) => { if (!o) setConfirmWipe(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Borrar sesión vinculada</AlertDialogTitle>
            <AlertDialogDescription>
              Esto elimina las credenciales del disco. Al próximo Reiniciar vas a tener que escanear un QR nuevo para vincular otra cuenta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onDisconnect(true)}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              Borrar y reiniciar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KeyVal({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 pb-1.5">
      <span className="text-[11px] uppercase tracking-wider text-slate-500">{k}</span>
      <span className={`max-w-[220px] truncate text-right text-xs text-slate-800 ${mono ? "font-mono" : ""}`} title={v}>{v}</span>
    </div>
  );
}
