"use client";

import { safeFormatDate } from "@/lib/date";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import PersonIcon from "@mui/icons-material/Person";
import type { Message, MessageSender } from "@/types";
import { cn } from "@/lib/utils";

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
            {message.sender.charAt(0)}
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
        {/* Sender label + time */}
        <div className="mb-1 flex items-center gap-2 px-1 text-[11px] text-slate-500">
          <span className="font-medium">
            {SENDER_LABELS[message.sender] ?? message.sender}
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
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
          </p>
        </div>
      </div>
    </div>
  );
}
