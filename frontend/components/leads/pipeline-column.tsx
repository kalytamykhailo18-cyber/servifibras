"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { LeadCard } from "./lead-card";
import { LeadStatus, type Lead } from "@/types";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";

interface PipelineColumnProps {
  status: LeadStatus;
  title: string;
  leads: Lead[];
  color: string;
  gradient: string;
  tint: string;
  chip: string;
  onViewLead: (lead: Lead) => void;
  onEditLead: (lead: Lead) => void;
  onDeleteLead: (lead: Lead) => void;
}

export function PipelineColumn({
  status,
  title,
  leads,
  gradient,
  tint,
  chip,
  onViewLead,
  onEditLead,
  onDeleteLead,
}: PipelineColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
  });

  const totalValue = leads.reduce(
    (sum, lead) => sum + (lead.estimatedValue || 0),
    0,
  );

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-[300px] shrink-0 flex-col rounded-2xl border bg-white p-3 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200",
        tint,
        isOver && "ring-4 ring-blue-500/20 shadow-[0_12px_28px_-8px_rgb(15_23_42/0.18)]",
      )}
    >
      {/* Column Header */}
      <div className="mb-3 px-1">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <span
              className={`h-2.5 w-2.5 rounded-full bg-gradient-to-br ${gradient}`}
              aria-hidden
            />
            {title}
          </h3>
          <span
            className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums ${chip}`}
          >
            {leads.length}
          </span>
        </div>
        {totalValue > 0 && (
          <p className="text-xs font-medium tabular-nums text-slate-600">
            ${formatNumber(totalValue)} USD
          </p>
        )}
      </div>

      {/* Cards */}
      <SortableContext
        items={leads.map((l) => l.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex-1 space-y-2.5 overflow-y-auto pb-1 max-h-[calc(100vh-300px)]">
          {leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/60 px-3 py-8 text-center">
              <p className="text-xs text-slate-400">Sin oportunidades</p>
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
