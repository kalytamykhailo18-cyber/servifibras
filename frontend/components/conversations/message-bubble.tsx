"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Bot, User } from "lucide-react";
import type { Message, MessageSender } from "@/types";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isCustomer = message.sender === "CUSTOMER";
  const isAI = message.sender === "AI" || message.isFromAI;

  const getSenderLabel = (sender: MessageSender) => {
    switch (sender) {
      case "CUSTOMER":
        return "Cliente";
      case "AI":
        return "IA";
      case "BRENDA":
        return "Brenda";
      case "FRANCO":
        return "Franco";
      case "ALDO":
        return "Aldo";
      case "ADMIN":
        return "Admin";
      default:
        return sender;
    }
  };

  const getSenderColor = (sender: MessageSender) => {
    if (sender === "CUSTOMER") {
      return "bg-primary/10 text-primary";
    }
    if (sender === "AI" || message.isFromAI) {
      return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300";
    }
    return "bg-accent text-accent-foreground";
  };

  return (
    <div className={cn("flex gap-3 mb-4", isCustomer ? "flex-row" : "flex-row-reverse")}>
      {/* Avatar */}
      <Avatar className="h-8 w-8 mt-1">
        <AvatarFallback className={getSenderColor(message.sender)}>
          {isCustomer ? (
            <User className="h-4 w-4" />
          ) : isAI ? (
            <Bot className="h-4 w-4" />
          ) : (
            message.sender.charAt(0)
          )}
        </AvatarFallback>
      </Avatar>

      {/* Message Content */}
      <div className={cn("flex flex-col max-w-[70%]", isCustomer ? "items-start" : "items-end")}>
        {/* Sender Name & Time */}
        <div className="flex items-center gap-2 mb-1 px-1">
          <span className="text-xs font-medium text-muted-foreground">
            {getSenderLabel(message.sender)}
          </span>
          {isAI && (
            <Badge variant="outline" className="text-xs py-0 px-1.5 bg-purple-50 dark:bg-purple-950">
              IA
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {format(new Date(message.timestamp), "HH:mm", { locale: es })}
          </span>
        </div>

        {/* Message Bubble */}
        <div
          className={cn(
            "rounded-2xl px-4 py-2 shadow-sm",
            isCustomer
              ? "bg-primary text-primary-foreground rounded-tl-none"
              : "bg-muted rounded-tr-none"
          )}
        >
          <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
        </div>

        {/* Timestamp */}
        <span className="text-xs text-muted-foreground mt-1 px-1">
          {format(new Date(message.timestamp), "dd/MM/yyyy", { locale: es })}
        </span>
      </div>
    </div>
  );
}
