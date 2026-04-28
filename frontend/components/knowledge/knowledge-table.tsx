"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Edit, Trash2, Eye } from "lucide-react";
import type { KnowledgeBase } from "@/types";

interface KnowledgeTableProps {
  items: KnowledgeBase[];
  onEdit: (item: KnowledgeBase) => void;
  onDelete: (item: KnowledgeBase) => void;
  onToggleActive: (item: KnowledgeBase, active: boolean) => void;
}

export function KnowledgeTable({
  items,
  onEdit,
  onDelete,
  onToggleActive,
}: KnowledgeTableProps) {
  const getCategoryColor = (category: string) => {
    switch (category) {
      case "Resinas":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "Fibra de Vidrio":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300";
      case "Cauchos":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300";
      case "General":
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
      case "FAQ":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "Tutoriales":
        return "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  if (items.length === 0) {
    return (
      <div className="text-center py-12 border rounded-lg">
        <p className="text-muted-foreground">No se encontraron artículos de conocimiento</p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Título</TableHead>
            <TableHead>Categoría</TableHead>
            <TableHead>Subcategoría</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id} className="hover:bg-muted/50">
              <TableCell className="font-medium max-w-md">
                <div>
                  <p className="truncate">{item.title}</p>
                  <p className="text-xs text-muted-foreground truncate mt-1">
                    {item.content.substring(0, 100)}...
                  </p>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={getCategoryColor(item.category)}>
                  {item.category}
                </Badge>
              </TableCell>
              <TableCell>
                {item.subcategory ? (
                  <span className="text-sm">{item.subcategory}</span>
                ) : (
                  <span className="text-sm text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={item.active}
                    onCheckedChange={(checked) => onToggleActive(item, checked)}
                  />
                  <span className="text-sm text-muted-foreground">
                    {item.active ? "Activo" : "Inactivo"}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger>
                    <Button variant="ghost" className="h-8 w-8 p-0">
                      <span className="sr-only">Abrir menú</span>
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onEdit(item)}>
                      <Eye className="mr-2 h-4 w-4" />
                      Ver completo
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onEdit(item)}>
                      <Edit className="mr-2 h-4 w-4" />
                      Editar
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onDelete(item)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Eliminar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
