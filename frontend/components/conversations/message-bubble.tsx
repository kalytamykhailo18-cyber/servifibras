"use client";

import { useState } from "react";
import { safeFormatDate } from "@/lib/date";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import PersonIcon from "@mui/icons-material/Person";
import EditNoteIcon from "@mui/icons-material/EditNote";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import { toast } from "sonner";
import type { Message, MessageSender } from "@/types";
import { UserRole } from "@/types";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api/endpoints";
import { useAuthStore, selectUserRole } from "@/lib/store/auth-store";
import { AttachmentView } from "./attachment-view";

interface MessageBubbleProps {
  message: Message;
}

const SENDER_LABELS: Record<MessageSender, string> = {
  CUSTOMER: "Cliente",
  AI: "IA",
  BRENDA: "Brenda",
  FRANCO: "Franco",
  ALDO: "Aldo",
  ADMIN: "Admin",
};

const AGENT_AVATAR_GRADIENTS: Record<string, string> = {
  BRENDA: "from-pink-500 to-rose-400",
  FRANCO: "from-emerald-500 to-teal-400",
  ALDO: "from-orange-500 to-amber-400",
  ADMIN: "from-slate-700 to-slate-500",
};

export function MessageBubble({ message }: MessageBubbleProps) {
  const isCustomer = message.sender === "CUSTOMER";
  const isAI = message.sender === "AI" || message.isFromAI;

  // Per-turn correction — Marcos 2026-06-06: he needs to be able to
  // correct ANY AI turn in a multi-turn conversation, not just the last
  // one. Affordance is ADMIN-only and only renders on AI-side bubbles
  // (CUSTOMER turns can't be corrected; manual operator messages are
  // human-authored, not pattern-promoted to few-shot).
  const role = useAuthStore(selectUserRole);
  const canCorrect = role === UserRole.ADMIN && isAI && !!message.id && !!message.content;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(message.content ?? "");
  const [saving, setSaving] = useState(false);
  const [appliedAt, setAppliedAt] = useState<number | null>(null);

  const openEditor = () => {
    setDraft(message.content ?? "");
    setEditing(true);
  };
  const cancelEditor = () => {
    setEditing(false);
    setDraft(message.content ?? "");
  };
  const saveCorrection = async () => {
    const text = draft.trim();
    if (text.length === 0) {
      toast.error("La corrección no puede estar vacía");
      return;
    }
    setSaving(true);
    try {
      const r = await api.quality.applyMessageCorrection(message.id, text);
      if (r.success) {
        toast.success("Corrección guardada como ejemplo");
        setAppliedAt(Date.now());
        setEditing(false);
      } else {
        toast.error(`No se pudo guardar — ${r.reason ?? "error desconocido"}`);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Error al guardar la corrección");
    } finally {
      setSaving(false);
    }
  };

  const avatarGradient = isCustomer
    ? "from-blue-500 to-cyan-400"
    : isAI
    ? "from-violet-500 to-purple-500"
    : AGENT_AVATAR_GRADIENTS[message.sender] ?? "from-slate-600 to-slate-400";

  const bubbleClass = isCustomer
    ? "rounded-tl-md bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-[0_4px_12px_-2px_rgb(59_130_246/0.35)]"
    : isAI
    ? "rounded-tr-md border border-violet-200/70 bg-violet-50 text-violet-950"
    : "rounded-tr-md border border-slate-200/70 bg-white text-slate-900 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]";

  return (
    <div
      className={cn(
        "mb-4 flex gap-2.5",
        isCustomer ? "flex-row" : "flex-row-reverse",
      )}
    >
      {/* Avatar — gradient tile */}
      <span
        className={cn(
          "mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_4px_10px_-2px_rgb(15_23_42/0.18)]",
          avatarGradient,
        )}
      >
        {isCustomer ? (
          <PersonIcon sx={{ fontSize: 16 }} />
        ) : isAI ? (
          <SmartToyIcon sx={{ fontSize: 16 }} />
        ) : (
          <span className="text-[11px] font-semibold">
            {(message.author?.name ?? message.sender).charAt(0).toUpperCase()}
          </span>
        )}
      </span>

      {/* Message stack */}
      <div
        className={cn(
          "flex max-w-[75%] flex-col",
          isCustomer ? "items-start" : "items-end",
        )}
      >
        {/* Sender label + time.
            Prefer the actual user's name (Marcos, Brenda García, etc.)
            when the backend has attribution on the message; fall back
            to the role label so older rows without authorId still
            render. CUSTOMER + AI messages never carry an author and
            always use the role label. */}
        <div className="mb-1 flex items-center gap-2 px-1 text-[11px] text-slate-500">
          <span className="font-medium">
            {message.author?.name ?? (SENDER_LABELS[message.sender] ?? message.sender)}
          </span>
          {isAI && message.sender !== "AI" && (
            <span className="inline-flex items-center rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-violet-700">
              IA
            </span>
          )}
          <span className="text-slate-400">·</span>
          <time
            dateTime={String(message.timestamp)}
            title={safeFormatDate(message.timestamp, "dd/MM/yyyy HH:mm")}
          >
            {safeFormatDate(message.timestamp, "HH:mm")}
          </time>
        </div>

        {/* Bubble */}
        <div className={cn("rounded-2xl px-4 py-2.5", bubbleClass)}>
          {message.attachmentUrl && message.attachmentMime && (
            <div className={message.content ? "mb-2" : ""}>
              <AttachmentView
                url={message.attachmentUrl}
                name={message.attachmentName ?? "archivo"}
                mime={message.attachmentMime}
                size={message.attachmentSize ?? null}
                variant={isCustomer ? "light" : "dark"}
              />
            </div>
          )}
          {message.content && (
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
              {message.content}
            </p>
          )}
        </div>

        {/* Per-turn correction — ADMIN-only affordance under any AI
            bubble. Opens an inline editor seeded with the original
            reply text; saving promotes the corrected pair as a few-shot
            example keyed by this messageId, so it lands as its own row
            and the agent pattern-matches the fix against this exact
            customer turn next time. */}
        {canCorrect && !editing && (
          <div className="mt-1 flex items-center gap-2 px-1">
            {appliedAt != null ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-emerald-100/80 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
                data-testid="message-correction-applied-badge"
              >
                <CheckCircleOutlineIcon sx={{ fontSize: 11 }} />
                Corrección guardada
              </span>
            ) : (
              <button
                type="button"
                onClick={openEditor}
                data-testid="message-correct-btn"
                data-message-id={message.id}
                className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50/70 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 transition-colors duration-150 hover:border-amber-300 hover:bg-amber-100"
                title="Corregir esta respuesta y guardarla como ejemplo"
              >
                <EditNoteIcon sx={{ fontSize: 12 }} />
                Corregir
              </button>
            )}
          </div>
        )}
        {canCorrect && editing && (
          <div
            className="mt-2 w-full max-w-[480px] space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-3"
            data-testid="message-correct-editor"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">
              Reescribí la respuesta como debería haber salido
            </p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              disabled={saving}
              className="w-full resize-y rounded-lg border border-amber-200 bg-white p-2 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:opacity-60"
              placeholder="La respuesta corregida que el agente debería haber dado…"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancelEditor}
                disabled={saving}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
              >
                <CloseIcon sx={{ fontSize: 14 }} />
                Cancelar
              </button>
              <button
                type="button"
                onClick={saveCorrection}
                disabled={saving || draft.trim().length === 0}
                data-testid="message-correct-save-btn"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.18)] hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-amber-300"
              >
                {saving ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <CheckCircleOutlineIcon sx={{ fontSize: 14 }} />
                )}
                Guardar como ejemplo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
