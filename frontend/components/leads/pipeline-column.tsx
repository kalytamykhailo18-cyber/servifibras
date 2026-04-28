"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { LeadCard } from "./lead-card";
import { LeadStatus, type Lead } from "@/types";
import { cn } from "@/lib/utils";

interface PipelineColumnProps {
  status: LeadStatus;
  title: string;
  leads: Lead[];
  color: string;
  onViewLead: (lead: Lead) => void;
  onEditLead: (lead: Lead) => void;
  onDeleteLead: (lead: Lead) => void;
}

export function PipelineColumn({
  status,
  title,
  leads,
  color,
  onViewLead,
  onEditLead,
  onDeleteLead,
}: PipelineColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
  });

  const totalValue = leads.reduce(
    (sum, lead) => sum + (lead.estimatedValue || 0),
    0
  );

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col min-w-[280px] max-w-[320px] bg-muted/30 rounded-lg p-4 transition-colors",
        isOver && "bg-muted/60 ring-2 ring-primary ring-offset-2"
      )}
    >
      {/* Column Header */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${color}`} />
            {title}
          </h3>
          <span className="text-xs text-muted-foreground font-medium">
            {leads.length}
          </span>
        </div>
        {totalValue > 0 && (
          <p className="text-xs text-muted-foreground">
            ${totalValue.toLocaleString("es-AR")} USD
          </p>
        )}
      </div>

      {/* Cards */}
      <SortableContext
        items={leads.map((l) => l.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="space-y-3 flex-1 overflow-y-auto max-h-[calc(100vh-300px)]">
          {leads.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No hay oportunidades
            </div>
          ) : (
            leads.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                onView={onViewLead}
                onEdit={onEditLead}
                onDelete={onDeleteLead}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}
