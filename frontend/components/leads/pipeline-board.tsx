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
  onViewLead: (lead: Lead) => void;
  onEditLead: (lead: Lead) => void;
  onDeleteLead: (lead: Lead) => void;
}

const PIPELINE_COLUMNS = [
  {
    status: LeadStatus.NEW,
    title: "Nuevo",
    color: "bg-blue-500",
  },
  {
    status: LeadStatus.CONTACTED,
    title: "Contactado",
    color: "bg-purple-500",
  },
  {
    status: LeadStatus.QUOTE_SENT,
    title: "Cotización Enviada",
    color: "bg-yellow-500",
  },
  {
    status: LeadStatus.NEGOTIATING,
    title: "Negociando",
    color: "bg-orange-500",
  },
  {
    status: LeadStatus.WON,
    title: "Ganado",
    color: "bg-green-500",
  },
  {
    status: LeadStatus.LOST,
    title: "Perdido",
    color: "bg-red-500",
  },
];

export function PipelineBoard({
  leads,
  onLeadsChange,
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

    if (!over) {
      setActiveLead(null);
      return;
    }

    const leadId = active.id as string;
    const newStatus = over.id as LeadStatus;

    const lead = leads.find((l) => l.id === leadId);

    if (lead && lead.status !== newStatus) {
      try {
        // Update status via API
        await api.leads.updateStatus(leadId, { status: newStatus });
        toast.success(`Oportunidad movida a: ${PIPELINE_COLUMNS.find((c) => c.status === newStatus)?.title}`);

        // Refresh leads
        onLeadsChange();
      } catch (error: any) {
        toast.error(error.message || "Error al actualizar estado");
      }
    }

    setActiveLead(null);
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
      <div className="flex gap-4 overflow-x-auto pb-4">
        {PIPELINE_COLUMNS.map((column) => (
          <PipelineColumn
            key={column.status}
            status={column.status}
            title={column.title}
            color={column.color}
            leads={leadsByStatus[column.status] || []}
            onViewLead={onViewLead}
            onEditLead={onEditLead}
            onDeleteLead={onDeleteLead}
          />
        ))}
      </div>

      <DragOverlay>
        {activeLead ? (
          <div className="rotate-3 opacity-80">
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
