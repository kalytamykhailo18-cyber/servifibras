"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageBubble } from "@/components/conversations/message-bubble";
import { SendMessageForm } from "@/components/conversations/send-message-form";
import { api } from "@/lib/api/endpoints";
import { useAuthStore } from "@/lib/store/auth-store";
import { ContentType, MessageSender, UserRole } from "@/types";
import type { ConversationWithRelations, Message } from "@/types";

const ROLE_TO_SENDER: Record<UserRole, MessageSender> = {
  [UserRole.ADMIN]: MessageSender.ADMIN,
  [UserRole.ATENCION]: MessageSender.BRENDA,
  [UserRole.VENTAS]: MessageSender.FRANCO,
  [UserRole.LOGISTICA]: MessageSender.ALDO,
};
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CancelIcon from '@mui/icons-material/Cancel';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EmailIcon from '@mui/icons-material/Email';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import PanToolIcon from '@mui/icons-material/PanTool';
import PersonIcon from '@mui/icons-material/Person';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import PhoneIcon from '@mui/icons-material/Phone';
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

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ========================================================================
  // FETCH CONVERSATION
  // ========================================================================

  // Initial load — shows the full-page skeleton
  const loadConversation = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await api.conversations.getById(conversationId);
      setConversation(data);
    } catch (err: any) {
      setError(err.message || "Error al cargar conversación");
    } finally {
      setIsLoading(false);
    }
  };

  // Silent refresh — keeps the rendered UI in place, just refreshes data
  const refreshConversation = async () => {
    try {
      const data = await api.conversations.getById(conversationId);
      setConversation(data);
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

  // Append a temporary message immediately, replace with the server copy after refresh
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
    };

    setConversation({
      ...conversation,
      messages: [...(conversation.messages ?? []), optimistic],
    });

    try {
      await api.conversations.sendMessage(conversationId, { content });
      await refreshConversation();
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
    // No-op — handleSendMessage already refreshes once the server confirms.
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
        <div className="grid gap-6 lg:grid-cols-3">
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
          className="group inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900"
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
  // RENDER: MAIN CONTENT
  // ========================================================================

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* TOP ACTION BAR */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.push("/conversations")}
          className="group inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900 active:scale-[0.97]"
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
          disabled={isUpdating}
          className="group inline-flex h-10 items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(59_130_246/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(59_130_246/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-[0_8px_20px_-6px_rgb(59_130_246/0.5)]"
        >
          <PanToolIcon sx={{ fontSize: 16 }} />
          Tomar Conversación
        </button>
      </div>

      {/* MAIN CONTENT GRID */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* MESSAGES COLUMN */}
        <div className="lg:col-span-2 space-y-4">
          {/* CONVERSATION HEADER */}
          <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xl font-bold tracking-tight text-slate-900">
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
              </div>
            </div>

            <Select
              value={conversation.status}
              onValueChange={(value) => handleStatusChange(value as ConversationStatus)}
              disabled={isUpdating}
            >
              <SelectTrigger className="w-[160px] shrink-0">
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
                  <CancelIcon sx={{ fontSize: 16 }} className="text-slate-500" />
                  Cerrada
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* MESSAGES — single shell, two regions (scrolling thread + composer) */}
          <div className="flex max-h-[640px] min-h-[500px] flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <div className="flex-1 overflow-y-auto bg-gradient-to-b from-slate-50/50 to-white p-6">
              {conversation.messages && conversation.messages.length > 0 ? (
                <>
                  {conversation.messages.map((message) => (
                    <MessageBubble key={message.id} message={message} />
                  ))}
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
                onSendMessage={handleSendMessage}
                onMessageSent={handleMessageSent}
              />
            </div>
          </div>
        </div>

        {/* SIDEBAR COLUMN */}
        <div className="space-y-4">
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

            {conversation.assigned ? (
              <div className="mb-4 flex items-center gap-2.5 rounded-xl bg-emerald-50 p-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-400 text-xs font-semibold text-white">
                  {conversation.assigned.name?.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {conversation.assigned.name}
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
              disabled={isUpdating}
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
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
                disabled={isUpdating || conversation.status === "CLOSED"}
                className="group flex h-10 w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-700"
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
    </div>
  );
}
