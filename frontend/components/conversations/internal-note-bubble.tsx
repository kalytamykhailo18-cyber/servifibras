"use client";

// Visual representation of a staff-only internal note inside the conversation
// thread. Distinct from message bubbles so it can never be mistaken for
// something the customer sent or received.

import StickyNote2OutlinedIcon from "@mui/icons-material/StickyNote2Outlined";
import { safeFormatDate } from "@/lib/date";

interface InternalNoteBubbleProps {
  note: {
    id: string;
    authorName: string;
    content: string;
    createdAt: string | Date;
  };
}

export function InternalNoteBubble({ note }: InternalNoteBubbleProps) {
  return (
    <div className="mb-4 flex justify-center">
      <div className="w-full max-w-2xl rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50 to-amber-50/50 px-4 py-3 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className="mb-1 flex items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-amber-100 text-amber-700">
            <StickyNote2OutlinedIcon sx={{ fontSize: 14 }} />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
            Nota interna
          </span>
          <span className="text-[11px] text-amber-700/80">·</span>
          <span className="text-[11px] font-medium text-amber-800">{note.authorName}</span>
          <span className="ml-auto text-[10px] text-amber-700/70">
            {safeFormatDate(note.createdAt, "d MMM, HH:mm")}
          </span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-amber-950">
          {note.content}
        </p>
        <p className="mt-1 text-[10px] text-amber-700/70">
          Visible sólo para el equipo. El cliente nunca la ve.
        </p>
      </div>
    </div>
  );
}
