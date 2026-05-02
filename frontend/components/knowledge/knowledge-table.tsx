"use client";

import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import type { KnowledgeBase } from "@/types";

interface KnowledgeTableProps {
  items: KnowledgeBase[];
  onEdit: (item: KnowledgeBase) => void;
  onDelete: (item: KnowledgeBase) => void;
  onToggleActive: (item: KnowledgeBase, active: boolean) => void;
}

const CATEGORY_TINT: Record<string, { dot: string; pill: string }> = {
  "Resinas":         { dot: "bg-blue-500",    pill: "bg-blue-50 text-blue-700 border-blue-200/70" },
  "Fibra de Vidrio": { dot: "bg-violet-500",  pill: "bg-violet-50 text-violet-700 border-violet-200/70" },
  "Cauchos":         { dot: "bg-orange-500",  pill: "bg-orange-50 text-orange-700 border-orange-200/70" },
  "General":         { dot: "bg-slate-400",   pill: "bg-slate-50 text-slate-700 border-slate-200" },
  "FAQ":             { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 border-emerald-200/70" },
  "Tutoriales":      { dot: "bg-pink-500",    pill: "bg-pink-50 text-pink-700 border-pink-200/70" },
};

const fallback = { dot: "bg-slate-400", pill: "bg-slate-50 text-slate-600 border-slate-200" };

export function KnowledgeTable({
  items,
  onEdit,
  onDelete,
  onToggleActive,
}: KnowledgeTableProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-16 text-center">
        <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-100 to-purple-50 text-violet-400">
          <MenuBookIcon sx={{ fontSize: 28 }} />
        </span>
        <h3 className="text-base font-semibold text-slate-900">Sin artículos</h3>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          No se encontraron artículos de conocimiento. Probá ajustar los filtros o crear uno nuevo.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
      <Table>
        <TableHeader>
          <TableRow className="border-b border-slate-200/70 bg-slate-50/50 hover:bg-slate-50/50">
            <TableHead className="h-11 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Título
            </TableHead>
            <TableHead className="h-11 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Categoría
            </TableHead>
            <TableHead className="h-11 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Subcategoría
            </TableHead>
            <TableHead className="h-11 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Estado
            </TableHead>
            <TableHead className="h-11 px-4 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Acciones
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const tint = CATEGORY_TINT[item.category] ?? fallback;
            return (
              <TableRow
                key={item.id}
                className={`border-b border-slate-100 transition-colors duration-150 last:border-b-0 hover:bg-violet-50/30 ${item.active ? "" : "opacity-60"}`}
              >
                <TableCell className="max-w-md px-4 py-3">
                  <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {item.content.substring(0, 110)}…
                  </p>
                </TableCell>

                <TableCell className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tint.pill}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${tint.dot}`} />
                    {item.category}
                  </span>
                </TableCell>

                <TableCell className="px-4 py-3">
                  {item.subcategory ? (
                    <span className="text-sm text-slate-700">{item.subcategory}</span>
                  ) : (
                    <span className="text-sm text-slate-400">—</span>
                  )}
                </TableCell>

                <TableCell className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <Switch
                      checked={item.active}
                      onCheckedChange={(checked) => onToggleActive(item, checked)}
                    />
                    <span
                      className={`text-xs font-medium ${
                        item.active ? "text-emerald-700" : "text-slate-400"
                      }`}
                    >
                      {item.active ? "Activo" : "Inactivo"}
                    </span>
                  </div>
                </TableCell>

                <TableCell className="px-4 py-3 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <button
                          type="button"
                          aria-label="Abrir menú de acciones"
                          className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900"
                        />
                      }
                    >
                      <MoreHorizIcon sx={{ fontSize: 18 }} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="w-52 overflow-hidden rounded-2xl border border-slate-200/70 bg-white/95 p-1.5 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.18)] backdrop-blur-xl backdrop-saturate-150"
                    >
                      <DropdownMenuItem
                        onClick={() => onEdit(item)}
                        className="group cursor-pointer rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 focus:bg-blue-50 focus:text-blue-700"
                      >
                        <span className="mr-2.5 grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-blue-500 to-cyan-400 text-white">
                          <VisibilityIcon sx={{ fontSize: 14 }} />
                        </span>
                        Ver completo
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onEdit(item)}
                        className="group cursor-pointer rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 focus:bg-amber-50 focus:text-amber-700"
                      >
                        <span className="mr-2.5 grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-amber-500 to-orange-400 text-white">
                          <EditIcon sx={{ fontSize: 14 }} />
                        </span>
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="my-1.5 bg-slate-200/70" />
                      <DropdownMenuItem
                        onClick={() => onDelete(item)}
                        className="group cursor-pointer rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 focus:bg-red-50 focus:text-red-700"
                      >
                        <span className="mr-2.5 grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-red-500 to-rose-500 text-white">
                          <DeleteIcon sx={{ fontSize: 14 }} />
                        </span>
                        Eliminar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
