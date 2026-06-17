"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageBubble } from "@/components/conversations/message-bubble";
import { SendMessageForm } from "@/components/conversations/send-message-form";
import { TransferDialog } from "@/components/conversations/transfer-dialog";
import { InternalNoteBubble } from "@/components/conversations/internal-note-bubble";
import { ConversationOrdersPanel } from "@/components/conversations/conversation-orders-panel";
import { ConversationSummaryPanel } from "@/components/conversations/conversation-summary-panel";
import { ConversationScorePanel } from "@/components/conversations/conversation-score-panel";
import { api } from "@/lib/api/endpoints";
import { useAuthStore } from "@/lib/store/auth-store";
import { ContentType, MessageSender, UserRole } from "@/types";
import type { ConversationWithRelations, Message } from "@/types";

const ROLE_TO_SENDER: Record<UserRole, MessageSender> = {
  [UserRole.ADMIN]: MessageSender.ADMIN,
  [UserRole.ATENCION]: MessageSender.BRENDA,
  [UserRole.VENTAS]: MessageSender.FRANCO,
  [UserRole.LOGISTICA]: MessageSender.ALDO,
  // Marcos 2026-06-17: ENCARGADO supervises atención + logística.
  // Falls back to the ADMIN sender label for outbound bubbles
  // because there's no dedicated seed user yet.
  [UserRole.ENCARGADO]: MessageSender.ADMIN,
};
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CancelIcon from '@mui/icons-material/Cancel';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EmailIcon from '@mui/icons-material/Email';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import PanToolIcon from '@mui/icons-material/PanTool';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutlined';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutlined';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import PersonIcon from '@mui/icons-material/Person';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import PhoneIcon from '@mui/icons-material/Phone';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { CHANNEL_LABELS, CONVERSATION_STATUS_LABELS, CONTACT_TYPE_LABELS, ConversationStatus } from "@/types";
import { toast } from "sonner";

