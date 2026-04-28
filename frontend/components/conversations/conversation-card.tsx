"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  MessageSquare,
  Phone,
  User,
  Clock,
} from "lucide-react";
import type { ConversationWithRelations } from "@/types";
import { CHANNEL_LABELS, CONVERSATION_STATUS_LABELS } from "@/types";

interface ConversationCardProps {
  conversation: ConversationWithRelations;
}

export function ConversationCard({ conversation }: ConversationCardProps) {
  const getInitials = (name: string | null) => {
    if (!name) return "?";
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "WAITING":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
      case "CLOSED":
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getChannelColor = (channel: string) => {
    switch (channel) {
      case "WHATSAPP":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300";
      case "FACEBOOK":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "INSTAGRAM":
        return "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300";
      case "MERCADOLIBRE":
        return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300";
      case "TIENDANUBE_WEBCHAT":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const timeAgo = conversation.lastMessageAt
    ? formatDistanceToNow(new Date(conversation.lastMessageAt), {
        addSuffix: true,
        locale: es,
      })
    : "Sin mensajes";

  return (
    <Link href={`/dashboard/conversations/${conversation.id}`}>
      <Card className={`transition-all hover:shadow-md hover:scale-[1.01] cursor-pointer ${
        conversation.isUnread ? "border-primary border-2" : ""
      }`}>
        <CardContent className="p-4">
          <div className="flex gap-4">
            {/* Avatar */}
            <Avatar className="h-12 w-12">
              <AvatarFallback className="bg-primary/10 text-primary">
                {getInitials(conversation.contact.name)}
              </AvatarFallback>
            </Avatar>

            {/* Content */}
            <div className="flex-1 min-w-0">
              {/* Header */}
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm truncate">
                    {conversation.contact.name || "Sin nombre"}
                  </h3>
                  {conversation.isUnread && (
                    <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                  )}
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {timeAgo}
                </span>
              </div>

              {/* Contact Info */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
                {conversation.contact.phone && (
                  <div className="flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    <span>{conversation.contact.phone}</span>
                  </div>
                )}
                {conversation.assigned && (
                  <div className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    <span>{conversation.assigned.name}</span>
                  </div>
                )}
              </div>

              {/* Last Message */}
              {conversation.lastMessage && (
                <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                  {conversation.lastMessage}
                </p>
              )}

              {/* Badges */}
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className={getChannelColor(conversation.channel)}>
                  {CHANNEL_LABELS[conversation.channel]}
                </Badge>
                <Badge variant="outline" className={getStatusColor(conversation.status)}>
                  {CONVERSATION_STATUS_LABELS[conversation.status]}
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
