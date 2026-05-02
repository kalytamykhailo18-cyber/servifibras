"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ContactFormDialog } from "@/components/contacts/contact-form-dialog";
import { ContactTable } from "@/components/contacts/contact-table";
import { api } from "@/lib/api/endpoints";
import type { Contact, ContactFormData, ContactFilters, GetContactsParams } from "@/types";
import { ContactType, Channel, CONTACT_TYPE_LABELS, CHANNEL_LABELS } from "@/types";
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import PeopleIcon from '@mui/icons-material/People';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { toast } from "sonner";

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [filters, setFilters] = useState<ContactFilters>({
    type: "ALL",
    channel: "ALL",
    search: "",
  });

  // Dialog states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete confirmation
  const [deleteContact, setDeleteContact] = useState<Contact | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ========================================================================
  // FETCH CONTACTS
  // ========================================================================

  const fetchContacts = async (page: number = 1) => {
    try {
      setIsLoading(true);
      setError(null);

      const params: GetContactsParams = {
        page,
        limit: 20,
      };

      if (filters.type && filters.type !== "ALL") {
        params.type = filters.type;
      }
      if (filters.channel && filters.channel !== "ALL") {
        params.channel = filters.channel;
      }
      if (filters.search && filters.search.trim().length > 0) {
        params.search = filters.search.trim();
      }

      const response = await api.contacts.getAll(params);

      setContacts(response.contacts);
      setTotalCount(response.total);
      setCurrentPage(response.page);
      setTotalPages(response.totalPages);
    } catch (err: any) {
      setError(err.message || "Error al cargar contactos");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts(1);
  }, [filters]);

  // ========================================================================
  // HANDLERS
  // ========================================================================

  const handleCreateClick = () => {
    setEditingContact(null);
    setIsFormOpen(true);
  };

  const handleEditClick = (contact: Contact) => {
    setEditingContact(contact);
    setIsFormOpen(true);
  };

  const handleDeleteClick = (contact: Contact) => {
    setDeleteContact(contact);
  };

  const handleFormSubmit = async (data: ContactFormData) => {
    setIsSubmitting(true);
    try {
      if (editingContact) {
        // Update existing contact
        await api.contacts.update(editingContact.id, data);
        toast.success("Contacto actualizado correctamente");
      } else {
        // Create new contact
        await api.contacts.create(data);
        toast.success("Contacto creado correctamente");
      }
      fetchContacts(currentPage);
    } catch (err: any) {
      toast.error(err.message || "Error al guardar contacto");
      throw err; // Re-throw to prevent dialog close
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteContact) return;

    setIsDeleting(true);
    try {
      await api.contacts.delete(deleteContact.id);
      toast.success("Contacto eliminado correctamente");
      setDeleteContact(null);
      fetchContacts(currentPage);
    } catch (err: any) {
      toast.error(err.message || "Error al eliminar contacto");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRefresh = () => {
    fetchContacts(currentPage);
  };

  const handlePageChange = (page: number) => {
    fetchContacts(page);
  };

  const handleSearchChange = (value: string) => {
    setFilters({ ...filters, search: value });
    setCurrentPage(1);
  };

  const handleTypeChange = (value: string | null) => {
    if (!value) return;
    setFilters({
      ...filters,
      type: value === "ALL" ? "ALL" : (value as ContactType),
    });
    setCurrentPage(1);
  };

  const handleChannelChange = (value: string | null) => {
    if (!value) return;
    setFilters({
      ...filters,
      channel: value === "ALL" ? "ALL" : (value as Channel),
    });
    setCurrentPage(1);
  };

  // ========================================================================
  // RENDER: LOADING STATE
  // ========================================================================

  if (isLoading && contacts.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-4 w-64" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-28 rounded-full" />
            <Skeleton className="h-10 w-40 rounded-full" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Skeleton className="h-11 w-72 rounded-xl" />
          <Skeleton className="h-11 w-44 rounded-xl" />
          <Skeleton className="h-11 w-44 rounded-xl" />
        </div>

        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  // ========================================================================
  // RENDER: MAIN CONTENT
  // ========================================================================

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* PAGE HEADER */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(16_185_129/0.45)]">
            <PeopleIcon sx={{ fontSize: 22 }} />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Contactos</h1>
            <p className="text-sm text-muted-foreground">
              Gestiona la base de datos de clientes
            </p>
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isLoading}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 hover:shadow-[0_8px_20px_-6px_rgb(59_130_246/0.25)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
          >
            <RefreshIcon
              sx={{ fontSize: 16 }}
              className={isLoading ? "animate-spin" : ""}
            />
            Actualizar
          </button>

          <button
            type="button"
            onClick={handleCreateClick}
            className="group inline-flex h-10 items-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-emerald-600 to-teal-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(16_185_129/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(16_185_129/0.65)] active:translate-y-0 active:scale-[0.97]"
          >
            <AddIcon sx={{ fontSize: 18 }} />
            Nuevo Contacto
          </button>
        </div>
      </div>

      {/* FILTERS */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Search — leading icon recolours on focus */}
        <div className="group relative flex-1 min-w-[220px] max-w-sm">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors duration-200 group-focus-within:text-blue-600" />
          <Input
            placeholder="Buscar por nombre, teléfono o email..."
            value={filters.search || ""}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>

        <Select value={String(filters.type || "ALL")} onValueChange={handleTypeChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos los tipos</SelectItem>
            {Object.entries(CONTACT_TYPE_LABELS).map(([value, label]) => (
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

        {/* Count chip — pinned right */}
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span className="font-semibold text-slate-900">{totalCount}</span>
          contactos
        </span>
      </div>

      {/* ERROR STATE */}
      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200/70 bg-red-50/80 px-4 py-3 text-sm text-red-700">
          <ErrorOutlineIcon sx={{ fontSize: 18 }} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* CONTACTS TABLE */}
      <ContactTable
        contacts={contacts}
        onEdit={handleEditClick}
        onDelete={handleDeleteClick}
      />

      {/* PAGINATION */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-4">
          <button
            type="button"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1 || isLoading}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-700"
          >
            ← Anterior
          </button>

          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700">
            <span className="font-semibold text-slate-900">{currentPage}</span>
            <span className="text-slate-400">/</span>
            <span>{totalPages}</span>
          </span>

          <button
            type="button"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages || isLoading}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-700"
          >
            Siguiente →
          </button>
        </div>
      )}

      {/* FORM DIALOG */}
      <ContactFormDialog
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        contact={editingContact}
        onSubmit={handleFormSubmit}
        isLoading={isSubmitting}
      />

      {/* DELETE CONFIRMATION DIALOG */}
      <AlertDialog open={!!deleteContact} onOpenChange={() => setDeleteContact(null)}>
        <AlertDialogContent className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150">
          <AlertDialogHeader className="space-y-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-red-500 to-rose-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(239_68_68/0.45)]">
              <DeleteIcon sx={{ fontSize: 22 }} />
            </span>
            <AlertDialogTitle className="text-xl font-bold tracking-tight text-slate-900">
              ¿Eliminar contacto?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-slate-600">
              Esta acción no se puede deshacer. Se eliminará permanentemente el contacto{" "}
              <strong className="font-semibold text-slate-900">
                {deleteContact?.name || "sin nombre"}
              </strong>{" "}
              de la base de datos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel
              disabled={isDeleting}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] disabled:opacity-60"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(239_68_68/0.5)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(239_68_68/0.65)] active:translate-y-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0"
            >
              {isDeleting ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Eliminando...
                </>
              ) : (
                "Eliminar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
