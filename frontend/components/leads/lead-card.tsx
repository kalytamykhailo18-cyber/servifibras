"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CHANNEL_LABELS, type Lead } from "@/types";
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import InventoryIcon from '@mui/icons-material/Inventory';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PersonIcon from '@mui/icons-material/Person';
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

interface LeadCardProps {
  lead: Lead;
  onView: (lead: Lead) => void;
  onEdit: (lead: Lead) => void;
  onDelete: (lead: Lead) => void;
}

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
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const getChannelColor = (channel: string) => {
    switch (channel) {
      case "WHATSAPP":
        return "bg-green-100 text-green-800";
      case "INSTAGRAM":
        return "bg-pink-100 text-pink-800";
      case "TELEGRAM":
        return "bg-blue-100 text-blue-800";
      case "WEB":
        return "bg-purple-100 text-purple-800";
      case "EMAIL":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className="cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
      {...attributes}
      {...listeners}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h4 className="font-semibold text-sm line-clamp-1">
              {lead.contact?.name || lead.contact?.phone || "Sin nombre"}
            </h4>
            <Badge className={`text-xs mt-1 ${getChannelColor(lead.source)}`}>
              {CHANNEL_LABELS[lead.source as keyof typeof CHANNEL_LABELS]}
            </Badge>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(e) => e.stopPropagation()}
              render={<Button variant="ghost" size="sm" className="h-8 w-8 p-0" />}
            >
              <MoreVertIcon className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onView(lead)}>
                Ver detalles
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(lead)}>
                Editar
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDelete(lead)}
                className="text-red-600"
              >
                Eliminar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pb-3">
        {/* Product Interest */}
        {lead.productInterest && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <InventoryIcon className="h-3 w-3" />
            <span className="line-clamp-1">{lead.productInterest}</span>
          </div>
        )}

        {/* Estimated Value */}
        {lead.estimatedValue !== null && lead.estimatedValue > 0 && (
          <div className="flex items-center gap-2 text-xs font-medium text-green-600">
            <AttachMoneyIcon className="h-3 w-3" />
            <span>${lead.estimatedValue.toLocaleString("es-AR")}</span>
          </div>
        )}

        {/* Assigned User */}
        {lead.assignedTo && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <PersonIcon className="h-3 w-3" />
            <span>{lead.assigned?.name || "Asignado"}</span>
          </div>
        )}

        {/* Created Date */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarTodayIcon className="h-3 w-3" />
          <span>
            {formatDistanceToNow(new Date(lead.createdAt), {
              addSuffix: true,
              locale: es,
            })}
          </span>
        </div>

        {/* Notes Preview */}
        {lead.notes && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-2">
            {lead.notes}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
