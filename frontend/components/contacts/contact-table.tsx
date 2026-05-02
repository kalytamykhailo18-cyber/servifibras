"use client";

import { useRouter } from "next/navigation";
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
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import EmailIcon from "@mui/icons-material/Email";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import PeopleIcon from "@mui/icons-material/People";
import PhoneIcon from "@mui/icons-material/Phone";
import VisibilityIcon from "@mui/icons-material/Visibility";
import type { Contact } from "@/types";
import { CONTACT_TYPE_LABELS, CHANNEL_LABELS } from "@/types";

interface ContactTableProps {
  contacts: Contact[];
  onEdit: (contact: Contact) => void;
  onDelete: (contact: Contact) => void;
}

const AVATAR_GRADIENTS = [
  "from-blue-500 to-cyan-400",
  "from-emerald-500 to-teal-400",
  "from-purple-500 to-pink-400",
  "from-orange-500 to-amber-400",
  "from-indigo-500 to-violet-400",
  "from-rose-500 to-pink-400",
];

const TYPE_TINT: Record<string, { dot: string; pill: string }> = {
  MINORISTA:   { dot: "bg-blue-500",    pill: "bg-blue-50 text-blue-700 border-blue-200/70" },
  MAYORISTA:   { dot: "bg-violet-500",  pill: "bg-violet-50 text-violet-700 border-violet-200/70" },
  EMPRENDEDOR: { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 border-emerald-200/70" },
  INDUSTRIAL:  { dot: "bg-orange-500",  pill: "bg-orange-50 text-orange-700 border-orange-200/70" },
};

const CHANNEL_TINT: Record<string, { dot: string; pill: string }> = {
  WHATSAPP:           { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 border-emerald-200/70" },
  FACEBOOK:           { dot: "bg-blue-500",    pill: "bg-blue-50 text-blue-700 border-blue-200/70" },
  INSTAGRAM:          { dot: "bg-pink-500",    pill: "bg-pink-50 text-pink-700 border-pink-200/70" },
  MERCADOLIBRE:       { dot: "bg-amber-500",   pill: "bg-amber-50 text-amber-700 border-amber-200/70" },
  TIENDANUBE_WEBCHAT: { dot: "bg-violet-500",  pill: "bg-violet-50 text-violet-700 border-violet-200/70" },
};

const fallback = { dot: "bg-slate-400", pill: "bg-slate-50 text-slate-600 border-slate-200" };

const initials = (name: string | null) => {
  if (!name) return "?";
  const parts = name.split(" ").filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
};

const gradientFor = (name: string | null) =>
  AVATAR_GRADIENTS[(name?.charCodeAt(0) ?? 0) % AVATAR_GRADIENTS.length];

export function ContactTable({ contacts, onEdit, onDelete }: ContactTableProps) {
  const router = useRouter();

  if (contacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-16 text-center">
        <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-slate-200 to-slate-100 text-slate-400">
          <PeopleIcon sx={{ fontSize: 28 }} />
        </span>
        <h3 className="text-base font-semibold text-slate-900">Sin contactos</h3>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          No se encontraron contactos. Probá ajustar los filtros o crear uno nuevo.
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
              Nombre
            </TableHead>
            <TableHead className="h-11 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Contacto
            </TableHead>
            <TableHead className="h-11 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Tipo
            </TableHead>
            <TableHead className="h-11 px-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Canal
            </TableHead>
            <TableHead className="h-11 px-4 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Acciones
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((contact) => {
            const typeTint = TYPE_TINT[contact.type] ?? fallback;
            const channelTint = contact.channel
              ? CHANNEL_TINT[contact.channel] ?? fallback
              : null;

            return (
              <TableRow
                key={contact.id}
                className="border-b border-slate-100 transition-colors duration-150 last:border-b-0 hover:bg-blue-50/30"
              >
                <TableCell className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br ${gradientFor(contact.name)} text-xs font-semibold text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_2px_8px_-2px_rgb(15_23_42/0.18)]`}
                    >
                      {initials(contact.name)}
                    </span>
                    <span className="font-medium text-slate-900">
                      {contact.name || (
                        <span className="font-normal italic text-slate-400">Sin nombre</span>
                      )}
                    </span>
                  </div>
                </TableCell>

                <TableCell className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    {contact.phone && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-slate-700">
                        <PhoneIcon sx={{ fontSize: 14 }} className="text-slate-400" />
                        {contact.phone}
                      </span>
                    )}
                    {contact.email && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-slate-500">
                        <EmailIcon sx={{ fontSize: 14 }} className="text-slate-400" />
                        <span className="truncate">{contact.email}</span>
                      </span>
                    )}
                    {!contact.phone && !contact.email && (
                      <span className="text-sm italic text-slate-400">Sin datos</span>
                    )}
                  </div>
                </TableCell>

                <TableCell className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${typeTint.pill}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${typeTint.dot}`} />
                    {CONTACT_TYPE_LABELS[contact.type]}
                  </span>
                </TableCell>

                <TableCell className="px-4 py-3">
                  {channelTint && contact.channel ? (
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${channelTint.pill}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${channelTint.dot}`} />
                      {CHANNEL_LABELS[contact.channel]}
                    </span>
                  ) : (
                    <span className="text-sm text-slate-400">—</span>
                  )}
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
                        onClick={() => router.push(`/contacts/${contact.id}`)}
                        className="group cursor-pointer rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 focus:bg-blue-50 focus:text-blue-700"
                      >
                        <span className="mr-2.5 grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-blue-500 to-cyan-400 text-white">
                          <VisibilityIcon sx={{ fontSize: 14 }} />
                        </span>
                        Ver detalles
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onEdit(contact)}
                        className="group cursor-pointer rounded-lg px-2.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 focus:bg-amber-50 focus:text-amber-700"
                      >
                        <span className="mr-2.5 grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-amber-500 to-orange-400 text-white">
                          <EditIcon sx={{ fontSize: 14 }} />
                        </span>
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="my-1.5 bg-slate-200/70" />
                      <DropdownMenuItem
                        onClick={() => onDelete(contact)}
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
