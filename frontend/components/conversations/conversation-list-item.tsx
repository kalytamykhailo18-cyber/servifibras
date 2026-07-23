"use client";

// Marcos 2026-07-21: fila WhatsApp-density para el split-pane de
// /conversations. Antes cada conv era una Card grande (~110px) y
// entraban 4 en pantalla. Marcos pidió que entren 10 como en
// WhatsApp — comprimimos a ~64px por fila con: avatar chico, título
// + timestamp en una línea, preview de 1 línea, badges reducidas a
// puntos de color + un pill "MAYORISTA"/"Pendiente" cuando aplica.
// Selección visible con fondo azul suave a la izquierda, mismo look
// que un app de mensajería.

import { safeFormatInboxTime } from "@/lib/date";
import type { ConversationWithRelations } from "@/types";
import { useState } from "react";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import { api } from "@/lib/api/endpoints";

interface Props {
  conversation: ConversationWithRelations;
  selected: boolean;
  onSelect: (id: string) => void;
  onFavoriteChange?: (id: string, favorite: boolean) => void;
}

const AVATAR_GRADIENTS = [
  "from-blue-500 to-cyan-400",
  "from-emerald-500 to-teal-400",
  "from-purple-500 to-pink-400",
  "from-orange-500 to-amber-400",
  "from-indigo-500 to-violet-400",
  "from-rose-500 to-pink-400",
];

const CHANNEL_DOT: Record<string, string> = {
  WHATSAPP: "bg-emerald-500",
  FACEBOOK: "bg-blue-500",
  INSTAGRAM: "bg-pink-500",
  MERCADOLIBRE: "bg-amber-500",
  TIENDANUBE_WEBCHAT: "bg-violet-500",
};

export function ConversationListItem({ conversation, selected, onSelect, onFavoriteChange }: Props) {
  // Marcos 2026-07-21: estado local optimista para la estrella. El
  // toggle actualiza al instante y le avisa al padre para que si
  // estamos en la tab Favoritas y desmarcamos, la fila desaparezca.
  const [localFav, setLocalFav] = useState<boolean>(!!conversation.favorite);
  const [pending, setPending] = useState(false);

  async function toggleFav(e: React.MouseEvent) {
    e.stopPropagation();
    if (pending) return;
    const next = !localFav;
    setLocalFav(next);
    setPending(true);
    try {
      const r = await api.conversations.setFavorite(conversation.id, next);
      if (r) {
        setLocalFav(r.favorite);
        onFavoriteChange?.(conversation.id, r.favorite);
      } else {
        setLocalFav(!next);
      }
    } catch {
      setLocalFav(!next);
    } finally {
      setPending(false);
    }
  }
  const name = conversation.contact.name || "Sin nombre";

  const initials = (() => {
    const parts = name.split(" ").filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  })();

  const gradient = AVATAR_GRADIENTS[(name.charCodeAt(0) || 0) % AVATAR_GRADIENTS.length];
  const channelDot = CHANNEL_DOT[conversation.channel] ?? "bg-slate-400";
  // Marcos 2026-07-23: hora exacta estilo WhatsApp — HH:MM hoy,
  // "ayer HH:MM" ayer, día corto (<7d), fecha para más viejo.
  const timeAgo = conversation.lastMessageAt ? safeFormatInboxTime(conversation.lastMessageAt) : "";
  const needsHuman = !!conversation.needsHumanAttention;
  const isMayorista =
    conversation.contact.type === "MAYORISTA" ||
    conversation.contact.customerType === "MAYORISTA";
  const preview = (conversation.lastMessage ?? "").trim();

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      aria-current={selected ? "true" : undefined}
      className={
        "group relative flex w-full min-w-0 items-center gap-2.5 border-b border-slate-100 px-3 py-2 text-left transition-colors " +
        (selected
          ? "bg-blue-50/80 hover:bg-blue-50"
          : needsHuman
          ? "bg-rose-50/40 hover:bg-rose-50/70"
          : "hover:bg-slate-50")
      }
    >
      {selected && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-blue-600" />}
      {needsHuman && !selected && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-rose-500" />}

      {conversation.contact.avatarUrl ? (
        <img
          src={conversation.contact.avatarUrl}
          alt=""
          className="h-10 w-10 shrink-0 rounded-full object-cover"
          referrerPolicy="no-referrer"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br ${gradient} text-[11px] font-semibold text-white`}
        >
          {initials}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${channelDot}`} title={conversation.channel} />
            <span className="truncate text-[13px] font-semibold text-slate-900">{name}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={toggleFav}
              aria-label={localFav ? "Quitar de favoritas" : "Marcar como favorita"}
              title={localFav ? "Quitar de favoritas" : "Marcar como favorita"}
              className={"grid h-5 w-5 place-items-center rounded transition-colors " + (pending ? "opacity-60" : "hover:bg-amber-100")}
            >
              {localFav
                ? <StarIcon sx={{ fontSize: 14 }} className="text-amber-500" />
                : <StarBorderIcon sx={{ fontSize: 14 }} className="text-slate-400 hover:text-amber-500" />}
            </button>
            <span className="text-[10px] text-slate-500">{timeAgo}</span>
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-[12px] leading-snug text-slate-600">{preview || <span className="italic text-slate-400">Sin mensajes</span>}</p>
          <div className="flex shrink-0 items-center gap-1">
            {isMayorista && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800">M</span>
            )}
            {needsHuman && (
              <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-700">H</span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
