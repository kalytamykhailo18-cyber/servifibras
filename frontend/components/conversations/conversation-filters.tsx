"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por contacto, teléfono o mensaje..."
          value={filters.search || ""}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Status Filter */}
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

        {/* Channel Filter */}
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

        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <CloseIcon className="h-4 w-4" />
            Limpiar filtros
          </button>
        )}

        {/* Results Count */}
        <div className="ml-auto">
          <Badge variant="outline">{totalCount} conversaciones</Badge>
        </div>
      </div>
    </div>
  );
}
