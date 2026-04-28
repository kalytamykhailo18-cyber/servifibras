"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { RefreshCw, Plus, Search, AlertCircle, Users } from "lucide-react";
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
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-48 mb-2" />
            <Skeleton className="h-4 w-96" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>

        <Skeleton className="h-20" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  // ========================================================================
  // RENDER: MAIN CONTENT
  // ========================================================================

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Contactos</h1>
          <p className="text-muted-foreground">
            Gestiona la base de datos de clientes
          </p>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleRefresh} variant="outline" size="sm">
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
          <Button onClick={handleCreateClick}>
            <Plus className="h-4 w-4 mr-2" />
            Nuevo Contacto
          </Button>
        </div>
      </div>

      {/* FILTERS */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, teléfono o email..."
            value={filters.search || ""}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Type Filter */}
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

        {/* Results Count */}
        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4" />
          <span>{totalCount} contactos</span>
        </div>
      </div>

      {/* ERROR STATE */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* CONTACTS TABLE */}
      <ContactTable
        contacts={contacts}
        onEdit={handleEditClick}
        onDelete={handleDeleteClick}
      />

      {/* PAGINATION */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(currentPage - 1)}
            disabled={currentPage === 1 || isLoading}
          >
            Anterior
          </Button>

          <span className="text-sm text-muted-foreground">
            Página {currentPage} de {totalPages}
          </span>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handlePageChange(currentPage + 1)}
            disabled={currentPage === totalPages || isLoading}
          >
            Siguiente
          </Button>
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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar contacto?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Se eliminará permanentemente el contacto{" "}
              <strong>{deleteContact?.name || "sin nombre"}</strong> de la base de datos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
