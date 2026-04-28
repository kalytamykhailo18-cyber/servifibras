"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageBubble } from "@/components/conversations/message-bubble";
import { SendMessageForm } from "@/components/conversations/send-message-form";
import { api } from "@/lib/api/endpoints";
import { useAuthStore } from "@/lib/store/auth-store";
import type { ConversationWithRelations } from "@/types";
import {
  ArrowLeft,
  UserPlus,
  Hand,
  CheckCircle,
  XCircle,
  Clock,
  Phone,
  Mail,
  Tag,
  MessageSquare,
} from "lucide-react";
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

  const fetchConversation = async () => {
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

  useEffect(() => {
    fetchConversation();
  }, [conversationId]);

  // Auto-scroll to bottom when messages load
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
      fetchConversation();
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
      fetchConversation();
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
      fetchConversation();
    } catch (err: any) {
      toast.error(err.message || "Error al actualizar estado");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSendMessage = async (content: string) => {
    await api.conversations.sendMessage(conversationId, { content });
    toast.success("Mensaje enviado");
  };

  const handleMessageSent = () => {
    fetchConversation();
  };

  // ========================================================================
  // RENDER: LOADING STATE
  // ========================================================================

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-full" />
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <Skeleton className="h-[600px]" />
          </div>
          <div>
            <Skeleton className="h-[400px]" />
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
        <Button variant="ghost" onClick={() => router.push("/dashboard/conversations")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error || "Conversación no encontrada"}</AlertDescription>
        </Alert>
      </div>
    );
  }

  // ========================================================================
  // RENDER: MAIN CONTENT
  // ========================================================================

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => router.push("/dashboard/conversations")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver
        </Button>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTakeover}
            disabled={isUpdating}
          >
            <Hand className="h-4 w-4 mr-2" />
            Tomar Conversación
          </Button>
        </div>
      </div>

      {/* MAIN CONTENT GRID */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* MESSAGES COLUMN */}
        <div className="lg:col-span-2 space-y-4">
          {/* Conversation Header */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{conversation.contact.name || "Sin nombre"}</CardTitle>
                  <div className="flex gap-2 mt-2">
                    <Badge variant="outline">{CHANNEL_LABELS[conversation.channel]}</Badge>
                    <Badge variant="outline">{CONVERSATION_STATUS_LABELS[conversation.status]}</Badge>
                  </div>
                </div>

                <Select
                  value={conversation.status}
                  onValueChange={(value) => handleStatusChange(value as ConversationStatus)}
                  disabled={isUpdating}
                >
                  <SelectTrigger className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        Activa
                      </div>
                    </SelectItem>
                    <SelectItem value="WAITING">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-yellow-600" />
                        Esperando
                      </div>
                    </SelectItem>
                    <SelectItem value="CLOSED">
                      <div className="flex items-center gap-2">
                        <XCircle className="h-4 w-4 text-gray-600" />
                        Cerrada
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
          </Card>

          {/* Messages */}
          <Card className="min-h-[500px] max-h-[600px] flex flex-col">
            <CardContent className="flex-1 overflow-y-auto p-6">
              {conversation.messages && conversation.messages.length > 0 ? (
                <>
                  {conversation.messages.map((message) => (
                    <MessageBubble key={message.id} message={message} />
                  ))}
                  <div ref={messagesEndRef} />
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-20" />
                    <p>No hay mensajes aún</p>
                  </div>
                </div>
              )}
            </CardContent>

            {/* Send Message Form */}
            <div className="border-t p-4">
              <SendMessageForm
                conversationId={conversationId}
                onSendMessage={handleSendMessage}
                onMessageSent={handleMessageSent}
              />
            </div>
          </Card>
        </div>

        {/* SIDEBAR COLUMN */}
        <div className="space-y-4">
          {/* Contact Info */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Información del Contacto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <span>{conversation.contact.phone || "Sin teléfono"}</span>
              </div>

              {conversation.contact.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span>{conversation.contact.email}</span>
                </div>
              )}

              <div className="flex items-center gap-2 text-sm">
                <Tag className="h-4 w-4 text-muted-foreground" />
                <span>{CONTACT_TYPE_LABELS[conversation.contact.type]}</span>
              </div>
            </CardContent>
          </Card>

          {/* Assignment */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Asignación</CardTitle>
            </CardHeader>
            <CardContent>
              {conversation.assigned ? (
                <div className="flex items-center gap-2 mb-3">
                  <UserPlus className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{conversation.assigned.name}</span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mb-3">No asignada</p>
              )}

              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => user && handleAssign(user.id)}
                disabled={isUpdating}
              >
                Asignarme a mí
              </Button>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Acciones Rápidas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => router.push(`/dashboard/contacts/${conversation.contactId}`)}
              >
                Ver perfil del contacto
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => handleStatusChange(ConversationStatus.CLOSED)}
                disabled={isUpdating || conversation.status === "CLOSED"}
              >
                Cerrar conversación
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
