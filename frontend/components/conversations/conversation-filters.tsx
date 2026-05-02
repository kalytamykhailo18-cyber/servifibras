"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import { ConversationStatus, Channel, CONVERSATION_STATUS_LABELS, CHANNEL_LABELS } from "@/types";
import type { ConversationFilters } from "@/types";

interface ConversationFiltersProps {
  filters: ConversationFilters;
  onFilterChange: (filters: ConversationFilters) => void;
  totalCount: number;
}

export function ConversationFiltersComponent({
  filters,
  onFilterChange,
  totalCount,
}: ConversationFiltersProps) {
  const handleStatusChange = (value: string | null) => {
    if (!value) return;
    onFilterChange({
      ...filters,
      status: value === "ALL" ? "ALL" : (value as ConversationStatus),
    });
  };

  const handleChannelChange = (value: string | null) => {
    if (!value) return;
    onFilterChange({
      ...filters,
      channel: value === "ALL" ? "ALL" : (value as Channel),
    });
  };

  const handleSearchChange = (value: string) => {
    onFilterChange({
      ...filters,
      search: value,
    });
  };

  const clearFilters = () => {
    onFilterChange({
      status: "ALL",
      channel: "ALL",
      assignedTo: "ALL",
      search: "",
    });
  };

  const hasActiveFilters =
    filters.status !== "ALL" ||
    filters.channel !== "ALL" ||
    filters.assignedTo !== "ALL" ||
    (filters.search && filters.search.length > 0);

  return (
    <div className="space-y-3">
      {/* Search — leading icon recolours on focus, soft ring */}
      <div className="group relative">
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors duration-200 group-focus-within:text-blue-600" />
        <input
          type="text"
          placeholder="Buscar por contacto, teléfono o mensaje..."
          value={filters.search || ""}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all duration-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/15"
        />
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Select value={String(filters.status || "ALL")} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos los estados</SelectItem>
            {Object.entries(CONVERSATION_STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={String(filters.channel || "ALL")} onValueChange={handleChannelChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Canal" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos los canales</SelectItem>
            {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-rose-200/70 bg-rose-50/70 px-3.5 text-sm font-medium text-rose-600 transition-all duration-200 hover:border-rose-300 hover:bg-rose-100/80 active:scale-[0.97]"
          >
            <CloseIcon sx={{ fontSize: 16 }} />
            Limpiar filtros
          </button>
        )}

        {/* Count chip — pinned right */}
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
          <span className="font-semibold text-slate-900">{totalCount}</span>
          conversaciones
        </span>
      </div>
    </div>
  );
}
