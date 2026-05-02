"use client";

import Link from "next/link";
import { safeFormatDistanceToNow } from "@/lib/date";
import PersonIcon from "@mui/icons-material/Person";
import PhoneIcon from "@mui/icons-material/Phone";
import type { ConversationWithRelations } from "@/types";
import { CHANNEL_LABELS, CONVERSATION_STATUS_LABELS } from "@/types";

interface ConversationCardProps {
  conversation: ConversationWithRelations;
}

const AVATAR_GRADIENTS = [
  "from-blue-500 to-cyan-400",
  "from-emerald-500 to-teal-400",
  "from-purple-500 to-pink-400",
  "from-orange-500 to-amber-400",
  "from-indigo-500 to-violet-400",
  "from-rose-500 to-pink-400",
];

const CHANNEL_TINT: Record<string, { dot: string; pill: string }> = {
  WHATSAPP:           { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 border-emerald-200/70" },
  FACEBOOK:           { dot: "bg-blue-500",    pill: "bg-blue-50 text-blue-700 border-blue-200/70" },
  INSTAGRAM:          { dot: "bg-pink-500",    pill: "bg-pink-50 text-pink-700 border-pink-200/70" },
  MERCADOLIBRE:       { dot: "bg-amber-500",   pill: "bg-amber-50 text-amber-700 border-amber-200/70" },
  TIENDANUBE_WEBCHAT: { dot: "bg-violet-500",  pill: "bg-violet-50 text-violet-700 border-violet-200/70" },
};

const STATUS_TINT: Record<string, { dot: string; pill: string }> = {
  ACTIVE:  { dot: "bg-green-500",  pill: "bg-green-50 text-green-700 border-green-200/70" },
  WAITING: { dot: "bg-amber-500",  pill: "bg-amber-50 text-amber-700 border-amber-200/70" },
  CLOSED:  { dot: "bg-slate-400",  pill: "bg-slate-50 text-slate-600 border-slate-200" },
};

const fallbackTint = { dot: "bg-slate-400", pill: "bg-slate-50 text-slate-600 border-slate-200" };

export function ConversationCard({ conversation }: ConversationCardProps) {
  const name = conversation.contact.name;

  const initials = (() => {
    if (!name) return "?";
    const parts = name.split(" ").filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  })();

  const gradient =
    AVATAR_GRADIENTS[
      (name ? name.charCodeAt(0) : 0) % AVATAR_GRADIENTS.length
    ];

  const channelTint = CHANNEL_TINT[conversation.channel] ?? fallbackTint;
  const statusTint = STATUS_TINT[conversation.status] ?? fallbackTint;

  const timeAgo = conversation.lastMessageAt
    ? safeFormatDistanceToNow(conversation.lastMessageAt)
    : "Sin mensajes";

  return (
    <Link
      href={`/conversations/${conversation.id}`}
      className={`group relative flex gap-4 rounded-2xl border bg-white p-4 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-8px_rgb(15_23_42/0.15)] ${
        conversation.isUnread
          ? "border-blue-300/80 bg-gradient-to-br from-blue-50/40 to-white"
          : "border-slate-200/70 hover:border-blue-200"
      }`}
    >
      {/* Unread accent rail */}
      {conversation.isUnread && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-1/2 h-12 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-blue-500 to-cyan-400"
        />
      )}

      {/* Avatar */}
      <span
        className={`grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br ${gradient} text-sm font-semibold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_4px_10px_-2px_rgb(15_23_42/0.18)]`}
      >
        {initials}
      </span>

      {/* Body */}
      <div className="min-w-0 flex-1">
        {/* Title row */}
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-900">
              {name || "Sin nombre"}
            </h3>
            {conversation.isUnread && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inset-0 inline-flex animate-ping rounded-full bg-blue-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
              </span>
            )}
          </div>
          <span className="shrink-0 text-xs text-slate-500">{timeAgo}</span>
        </div>

        {/* Contact info */}
        {(conversation.contact.phone || conversation.assigned) && (
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {conversation.contact.phone && (
              <span className="inline-flex items-center gap-1">
                <PhoneIcon sx={{ fontSize: 12 }} />
                {conversation.contact.phone}
              </span>
            )}
            {conversation.assigned && (
              <span className="inline-flex items-center gap-1">
                <PersonIcon sx={{ fontSize: 12 }} />
                {conversation.assigned.name}
              </span>
            )}
          </div>
        )}

        {/* Last message */}
        {conversation.lastMessage && (
          <p className="mb-2.5 line-clamp-2 text-sm leading-relaxed text-slate-600">
            {conversation.lastMessage}
          </p>
        )}

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${channelTint.pill}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${channelTint.dot}`} />
            {CHANNEL_LABELS[conversation.channel]}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusTint.pill}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusTint.dot}`} />
            {CONVERSATION_STATUS_LABELS[conversation.status]}
          </span>
        </div>
      </div>
    </Link>
  );
}
