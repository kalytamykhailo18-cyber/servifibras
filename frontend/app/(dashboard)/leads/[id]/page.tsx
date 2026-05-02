"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api/endpoints";
import type { Lead, User } from "@/types";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CancelIcon from "@mui/icons-material/Cancel";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import EmailIcon from "@mui/icons-material/Email";
import InventoryIcon from "@mui/icons-material/Inventory";
import NotesIcon from "@mui/icons-material/Notes";
import PersonIcon from "@mui/icons-material/Person";
import PhoneIcon from "@mui/icons-material/Phone";
import { toast } from "sonner";
import { safeFormatDate, safeFormatDistanceToNow } from "@/lib/date";
import { formatNumber } from "@/lib/format";
import { LeadStatus, CHANNEL_LABELS, LEAD_STATUS_LABELS } from "@/types";

const STATUS_TINT: Record<string, { dot: string; pill: string }> = {
  NEW:         { dot: "bg-blue-500",    pill: "bg-blue-50 text-blue-700 border-blue-200/70" },
  CONTACTED:   { dot: "bg-violet-500",  pill: "bg-violet-50 text-violet-700 border-violet-200/70" },
  QUOTE_SENT:  { dot: "bg-amber-500",   pill: "bg-amber-50 text-amber-700 border-amber-200/70" },
  NEGOTIATING: { dot: "bg-orange-500",  pill: "bg-orange-50 text-orange-700 border-orange-200/70" },
  WON:         { dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 border-emerald-200/70" },
  LOST:        { dot: "bg-slate-400",   pill: "bg-slate-50 text-slate-600 border-slate-200" },
};
const fallback = { dot: "bg-slate-400", pill: "bg-slate-50 text-slate-600 border-slate-200" };

const SECTION_LABEL = "mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500";

export default function LeadDetailPage() {
  const router = useRouter();
  const params = useParams();
  const leadId = params.id as string;
  const [lead, setLead] = useState<Lead | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [wonAmount, setWonAmount] = useState<number>(0);
  const [lostReason, setLostReason] = useState<string>("");

  const fetchLead = async () => {
    try {
      setIsLoading(true);
      const data = await api.leads.getById(leadId);
      setLead(data);
      setWonAmount(data.wonAmount || 0);
      setLostReason(data.lostReason || "");
    } catch (error: any) {
      toast.error(error.message || "Error al cargar oportunidad");
      router.push("/leads");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const data = await api.users.list();
      setUsers(data);
    } catch (error) {
      console.error("Error fetching users:", error);
    }
  };

  useEffect(() => {
    fetchLead();
    fetchUsers();
  }, [leadId]);

  const handleAssign = async (userId: string | null) => {
    if (!lead || !userId) return;
    try {
      await api.leads.assign(lead.id, userId);
      toast.success("Oportunidad asignada correctamente");
      fetchLead();
    } catch (error: any) {
      toast.error(error.message || "Error al asignar oportunidad");
    }
  };

  const handleStatusChange = async (status: LeadStatus) => {
    if (!lead) return;
    try {
      await api.leads.updateStatus(lead.id, {
        status,
        ...(status === LeadStatus.WON && wonAmount > 0 ? { wonAmount } : {}),
        ...(status === LeadStatus.LOST && lostReason ? { lostReason } : {}),
      });
      toast.success("Estado actualizado correctamente");
      fetchLead();
    } catch (error: any) {
      toast.error(error.message || "Error al actualizar estado");
    }
  };

  if (isLoading || !lead) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-36 rounded-full" />
        <Skeleton className="h-20 rounded-2xl" />
        <div className="grid gap-6 md:grid-cols-3">
          <div className="space-y-4 md:col-span-2">
            <Skeleton className="h-44 rounded-2xl" />
            <Skeleton className="h-56 rounded-2xl" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-44 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  const statusTint = STATUS_TINT[lead.status] ?? fallback;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* TOP BAR */}
      <button
        type="button"
        onClick={() => router.push("/leads")}
        className="group inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900 active:scale-[0.97]"
      >
        <ArrowBackIcon
          sx={{ fontSize: 16 }}
          className="transition-transform duration-300 group-hover:-translate-x-0.5"
        />
        Volver al Pipeline
      </button>

      {/* IDENTITY ROW */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900">
            {lead.contact?.name || lead.contact?.phone || "Oportunidad"}
          </h1>
          <p className="text-sm text-slate-500">
            Creada {safeFormatDistanceToNow(lead.createdAt)}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${statusTint.pill}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${statusTint.dot}`} />
          {LEAD_STATUS_LABELS[lead.status]}
        </span>
      </div>

      {/* MAIN GRID */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* LEFT — DETAILS */}
        <div className="space-y-4 md:col-span-2">
          {/* Contact Information */}
          <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <h3 className={SECTION_LABEL}>Información del Contacto</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <DetailRow icon={<PersonIcon sx={{ fontSize: 14 }} />} tint="bg-blue-50 text-blue-600" label="Nombre" value={lead.contact?.name || "N/A"} />
              <DetailRow icon={<PhoneIcon sx={{ fontSize: 14 }} />} tint="bg-emerald-50 text-emerald-600" label="Teléfono" value={lead.contact?.phone || "N/A"} />
              <DetailRow icon={<EmailIcon sx={{ fontSize: 14 }} />} tint="bg-violet-50 text-violet-600" label="Email" value={lead.contact?.email || "N/A"} />
              <DetailRow
                icon={<InventoryIcon sx={{ fontSize: 14 }} />}
                tint="bg-amber-50 text-amber-600"
                label="Canal de Origen"
                value={CHANNEL_LABELS[lead.source as keyof typeof CHANNEL_LABELS] || "—"}
              />
            </div>
          </div>

          {/* Lead Details */}
          <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <h3 className={SECTION_LABEL}>Detalles de la Oportunidad</h3>
            <div className="space-y-4">
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Producto de Interés
                </p>
                <p className="text-sm font-medium text-slate-900">
                  {lead.productInterest || (
                    <span className="font-normal italic text-slate-400">No especificado</span>
                  )}
                </p>
              </div>

              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Valor Estimado
                </p>
                {lead.estimatedValue && lead.estimatedValue > 0 ? (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-400 px-3 py-1 text-base font-bold tabular-nums text-white shadow-[0_4px_12px_-2px_rgb(16_185_129/0.45)]">
                    ${formatNumber(lead.estimatedValue)} USD
                  </span>
                ) : (
                  <p className="text-sm italic text-slate-400">Sin valor estimado</p>
                )}
              </div>

              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Notas
                </p>
                {lead.notes ? (
                  <div className="flex gap-2.5 rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                      <NotesIcon sx={{ fontSize: 14 }} />
                    </span>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {lead.notes}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm italic text-slate-400">Sin notas</p>
                )}
              </div>
            </div>
          </div>

          {/* Won card */}
          {lead.status === LeadStatus.WON && lead.wonAmount && (
            <div className="overflow-hidden rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-teal-50/50 p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-400 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(16_185_129/0.45)]">
                  <CheckCircleIcon sx={{ fontSize: 22 }} />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-emerald-900">Oportunidad Ganada</h3>
                  <p className="mt-0.5 text-[11px] text-emerald-700">Monto registrado</p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-700">
                    ${formatNumber(lead.wonAmount)} USD
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Lost card */}
          {lead.status === LeadStatus.LOST && lead.lostReason && (
            <div className="overflow-hidden rounded-2xl border border-red-200/70 bg-gradient-to-br from-red-50 to-rose-50/50 p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-red-500 to-rose-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_8px_20px_-6px_rgb(239_68_68/0.45)]">
                  <CancelIcon sx={{ fontSize: 22 }} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-red-900">Oportunidad Perdida</h3>
                  <p className="mt-0.5 text-[11px] text-red-700">Razón registrada</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-red-800">
                    {lead.lostReason}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — ACTIONS */}
        <div className="space-y-4">
          {/* Assign user */}
          <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <h3 className={SECTION_LABEL}>Asignar a Usuario</h3>
            <Select
              value={lead.assignedTo || ""}
              onValueChange={handleAssign}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Seleccionar usuario" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Sin asignar</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status changer */}
          <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <h3 className={SECTION_LABEL}>Cambiar Estado</h3>
            <div className="space-y-3">
              <Select
                value={lead.status}
                onValueChange={(value) => handleStatusChange(value as LeadStatus)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LEAD_STATUS_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {lead.status === LeadStatus.WON && (
                <div className="space-y-2 rounded-xl border border-emerald-200/70 bg-emerald-50/40 p-3">
                  <label htmlFor="wonAmount" className="block text-[11px] font-medium uppercase tracking-wide text-emerald-700">
                    Monto Ganado (USD)
                  </label>
                  <Input
                    id="wonAmount"
                    type="number"
                    value={wonAmount}
                    onChange={(e) => setWonAmount(parseFloat(e.target.value) || 0)}
                    placeholder="0"
                  />
                  <button
                    type="button"
                    onClick={() => handleStatusChange(LeadStatus.WON)}
                    className="inline-flex h-9 w-full items-center justify-center rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(16_185_129/0.5)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(16_185_129/0.65)] active:translate-y-0 active:scale-[0.97]"
                  >
                    Guardar Monto
                  </button>
                </div>
              )}

              {lead.status === LeadStatus.LOST && (
                <div className="space-y-2 rounded-xl border border-red-200/70 bg-red-50/40 p-3">
                  <label htmlFor="lostReason" className="block text-[11px] font-medium uppercase tracking-wide text-red-700">
                    Razón de Pérdida
                  </label>
                  <Textarea
                    id="lostReason"
                    value={lostReason}
                    onChange={(e) => setLostReason(e.target.value)}
                    placeholder="Precio muy alto, eligió competidor, etc."
                    rows={3}
                    className="resize-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleStatusChange(LeadStatus.LOST)}
                    className="inline-flex h-9 w-full items-center justify-center rounded-xl bg-gradient-to-r from-red-600 to-rose-500 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgb(239_68_68/0.5)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-6px_rgb(239_68_68/0.65)] active:translate-y-0 active:scale-[0.97]"
                  >
                    Guardar Razón
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Quick info */}
          <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <h3 className={SECTION_LABEL}>Información</h3>
            <div className="space-y-2 text-sm">
              <InfoRow label="ID" value={<span className="font-mono text-xs text-slate-700">{lead.id.slice(0, 8)}</span>} />
              <InfoRow label="Creada" value={safeFormatDate(lead.createdAt, "P")} />
              <InfoRow label="Actualizada" value={safeFormatDate(lead.updatedAt, "P")} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  tint,
  label,
  value,
}: {
  icon: React.ReactNode;
  tint: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${tint}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="truncate text-sm font-medium text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="truncate text-xs font-medium text-slate-700">{value}</span>
    </div>
  );
}