export default function ConversationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const conversationId = params.id as string;

  const user = useAuthStore((state) => state.user);

  const [conversation, setConversation] = useState<ConversationWithRelations | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  // Bumped after a successful in-chat order registration so the
  // ConversationOrdersPanel re-fetches its list.
  const [ordersRefreshKey, setOrdersRefreshKey] = useState(0);
  const [internalNotes, setInternalNotes] = useState<Array<{
    id: string; authorId: string; authorName: string; content: string; createdAt: string;
  }>>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ========================================================================
  // FETCH CONVERSATION
  // ========================================================================

  // Initial load — shows the full-page skeleton
  const loadConversation = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const [data, notes] = await Promise.all([
        api.conversations.getById(conversationId),
        api.conversations.listInternalNotes(conversationId).catch(() => []),
      ]);
      setConversation(data);
      setInternalNotes(notes);
    } catch (err: any) {
      setError(err.message || "Error al cargar conversación");
    } finally {
      setIsLoading(false);
    }
  };

  // Silent refresh — keeps the rendered UI in place, just refreshes data
  const refreshConversation = async () => {
    try {
      const [data, notes] = await Promise.all([
        api.conversations.getById(conversationId),
        api.conversations.listInternalNotes(conversationId).catch(() => []),
      ]);
      setConversation(data);
      setInternalNotes(notes);
    } catch (err: any) {
      toast.error(err.message || "Error al recargar conversación");
    }
  };

  useEffect(() => {
    loadConversation();
  }, [conversationId]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [conversation?.messages]);

  // ========================================================================
  // ACTIONS
  // ========================================================================

  const handleTakeover = async () => {
    if (!user) return;

    try {
      setIsUpdating(true);
      await api.conversations.takeover(conversationId);
      toast.success("Conversación tomada correctamente");
      await refreshConversation();
    } catch (err: any) {
      toast.error(err.message || "Error al tomar conversación");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAssign = async (userId: string) => {
    try {
      setIsUpdating(true);
      await api.conversations.assign(conversationId, { userId });
      toast.success("Conversación asignada correctamente");
      await refreshConversation();
    } catch (err: any) {
      toast.error(err.message || "Error al asignar conversación");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleStatusChange = async (status: ConversationStatus) => {
    try {
      setIsUpdating(true);
      await api.conversations.updateStatus(conversationId, { status });
      toast.success("Estado actualizado");
      await refreshConversation();
    } catch (err: any) {
      toast.error(err.message || "Error al actualizar estado");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleExportPdf = async () => {
    try {
      const url = await api.conversations.getPdfBlobUrl(conversationId);
      window.open(url, '_blank');
    } catch (err: any) {
      toast.error(err?.message ?? 'Error al exportar PDF');
    }
  };

  const handleToggleAi = async () => {
    if (!conversation) return;
    const next = !conversation.aiPaused;
    try {
      setIsUpdating(true);
      await api.conversations.setAiState(conversationId, next);
      toast.success(next ? "IA pausada en esta conversación" : "IA reactivada");
      await refreshConversation();
    } catch (err: any) {
      toast.error(err.message || "Error al cambiar estado de la IA");
    } finally {
      setIsUpdating(false);
    }
  };

  // Send a manual reply with optimistic insert + in-place replacement.
  //
  // Why we don't refetch the whole conversation here: the previous
  // implementation called `refreshConversation()` on success, which
  // replaced the entire messages array reference and triggered React
  // to remount every bubble + scroll the container — visible as a
  // full-page "flash" / reload on every send. Marcos called it out as
  // a bad-UX moment.
  //
  // The backend now returns the persisted message (with authorId +
  // author name), so we can just swap the optimistic temp row for the
  // server copy by id, keep React's keys stable, and avoid touching
  // anything else. Conversation-level side-effects (assignedTo,
  // needsHumanAttention=false, status=ACTIVE) we mirror locally — the
  // backend wrote them too, so they're consistent.
  const handleSendMessage = async (content: string) => {
    if (!conversation) return;

    const tempId = `temp-${Date.now()}`;
    const sender = user ? ROLE_TO_SENDER[user.role] ?? MessageSender.ADMIN : MessageSender.ADMIN;
    const optimistic: Message = {
      id: tempId,
      conversationId,
      sender,
      content,
      contentType: ContentType.TEXT,
      isFromAI: false,
      metadata: null,
      timestamp: new Date().toISOString(),
      author: user ? { id: user.id, name: user.name } : null,
    };

    setConversation({
      ...conversation,
      messages: [...(conversation.messages ?? []), optimistic],
    });

    try {
      const saved = (await api.conversations.sendMessage(conversationId, { content })) as Message | undefined;
      setConversation((current) => {
        if (!current) return current;
        const nextMessages = (current.messages ?? []).map((m) => {
          if (m.id !== tempId) return m;
          // Drop in the server copy (real id, authorId, timestamp).
          // If the response shape was unexpected, keep the optimistic
          // row — rather a stale temp than disappearing message.
          return saved && saved.id ? { ...optimistic, ...saved } : m;
        });
        return {
          ...current,
          messages: nextMessages,
          // The backend also flips these as a side-effect of any
          // staff reply. Mirror locally so the right-rail (assignee,
          // status pill, pendiente-humano badge) stays consistent
          // without a refetch.
          assignedTo: user?.id ?? current.assignedTo,
          status: ConversationStatus.ACTIVE,
          needsHumanAttention: false,
        };
      });
    } catch (err: any) {
      // Roll back the optimistic message on failure
      setConversation((current) =>
        current
          ? { ...current, messages: (current.messages ?? []).filter((m) => m.id !== tempId) }
          : current,
      );
      toast.error(err?.message || "Error al enviar mensaje");
      throw err;
    }
  };

  const handleMessageSent = () => {
    // Text-message replies refresh inside handleSendMessage; this callback
    // catches the side-channels that bypass it (file uploads, send-PDF
    // picker, register-order dialog), so the just-saved Message bubble
    // and any newly-linked order appear without the operator having to
    // refresh.
    loadConversation();
    setOrdersRefreshKey((k) => k + 1);
  };

  // ========================================================================
  // RENDER: LOADING STATE
  // ========================================================================

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-24 rounded-full" />
          <Skeleton className="h-10 w-48 rounded-full" />
        </div>
        <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
          <div className="space-y-4 lg:col-span-2">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-[540px] rounded-2xl" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-44 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  // ========================================================================
  // RENDER: ERROR STATE
  // ========================================================================

  if (error || !conversation) {
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => router.push("/conversations")}
          className="group inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900"
        >
          <ArrowBackIcon
            sx={{ fontSize: 16 }}
            className="transition-transform duration-300 group-hover:-translate-x-0.5"
          />
          Volver
        </button>
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200/70 bg-red-50/80 px-4 py-3 text-sm text-red-700">
          <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-red-500" />
          <span>{error || "Conversación no encontrada"}</span>
        </div>
      </div>
    );
  }

  // ========================================================================
  // PER-RECORD SCOPING — ownership gates write affordances
  // ========================================================================
  // Backend list-service scoping already 404s if the conversation isn't
  // visible to the viewer. What this layer covers is the *visible-but-not-
  // owned* case: ATENCION viewing an unassigned conversation, or ADMIN
  // viewing someone else's. ADMIN keeps full access; everyone else needs
  // ownership before status / IA / transfer / composer light up.
  const isAdmin = user?.role === UserRole.ADMIN;
  // Backend returns the assignee on `assignedTo` as `{ id, name } | null`
  // (the relation is overloaded onto that key — the TS type's `assigned`
  // field is never populated at runtime). Treat assignedTo as the truth.
  const assignedUser = (conversation as any).assignedTo as { id: string; name: string } | null;
  const isOwn = !!user && assignedUser?.id === user.id;
  const canAct = isAdmin || isOwn;
  const lockedReason = assignedUser
    ? 'Esta conversación está asignada a otro usuario. Tomala para responder.'
    : 'Tomá la conversación primero para responder.';

  // ========================================================================
  // RENDER: MAIN CONTENT
  // ========================================================================

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* TOP ACTION BAR */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => router.push("/conversations")}
          className="group inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900 active:scale-[0.97]"
        >
          <ArrowBackIcon
            sx={{ fontSize: 16 }}
            className="transition-transform duration-300 group-hover:-translate-x-0.5"
          />
          Volver
        </button>

        <button
          type="button"
          onClick={handleTakeover}
          disabled={isUpdating || isOwn}
          title={isOwn ? 'Ya tenés esta conversación asignada' : 'Asignar esta conversación a vos mismo'}
          data-testid="conv-takeover-btn"
          className="group inline-flex h-10 shrink-0 items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 px-4 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(59_130_246/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(59_130_246/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-[0_8px_20px_-6px_rgb(59_130_246/0.5)] sm:px-5"
        >
          <PanToolIcon sx={{ fontSize: 16 }} />
          <span>Tomar</span>
          <span className="hidden sm:inline">Conversación</span>
        </button>
      </div>

      {/* MAIN CONTENT GRID */}
      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        {/* MESSAGES COLUMN */}
        <div className="space-y-4 lg:col-span-2">
          {/* CONVERSATION HEADER — stacks on mobile, inline on lg+ */}
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] sm:p-5 lg:flex-row lg:items-start lg:justify-between lg:gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {(() => {
                const name = conversation.contact.name;
                const avatarUrl = (conversation.contact as any).avatarUrl as string | null | undefined;
                const initials = (() => {
                  if (!name) return "?";
                  const parts = name.split(" ").filter(Boolean);
                  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
                  return name.substring(0, 2).toUpperCase();
                })();
                const grads = [
                  "from-blue-500 to-cyan-400",
                  "from-emerald-500 to-teal-400",
                  "from-purple-500 to-pink-400",
                  "from-orange-500 to-amber-400",
                  "from-indigo-500 to-violet-400",
                  "from-rose-500 to-pink-400",
                ];
                const gradient = grads[(name ? name.charCodeAt(0) : 0) % grads.length];
                if (avatarUrl) {
                  return (
                    <span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-200 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_4px_10px_-2px_rgb(15_23_42/0.18)]">
                      <img
                        src={avatarUrl}
                        alt={name || "Contacto"}
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </span>
                  );
                }
                return (
                  <span
                    className={`grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br ${gradient} text-sm font-semibold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_4px_10px_-2px_rgb(15_23_42/0.18)]`}
                  >
                    {initials}
                  </span>
                );
              })()}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
                {conversation.contact.name || "Sin nombre"}
              </h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200/70 bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                  {CHANNEL_LABELS[conversation.channel]}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                  {CONVERSATION_STATUS_LABELS[conversation.status]}
                </span>
                {conversation.aiPaused && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800">
                    <PauseCircleOutlineIcon sx={{ fontSize: 12 }} />
                    IA pausada
                  </span>
                )}
              </div>
            </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-nowrap">
              <button
                type="button"
                onClick={handleExportPdf}
                aria-label="Exportar conversación como PDF"
                title="Exportar conversación como PDF"
                className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 active:translate-y-0 active:scale-[0.97] sm:px-4"
              >
                <PictureAsPdfIcon sx={{ fontSize: 16 }} className="text-rose-600" />
                <span className="hidden sm:inline">Exportar PDF</span>
              </button>

              <button
                type="button"
                onClick={handleToggleAi}
                disabled={isUpdating || !canAct}
                data-testid="conv-toggle-ai-btn"
                aria-label={conversation.aiPaused ? 'Reactivar IA' : 'Pausar IA'}
                title={!canAct ? lockedReason : (conversation.aiPaused ? 'Reactivar IA en esta conversación' : 'Pausar IA — solo respuestas humanas')}
                className={
                  conversation.aiPaused
                    ? 'inline-flex h-10 items-center gap-2 rounded-full border border-emerald-300 bg-white px-3 text-sm font-medium text-emerald-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-emerald-50 active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:bg-slate-50 sm:px-4'
                    : 'inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-60 disabled:hover:border-slate-200 disabled:hover:bg-slate-50 disabled:hover:text-slate-400 sm:px-4'
                }
              >
                {conversation.aiPaused ? (
                  <>
                    <PlayCircleOutlineIcon sx={{ fontSize: 16 }} />
                    <span className="hidden sm:inline">Reactivar IA</span>
                  </>
                ) : (
                  <>
                    <PauseCircleOutlineIcon sx={{ fontSize: 16 }} />
                    <span className="hidden sm:inline">Pausar IA</span>
                  </>
                )}
              </button>

              <Select
                value={conversation.status}
                onValueChange={(value) => handleStatusChange(value as ConversationStatus)}
                disabled={isUpdating || !canAct}
              >
                <SelectTrigger
                  data-testid="conv-status-trigger"
                  title={!canAct ? lockedReason : undefined}
                  className="w-[120px] shrink-0 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-60 sm:w-[160px]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">
                    <CheckCircleIcon sx={{ fontSize: 16 }} className="text-green-600" />
                    Activa
                  </SelectItem>
                  <SelectItem value="WAITING">
                    <AccessTimeIcon sx={{ fontSize: 16 }} className="text-amber-600" />
                    Esperando
                  </SelectItem>
                  <SelectItem value="CLOSED">
                    <CancelIcon sx={{ fontSize: 16 }} className="text-rose-600" />
                    Cerrada
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {conversation.aiPaused && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <SmartToyIcon sx={{ fontSize: 18 }} className="mt-0.5 shrink-0" />
              <span>
                IA pausada en esta conversación. Los mensajes del cliente se guardan pero no reciben respuesta automática — un humano debe responder.
              </span>
            </div>
          )}

          {/* MESSAGES — single shell, two regions (scrolling thread + composer).
              Uses dynamic viewport height on mobile so the keyboard pushing up
              doesn't crop the composer below the fold. */}
          <div className="flex h-[calc(100dvh-280px)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] sm:h-auto sm:max-h-[640px] sm:min-h-[500px]">
            <div className="flex-1 overflow-y-auto bg-gradient-to-b from-slate-50/50 to-white p-4 sm:p-6">
              {(conversation.messages && conversation.messages.length > 0) || internalNotes.length > 0 ? (
                <>
                  {[
                    ...(conversation.messages ?? []).map((m) => ({
                      kind: "msg" as const,
                      id: m.id,
                      ts: new Date(m.timestamp).getTime(),
                      data: m,
                    })),
                    ...internalNotes.map((n) => ({
                      kind: "note" as const,
                      id: n.id,
                      ts: new Date(n.createdAt).getTime(),
                      data: n,
                    })),
                  ]
                    .sort((a, b) => a.ts - b.ts)
                    .map((item) =>
                      item.kind === "msg" ? (
                        <MessageBubble key={`msg-${item.id}`} message={item.data} />
                      ) : (
                        <InternalNoteBubble key={`note-${item.id}`} note={item.data} />
                      ),
                    )}
                  <div ref={messagesEndRef} />
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-slate-200 to-slate-100 text-slate-400">
                    <ChatBubbleOutlineIcon sx={{ fontSize: 28 }} />
                  </span>
                  <h3 className="text-base font-semibold text-slate-900">Sin mensajes</h3>
                  <p className="mt-1 text-sm text-slate-500">Iniciá la conversación enviando el primer mensaje.</p>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200/70 bg-white p-4">
              <SendMessageForm
                conversationId={conversationId}
                contactId={conversation.contact?.id ?? conversation.contactId ?? null}
                contactName={conversation.contact?.name ?? null}
                onSendMessage={handleSendMessage}
                onMessageSent={handleMessageSent}
                locked={!canAct}
                lockedReason={lockedReason}
              />
            </div>
          </div>
        </div>

        {/* SIDEBAR COLUMN */}
        <div className="space-y-4">
          {/* AI-GENERATED CONVERSATIONAL SUMMARY — Marcos's #2 ask: the
              operator should see context fast without re-reading the
              full thread. Regenerates on the backend after enough new
              customer messages have arrived. */}
          <ConversationSummaryPanel conversationId={conversationId} />

          {/* LIVE QUALITY SCORE — Marcos's #3 ask: see in real time how
              the conversation is being handled per the agent's criteria,
              so adjustments can happen mid-thread instead of at close. */}
          <ConversationScorePanel conversationId={conversationId} />

          {/* PEDIDOS DE ESTA CONVERSACIÓN — only renders when at least one order is linked */}
          <ConversationOrdersPanel
            conversationId={conversationId}
            refreshKey={ordersRefreshKey}
          />

          {/* CONTACT INFO */}
          <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Información del contacto
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                  <PhoneIcon sx={{ fontSize: 14 }} />
                </span>
                <span className="text-slate-700">
                  {conversation.contact.phone || "Sin teléfono"}
                </span>
              </div>

              {conversation.contact.email && (
                <div className="flex items-center gap-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                    <EmailIcon sx={{ fontSize: 14 }} />
                  </span>
                  <span className="truncate text-slate-700">{conversation.contact.email}</span>
                </div>
              )}

              <div className="flex items-center gap-2.5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600">
                  <LocalOfferIcon sx={{ fontSize: 14 }} />
                </span>
                <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-700">
                  {CONTACT_TYPE_LABELS[conversation.contact.type]}
                </span>
              </div>
            </div>
          </div>

          {/* ASSIGNMENT */}
          <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Asignación
            </h3>

            {assignedUser ? (
              <div className="mb-4 flex items-center gap-2.5 rounded-xl bg-emerald-50 p-2.5" data-testid="conv-assignee-card">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-400 text-xs font-semibold text-white">
                  {assignedUser.name?.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {assignedUser.name}
                  </p>
                  <p className="text-[11px] text-emerald-700">Asignado</p>
                </div>
              </div>
            ) : (
              <div className="mb-4 flex items-center gap-2.5 rounded-xl bg-slate-50 p-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-200 text-slate-400">
                  <PersonAddIcon sx={{ fontSize: 16 }} />
                </span>
                <p className="text-sm text-slate-500">Sin asignar</p>
              </div>
            )}

            <button
              type="button"
              onClick={() => user && handleAssign(user.id)}
              disabled={isUpdating || isOwn}
              data-testid="conv-assign-self-btn"
              title={isOwn ? 'Ya tenés esta conversación asignada' : 'Asignarme esta conversación'}
              className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:border-slate-200 disabled:hover:bg-slate-50"
            >
              <PersonAddIcon sx={{ fontSize: 14 }} />
              Asignarme a mí
            </button>
          </div>

          {/* QUICK ACTIONS */}
          <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Acciones rápidas
            </h3>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setIsTransferOpen(true)}
                disabled={!canAct}
                data-testid="conv-transfer-btn"
                title={!canAct ? lockedReason : 'Transferir conversación a otro usuario'}
                className="group flex h-10 w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-60 disabled:hover:border-slate-200 disabled:hover:bg-slate-50 disabled:hover:text-slate-400"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-100 group-disabled:bg-slate-200 group-disabled:text-slate-400">
                  <SwapHorizIcon sx={{ fontSize: 14 }} />
                </span>
                Transferir conversación
              </button>

              <button
                type="button"
                onClick={() => router.push(`/contacts/${conversation.contactId}`)}
                className="group flex h-10 w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-100">
                  <PersonIcon sx={{ fontSize: 14 }} />
                </span>
                Ver perfil del contacto
              </button>

              <button
                type="button"
                onClick={() => handleStatusChange(ConversationStatus.CLOSED)}
                disabled={isUpdating || conversation.status === "CLOSED" || !canAct}
                data-testid="conv-close-btn"
                title={!canAct ? lockedReason : conversation.status === 'CLOSED' ? 'Conversación ya cerrada' : 'Cerrar conversación'}
                className="group flex h-10 w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-60 disabled:hover:border-slate-200 disabled:hover:bg-slate-50 disabled:hover:text-slate-400"
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-rose-50 text-rose-600 transition-colors group-hover:bg-rose-100 group-disabled:bg-slate-100 group-disabled:text-slate-400">
                  <CancelIcon sx={{ fontSize: 14 }} />
                </span>
                Cerrar conversación
              </button>
            </div>
          </div>
        </div>
      </div>

      <TransferDialog
        open={isTransferOpen}
        onOpenChange={setIsTransferOpen}
        conversationId={conversationId}
        onTransferred={() => {
          // After transfer, navigate back to inbox — current user may have lost access
          router.push("/conversations");
        }}
      />
    </div>
  );
}
