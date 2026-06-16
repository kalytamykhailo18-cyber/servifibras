"use client";

// "Probar como cliente" sandbox — lets an operator chat with the agent
// from the customer side, end-to-end, without touching the real inbox.
// Each browser tab gets its own sandbox session (sessionId in
// localStorage); the backend persists messages but flags the contact
// and conversation as isSandbox so they're filtered from analytics and
// the operator inbox.
//
// Used by Marcos to validate prompt changes / new knowledge before they
// hit a real customer, and by us to demo the agent's behavior live in a
// pitch without needing an external channel.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
import { api, type SandboxMessage, type SandboxChannel } from "@/lib/api/endpoints";
import { safeFormatDate } from "@/lib/date";
import { cn } from "@/lib/utils";
import { useAuthStore, selectUser } from "@/lib/store/auth-store";
import { UserRole } from "@/types";
import ScienceIcon from "@mui/icons-material/Science";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import PersonIcon from "@mui/icons-material/Person";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import SendIcon from "@mui/icons-material/Send";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import StorefrontIcon from "@mui/icons-material/Storefront";
import InstagramIcon from "@mui/icons-material/Instagram";

// Each channel gets its own sessionId entry in localStorage so switching
// channels doesn't blow away the other channel's open thread. Stored
// under a key per channel so a reload reopens whatever was active.
const SESSION_KEY = "servifibras.sandbox.sessionId";          // webchat (legacy key, kept for backward compat)
const SESSION_KEY_ML = "servifibras.sandbox.sessionId.ml";    // mercadolibre
const SESSION_KEY_IG = "servifibras.sandbox.sessionId.ig";    // instagram (dev-mode preview)
const CHANNEL_KEY = "servifibras.sandbox.channel";

// Channel-specific UI metadata. Marcos's brief 2026-05-14: the ML side
// is "distinto" — questions land before a purchase, the customer can't
// see internal panels, and the tone the operator wants to test is the
// pre-sale Q&A style ("hacés envíos?", "tenés stock?", "podés bajar el
// precio?"). The empty-state hint reflects that.
type ChannelMeta = {
  label: string;
  Icon: typeof ChatBubbleOutlineIcon;
  identityPrefix: string;
  emptyStateHint: string;
  storageKey: string;
};
const CHANNELS: Record<SandboxChannel, ChannelMeta> = {
  WEBCHAT: {
    label: "Webchat",
    Icon: ChatBubbleOutlineIcon,
    identityPrefix: "Sandbox",
    emptyStateHint:
      "Pregunta como si fueras un cliente en el chat de la web — precios, productos, demoras. El agente responde con catálogo y dólar blue reales.",
    storageKey: SESSION_KEY,
  },
  MERCADOLIBRE: {
    label: "MercadoLibre",
    Icon: StorefrontIcon,
    identityPrefix: "Sandbox ML",
    emptyStateHint:
      "Simulá una pregunta típica de MercadoLibre: 'tenés stock?', 'hacés envíos?', 'podés bajar el precio?'. Sin links internos — sólo lo que verías en una pregunta de publicación.",
    storageKey: SESSION_KEY_ML,
  },
  INSTAGRAM: {
    label: "Instagram",
    Icon: InstagramIcon,
    identityPrefix: "Sandbox IG",
    // Marcos's 2026-05-27 ask was "podemos enlazar instagram y activarlo?
    // o depende de la verificación?". Technical answer: yes — Meta keeps
    // the IG app in DEVELOPMENT mode until verification clears. Public
    // DMs from customers don't reach the agent yet; only DMs from
    // accounts listed as admin/tester on the Meta app do. This sandbox
    // exercises the exact same pipeline an inbound IG DM would take, so
    // Marcos can validate intent + responses while the verification is
    // pending.
    emptyStateHint:
      "Modo desarrollo de Meta: hasta que la verificación se apruebe, los DMs reales del público no llegan al agente. Acá podés probar el flujo end-to-end como si fuera una conversación de Instagram.",
    storageKey: SESSION_KEY_IG,
  },
};

function freshSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `sb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadOrCreateSessionId(channel: SandboxChannel): string {
  if (typeof window === "undefined") return "ssr";
  const key = CHANNELS[channel].storageKey;
  const existing = window.localStorage.getItem(key);
  if (existing && existing.length > 0) return existing;
  const next = freshSessionId();
  window.localStorage.setItem(key, next);
  return next;
}

function loadOrDefaultChannel(): SandboxChannel {
  if (typeof window === "undefined") return "WEBCHAT";
  const v = window.localStorage.getItem(CHANNEL_KEY);
  if (v === "MERCADOLIBRE") return "MERCADOLIBRE";
  if (v === "INSTAGRAM") return "INSTAGRAM";
  return "WEBCHAT";
}

export default function SandboxPage() {
  const user = useAuthStore(selectUser);
  // Sandbox is visible to every authenticated role — Brenda might want
  // to test how the agent handles a tricky customer line before her
  // shift, not just admins. Backend gate is identical.
  const isAllowed = !!user;

  const [channel, setChannel] = useState<SandboxChannel>("WEBCHAT");
  const [sessionId, setSessionId] = useState<string>("");
  const [messages, setMessages] = useState<SandboxMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  // Optional ML listing id (e.g. MLA1234567890). When set, the backend
  // fetches the actual ML publication and injects it as a per-turn
  // context block so the agent's reply is anchored to that listing
  // instead of guessing from the catalog. Persisted per-channel so
  // switching back to ML remembers the last test target.
  const [mlItemId, setMlItemId] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const c = loadOrDefaultChannel();
    setChannel(c);
    setSessionId(loadOrCreateSessionId(c));
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem("servifibras.sandbox.mlItemId");
      if (saved) setMlItemId(saved);
    }
  }, []);

  const loadHistory = useCallback(async (sid: string, c: SandboxChannel) => {
    if (!sid) return;
    try {
      setLoadingHistory(true);
      const res = await api.sandbox.history(sid, c);
      setMessages(res.messages ?? []);
    } catch (err: any) {
      toast.error(err?.message || "No se pudo cargar el historial");
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (sessionId) {
      void loadHistory(sessionId, channel);
    }
  }, [sessionId, channel, loadHistory]);

  const switchChannel = useCallback(
    (next: SandboxChannel) => {
      if (next === channel) return;
      window.localStorage.setItem(CHANNEL_KEY, next);
      setChannel(next);
      // Pull the per-channel sessionId (create if missing) so the
      // thread the operator left open stays open after the switch.
      setSessionId(loadOrCreateSessionId(next));
      setMessages([]);
      setDraft("");
    },
    [channel],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Pin to bottom on every message append so new replies stay visible
    // without the operator having to scroll.
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !sessionId) return;
    setSending(true);
    const tempId = `tmp-${Date.now()}`;
    const optimistic: SandboxMessage = {
      id: tempId,
      sender: "CUSTOMER",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    try {
      const res = await api.sandbox.send(sessionId, text, channel, {
        mlItemId: channel === "MERCADOLIBRE" ? mlItemId.trim() : undefined,
      });
      // Server returns the last 2 messages (customer + agent reply when
      // the agent answered). Replace our optimistic temp + append agent.
      setMessages((prev) => {
        const without = prev.filter((m) => m.id !== tempId);
        return [...without, ...(res.recent ?? [])];
      });
      if (!res.agentReplied) {
        if (res.agentErrorReason) {
          // Upstream AI failure (billing, rate limit, etc.) — surface the
          // operator-friendly reason instead of the generic "derivado".
          toast.error(res.agentErrorReason);
        } else {
          toast.info(
            "El agente no respondió. El mensaje fue derivado al equipo humano por reglas internas (mayorista / queja / IA pausada).",
          );
        }
      }
    } catch (err: any) {
      // Roll back the optimistic so the user sees their message didn't
      // actually go through.
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setDraft(text);
      toast.error(err?.message || "No se pudo enviar el mensaje");
    } finally {
      setSending(false);
      // Focus the input so the operator can keep typing.
      inputRef.current?.focus();
    }
  }, [draft, sending, sessionId, channel, mlItemId]);

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleReset = useCallback(async () => {
    if (!sessionId) return;
    setResetting(true);
    try {
      await api.sandbox.reset(sessionId, channel);
      // Issue a brand-new session for THIS channel so the next message
      // starts a clean thread — preserves the old conversation in the
      // DB (for audit) but the UI doesn't load it again.
      const next = freshSessionId();
      window.localStorage.setItem(CHANNELS[channel].storageKey, next);
      setSessionId(next);
      setMessages([]);
      setResetOpen(false);
      toast.success("Conversación reiniciada");
    } catch (err: any) {
      toast.error(err?.message || "No se pudo reiniciar la conversación");
    } finally {
      setResetting(false);
    }
  }, [sessionId, channel]);

  const operatorName = useMemo(() => user?.name ?? user?.email ?? "operador", [user]);
  const channelMeta = CHANNELS[channel];

  if (!isAllowed) {
    return (
      <div className="p-8">
        <p className="text-sm text-slate-500">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-50">
      {/* Page header */}
      <div className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-100 text-violet-700">
              <ScienceIcon sx={{ fontSize: 22 }} />
            </span>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Probar como cliente</h1>
              <p className="text-[12px] text-slate-500">
                Tipeás como si fueras cliente en el canal elegido, ves al agente responder.
                Esta conversación no aparece en el inbox real.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setResetOpen(true)}
            disabled={sending || messages.length === 0}
            className="grid h-9 grid-flow-col items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-60"
            title="Cierra la conversación actual y empieza una nueva"
            data-testid="sandbox-reset-btn"
          >
            <RestartAltIcon sx={{ fontSize: 16 }} />
            Reiniciar conversación
          </button>
        </div>

        {/* Channel selector — one pill per supported channel. Switching
            pulls the per-channel sessionId so the other channels'
            threads aren't dropped. */}
        <div className="mt-3 flex w-full max-w-md items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
          {(Object.keys(CHANNELS) as SandboxChannel[]).map((c) => {
            const m = CHANNELS[c];
            const active = c === channel;
            return (
              <button
                key={c}
                type="button"
                onClick={() => switchChannel(c)}
                disabled={sending}
                data-testid={`sandbox-channel-${c.toLowerCase()}`}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors",
                  active
                    ? "bg-white text-violet-700 shadow-[0_2px_8px_-2px_rgb(15_23_42/0.1)]"
                    : "text-slate-500 hover:text-slate-700",
                  sending && "cursor-not-allowed opacity-60",
                )}
              >
                <m.Icon sx={{ fontSize: 14 }} />
                {m.label}
              </button>
            );
          })}
        </div>

        {/* ML-only: publication id field. When set, the backend fetches
            the real listing on every inbound and the agent answers in
            its context. Empty = synthetic sandbox fallback (no listing
            fetch, generic catalog matching). */}
        {channel === "MERCADOLIBRE" && (
          <div className="mt-3 flex w-full max-w-md items-center gap-2">
            <label
              htmlFor="sandbox-ml-item"
              className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-500"
            >
              Publicación de prueba (opcional)
            </label>
            <input
              id="sandbox-ml-item"
              data-testid="sandbox-ml-item"
              type="text"
              value={mlItemId}
              onChange={(e) => {
                const v = e.target.value;
                setMlItemId(v);
                if (typeof window !== "undefined") {
                  if (v.trim().length > 0) window.localStorage.setItem("servifibras.sandbox.mlItemId", v);
                  else window.localStorage.removeItem("servifibras.sandbox.mlItemId");
                }
              }}
              placeholder="MLA1234567890 o sandbox-sku-REA300"
              disabled={sending}
              className="h-8 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[12px] text-slate-900 placeholder:text-slate-400 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
        )}
      </div>

      {/* Conversation surface */}
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden px-4 pt-4">
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          data-testid="sandbox-messages"
        >
          {loadingHistory ? (
            <p className="text-center text-[12px] text-slate-400">Cargando…</p>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-50 text-violet-500">
                <ScienceIcon sx={{ fontSize: 26 }} />
              </span>
              <p className="text-sm font-medium text-slate-700">
                Empezá una conversación
              </p>
              <p className="max-w-sm text-[12px] text-slate-500">
                {channelMeta.emptyStateHint}
              </p>
              <p className="text-[11px] text-slate-400">
                Identidad sandbox:{" "}
                <span className="font-medium text-slate-500">
                  {`${channelMeta.identityPrefix} · ${operatorName}`}
                </span>
              </p>
            </div>
          ) : (
            messages.map((m) => <SandboxBubble key={m.id} message={m} />)
          )}
          {sending && (
            <div className="mt-2 flex items-center gap-2 pl-10 text-[12px] text-slate-400" data-testid="sandbox-typing">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-purple-500 text-white">
                <SmartToyIcon sx={{ fontSize: 14 }} />
              </span>
              El agente está respondiendo…
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="mt-3 mb-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKey}
              placeholder={
                channel === "MERCADOLIBRE"
                  ? "Escribí una pregunta tipo MercadoLibre… (Enter para enviar)"
                  : "Escribí como si fueras cliente… (Enter para enviar, Shift+Enter para nueva línea)"
              }
              rows={2}
              maxLength={4000}
              className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-100"
              data-testid="sandbox-input"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || draft.trim().length === 0}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-600 text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              title="Enviar (Enter)"
              data-testid="sandbox-send-btn"
            >
              {sending ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <SendIcon sx={{ fontSize: 18 }} />
              )}
            </button>
          </div>
        </div>
      </div>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reiniciar conversación sandbox</AlertDialogTitle>
            <AlertDialogDescription>
              La conversación actual se cierra y arrancás una nueva. El historial queda guardado en el sistema (no se borra) pero no lo vas a ver más en esta pantalla.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset} disabled={resetting} data-testid="sandbox-reset-confirm">
              {resetting ? "Reiniciando…" : "Reiniciar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SandboxBubble({ message }: { message: SandboxMessage }) {
  // In the sandbox the operator IS the customer, so the "customer" side
  // belongs to the right (the user's own messages), and the agent's
  // side belongs to the left — mirroring messaging-app conventions
  // ("me" on the right).
  const isCustomer = message.sender === "CUSTOMER";
  const isAI = message.sender === "AI";

  const bubbleClass = isCustomer
    ? "rounded-tr-md bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-[0_4px_12px_-2px_rgb(59_130_246/0.35)]"
    : isAI
    ? "rounded-tl-md border border-violet-200/70 bg-violet-50 text-violet-950"
    : "rounded-tl-md border border-slate-200/70 bg-white text-slate-900";

  const avatarGradient = isCustomer
    ? "from-blue-500 to-cyan-400"
    : isAI
    ? "from-violet-500 to-purple-500"
    : "from-slate-600 to-slate-400";

  const senderLabel = isCustomer ? "Cliente (vos)" : isAI ? "Agente" : message.sender;

  return (
    <div
      data-testid={isCustomer ? "sandbox-customer-bubble" : isAI ? "sandbox-agent-bubble" : "sandbox-staff-bubble"}
      className={cn("mb-3 flex gap-2.5", isCustomer ? "flex-row-reverse" : "flex-row")}
    >
      <span
        className={cn(
          "mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br text-white shadow-sm",
          avatarGradient,
        )}
      >
        {isCustomer ? (
          <PersonIcon sx={{ fontSize: 16 }} />
        ) : isAI ? (
          <SmartToyIcon sx={{ fontSize: 16 }} />
        ) : (
          <span className="text-[11px] font-semibold">{message.sender.charAt(0)}</span>
        )}
      </span>

      <div className={cn("flex max-w-[80%] flex-col", isCustomer ? "items-end" : "items-start")}>
        <div className="mb-1 flex items-center gap-2 px-1 text-[10px] uppercase tracking-wider text-slate-400">
          <span className="font-semibold">{senderLabel}</span>
          <span>·</span>
          <span>{safeFormatDate(message.timestamp, "p")}</span>
        </div>
        <div className={cn("whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed", bubbleClass)}>
          {message.content}
        </div>
      </div>
    </div>
  );
}
