"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api/endpoints";
import { useAuthStore, selectUser } from "@/lib/store/auth-store";
import { USER_ROLE_LABELS, type User } from "@/types";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import SendIcon from "@mui/icons-material/Send";
import { toast } from "sonner";

interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  onTransferred: () => void;
}

export function TransferDialog({
  open,
  onOpenChange,
  conversationId,
  onTransferred,
}: TransferDialogProps) {
  const me = useAuthStore(selectUser);
  const [users, setUsers] = useState<User[]>([]);
  const [targetUserId, setTargetUserId] = useState<string>("");
  const [note, setNote] = useState("");
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load the user list when the dialog opens. Filter out the current user —
  // transferring to yourself is meaningless.
  useEffect(() => {
    if (!open) return;
    setTargetUserId("");
    setNote("");
    setIsLoadingUsers(true);
    api.users
      .list()
      .then((all) => setUsers(all.filter((u) => u.id !== me?.id && u.active !== false)))
      .catch((err: any) => toast.error(err?.message || "Error al cargar usuarios"))
      .finally(() => setIsLoadingUsers(false));
  }, [open, me?.id]);

  const groupedUsers = useMemo(() => {
    const byRole = new Map<string, User[]>();
    for (const u of users) {
      const list = byRole.get(u.role) ?? [];
      list.push(u);
      byRole.set(u.role, list);
    }
    return [...byRole.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [users]);

  const handleSubmit = async () => {
    if (!targetUserId) {
      toast.error("Elegí un destinatario");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await api.conversations.transfer(conversationId, {
        targetUserId,
        note: note.trim() || undefined,
      });
      if (!res.success) {
        toast.error("No se pudo transferir la conversación");
        return;
      }
      toast.success("Conversación transferida");
      onOpenChange(false);
      onTransferred();
    } catch (err: any) {
      toast.error(err?.response?.data?.error || err?.message || "Error al transferir");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border border-slate-200/70 bg-white/95 p-6 shadow-[0_24px_60px_-12px_rgb(15_23_42/0.25)] backdrop-blur-xl backdrop-saturate-150 sm:max-w-md">
        <DialogHeader className="space-y-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(59_130_246/0.45)]">
            <SwapHorizIcon sx={{ fontSize: 24 }} />
          </span>
          <DialogTitle className="text-xl font-bold tracking-tight text-slate-900">
            Transferir conversación
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-slate-600">
            Elegí a quién pasarle la conversación. Podés agregar una nota interna —
            sólo la ve el equipo, nunca el cliente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Destinatario
            </label>
            <Select
              value={targetUserId}
              onValueChange={(v) => setTargetUserId(v ?? "")}
              disabled={isLoadingUsers}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={isLoadingUsers ? "Cargando..." : "Elegí un usuario"} />
              </SelectTrigger>
              <SelectContent>
                {groupedUsers.map(([role, list]) => (
                  <div key={role}>
                    <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {USER_ROLE_LABELS[role as keyof typeof USER_ROLE_LABELS] ?? role}
                    </div>
                    {list.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Nota interna (opcional)
            </label>
            <Textarea
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Contexto para quien recibe la conversación..."
              className="resize-none"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              No la ve el cliente. Sólo aparece en el panel.
            </p>
          </div>
        </div>

        <DialogFooter className="mt-2 gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !targetUserId}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-5 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(59_130_246/0.5)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Transfiriendo...
              </>
            ) : (
              <>
                <SendIcon sx={{ fontSize: 16 }} />
                Transferir
              </>
            )}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
