"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CHANNEL_LABELS, type Lead } from "@/types";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import InventoryIcon from "@mui/icons-material/Inventory";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PersonIcon from "@mui/icons-material/Person";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { safeFormatDistanceToNow } from "@/lib/date";
import { formatNumber } from "@/lib/format";

interface LeadCardProps {
  lead: Lead;
  onView: (lead: Lead) => void;
  onEdit: (lead: Lead) => void;
  onDelete: (lead: Lead) => void;
}

const CHANNEL_TINT: Record<string, { dot: string; pill: string }> = {
  WHATSAPP:           { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 border-emerald-200/70" },
  FACEBOOK:           { dot: "bg-blue-500",    pill: "bg-blue-50 text-blue-700 border-blue-200/70" },
  INSTAGRAM:          { dot: "bg-pink-500",    pill: "bg-pink-50 text-pink-700 border-pink-200/70" },
  MERCADOLIBRE:       { dot: "bg-amber-500",   pill: "bg-amber-50 text-amber-700 border-amber-200/70" },
  TIENDANUBE_WEBCHAT: { dot: "bg-violet-500",  pill: "bg-violet-50 text-violet-700 border-violet-200/70" },
};
const fallback = { dot: "bg-slate-400", pill: "bg-slate-50 text-slate-600 border-slate-200" };

export function LeadCard({ lead, onView, onEdit, onDelete }: LeadCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lead.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  const channelTint = CHANNEL_TINT[lead.source] ?? fallback;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="group cursor-grab rounded-xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] hover:border-slate-300 active:cursor-grabbing"
    >
      {/* Top row: name + actions */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="line-clamp-1 text-sm font-semibold text-slate-900">
            {lead.contact?.name || lead.contact?.phone || "Sin nombre"}
          </h4>
          {lead.source && (
            <span
              className={`mt-1 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${channelTint.pill}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${channelTint.dot}`} />
              {CHANNEL_LABELS[lead.source as keyof typeof CHANNEL_LABELS]}
            </span>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            onClick={(e) => e.stopPropagation()}
            render={
              <button
                type="button"
                aria-label="Abrir menú"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              />
            }
          >
            <MoreVertIcon sx={{ fontSize: 16 }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-48 overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 p-1.5 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.18)] backdrop-blur-xl backdrop-saturate-150"
          >
            <DropdownMenuItem
              onClick={() => onView(lead)}
              className="group cursor-pointer rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 focus:bg-blue-50 focus:text-blue-700"
            >
              <span className="mr-2.5 grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-blue-500 to-cyan-400 text-white">
                <VisibilityIcon sx={{ fontSize: 14 }} />
              </span>
              Ver detalles
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onEdit(lead)}
              className="group cursor-pointer rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 focus:bg-amber-50 focus:text-amber-700"
            >
              <span className="mr-2.5 grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-amber-500 to-orange-400 text-white">
                <EditIcon sx={{ fontSize: 14 }} />
              </span>
              Editar
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1.5 bg-slate-200/70" />
            <DropdownMenuItem
              onClick={() => onDelete(lead)}
              className="group cursor-pointer rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 focus:bg-red-50 focus:text-red-700"
            >
              <span className="mr-2.5 grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-red-500 to-rose-500 text-white">
                <DeleteIcon sx={{ fontSize: 14 }} />
              </span>
              Eliminar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Stats stack */}
      <div className="space-y-1.5">
        {lead.productInterest && (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
            <InventoryIcon sx={{ fontSize: 12 }} className="text-slate-400" />
            <span className="line-clamp-1">{lead.productInterest}</span>
          </div>
        )}

        {lead.estimatedValue !== null && lead.estimatedValue !== undefined && lead.estimatedValue > 0 && (
          <div className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-br from-emerald-500 to-teal-400 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white shadow-[0_2px_6px_-1px_rgb(16_185_129/0.45)]">
            <AttachMoneyIcon sx={{ fontSize: 12 }} />
            ${formatNumber(lead.estimatedValue)}
          </div>
        )}

        {lead.assignedTo && (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
            <PersonIcon sx={{ fontSize: 12 }} className="text-slate-400" />
            <span>{lead.assigned?.name || "Asignado"}</span>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <CalendarTodayIcon sx={{ fontSize: 12 }} className="text-slate-400" />
          <span>{safeFormatDistanceToNow(lead.createdAt)}</span>
        </div>

        {lead.notes && (
          <p className="line-clamp-2 pt-1 text-[11px] leading-relaxed text-slate-500">
            {lead.notes}
          </p>
        )}
      </div>
    </div>
  );
}
