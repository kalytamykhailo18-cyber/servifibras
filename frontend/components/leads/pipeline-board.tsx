"use client";

import { useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { PipelineColumn } from "./pipeline-column";
import { LeadCard } from "./lead-card";
import { LeadStatus, type Lead } from "@/types";
import { api } from "@/lib/api/endpoints";
import { toast } from "sonner";

interface PipelineBoardProps {
  leads: Lead[];
  onLeadsChange: () => void;
  onLeadStatusChanged: (leadId: string, status: LeadStatus) => void;
  onViewLead: (lead: Lead) => void;
  onEditLead: (lead: Lead) => void;
  onDeleteLead: (lead: Lead) => void;
}

const PIPELINE_COLUMNS = [
  {
    status: LeadStatus.NEW,
    title: "Nuevo",
    color: "bg-blue-500",
    gradient: "from-blue-500 to-cyan-400",
    tint: "bg-blue-50/50 border-blue-200/70",
    chip: "bg-blue-100 text-blue-700",
  },
  {
    status: LeadStatus.CONTACTED,
    title: "Contactado",
    color: "bg-violet-500",
    gradient: "from-violet-500 to-purple-500",
    tint: "bg-violet-50/50 border-violet-200/70",
    chip: "bg-violet-100 text-violet-700",
  },
  {
    status: LeadStatus.QUOTE_SENT,
    title: "Cotización Enviada",
    color: "bg-amber-500",
    gradient: "from-amber-500 to-yellow-400",
    tint: "bg-amber-50/50 border-amber-200/70",
    chip: "bg-amber-100 text-amber-700",
  },
  {
    status: LeadStatus.NEGOTIATING,
    title: "Negociando",
    color: "bg-orange-500",
    gradient: "from-orange-500 to-red-400",
    tint: "bg-orange-50/50 border-orange-200/70",
    chip: "bg-orange-100 text-orange-700",
  },
  {
    status: LeadStatus.WON,
    title: "Ganado",
    color: "bg-emerald-500",
    gradient: "from-emerald-500 to-teal-400",
    tint: "bg-emerald-50/50 border-emerald-200/70",
    chip: "bg-emerald-100 text-emerald-700",
  },
  {
    status: LeadStatus.LOST,
    title: "Perdido",
    color: "bg-slate-400",
    gradient: "from-slate-500 to-slate-400",
    tint: "bg-slate-50 border-slate-200",
    chip: "bg-slate-100 text-slate-600",
  },
] as const;

export function PipelineBoard({
  leads,
  onLeadsChange,
  onLeadStatusChanged,
  onViewLead,
  onEditLead,
  onDeleteLead,
}: PipelineBoardProps) {
  const [activeLead, setActiveLead] = useState<Lead | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const lead = leads.find((l) => l.id === event.active.id);
    setActiveLead(lead || null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveLead(null);

    // No drop target — dnd-kit snaps the card back to where it was on its own
    if (!over) return;

    const leadId = active.id as string;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;

    // Resolve the drop target to a column status:
    //   - dropped on a column → over.id is a LeadStatus
    //   - dropped on another card → over.id is that card's lead id, so use its column
    const validStatuses = PIPELINE_COLUMNS.map((c) => c.status) as LeadStatus[];
    const overId = over.id as string;
    let newStatus: LeadStatus | null = null;
    if ((validStatuses as string[]).includes(overId)) {
      newStatus = overId as LeadStatus;
    } else {
      const targetLead = leads.find((l) => l.id === overId);
      if (targetLead) newStatus = targetLead.status;
    }

    // Invalid drop target or same column — let the card snap back, no API call
    if (!newStatus || newStatus === lead.status) return;

    // Optimistically move the card — no full-page reload, no skeleton flash
    const previousStatus = lead.status;
    onLeadStatusChanged(leadId, newStatus);

    try {
      await api.leads.updateStatus(leadId, { status: newStatus });
    } catch (error: any) {
      // Roll back to the original column on failure
      onLeadStatusChanged(leadId, previousStatus);
      toast.error(error?.response?.data?.message || error?.message || "Error al actualizar estado");
    }
  };

  // Group leads by status
  const leadsByStatus = PIPELINE_COLUMNS.reduce((acc, column) => {
    acc[column.status] = leads.filter((lead) => lead.status === column.status);
    return acc;
  }, {} as Record<LeadStatus, Lead[]>);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
        {PIPELINE_COLUMNS.map((column) => (
          <PipelineColumn
            key={column.status}
            status={column.status}
            title={column.title}
            color={column.color}
            gradient={column.gradient}
            tint={column.tint}
            chip={column.chip}
            leads={leadsByStatus[column.status] || []}
            onViewLead={onViewLead}
            onEditLead={onEditLead}
            onDeleteLead={onDeleteLead}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeLead ? (
          <div className="opacity-90 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.35)]">
            <LeadCard
              lead={activeLead}
              onView={() => {}}
              onEdit={() => {}}
              onDelete={() => {}}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
