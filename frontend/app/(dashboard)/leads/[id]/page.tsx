"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api/endpoints";
import type { Lead, User } from "@/types";
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import CancelIcon from '@mui/icons-material/Cancel';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import InventoryIcon from '@mui/icons-material/Inventory';
import PersonIcon from '@mui/icons-material/Person';
import { toast } from "sonner";
import { safeFormatDate, safeFormatDistanceToNow } from "@/lib/date";
import { formatNumber } from "@/lib/format";
import { LeadStatus, CHANNEL_LABELS, LEAD_STATUS_LABELS } from "@/types";

export default function LeadDetailPage() {
  const router = useRouter();
  const params = useParams();
  const leadId = params.id as string;
  const [lead, setLead] = useState<Lead | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [wonAmount, setWonAmount] = useState<number>(0);
  const [lostReason, setLostReason] = useState<string>("");

  // ========================================================================
  // FETCH DATA
  // ========================================================================

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

  // ========================================================================
  // HANDLERS
  // ========================================================================

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

  // ========================================================================
  // RENDER: LOADING STATE
  // ========================================================================

  if (isLoading || !lead) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  // ========================================================================
  // RENDER: MAIN CONTENT
  // ========================================================================

  const getStatusColor = (status: LeadStatus) => {
    switch (status) {
      case LeadStatus.NEW:
        return "bg-blue-100 text-blue-800";
      case LeadStatus.CONTACTED:
        return "bg-purple-100 text-purple-800";
      case LeadStatus.QUOTE_SENT:
        return "bg-yellow-100 text-yellow-800";
      case LeadStatus.NEGOTIATING:
        return "bg-orange-100 text-orange-800";
      case LeadStatus.WON:
        return "bg-green-100 text-green-800";
      case LeadStatus.LOST:
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* HEADER */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/leads")}>
          <ArrowBackIcon className="h-4 w-4 mr-2" />
          Volver al Pipeline
        </Button>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {lead.contact?.name || lead.contact?.phone || "Oportunidad"}
          </h1>
          <p className="text-muted-foreground">
            Creada{" "}
            {safeFormatDistanceToNow(lead.createdAt)}
          </p>
        </div>
        <Badge className={getStatusColor(lead.status)}>
          {LEAD_STATUS_LABELS[lead.status]}
        </Badge>
      </div>

      {/* MAIN GRID */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* LEFT COLUMN - Lead Details */}
        <div className="md:col-span-2 space-y-6">
          {/* Contact Information */}
          <Card>
            <CardHeader>
              <CardTitle>Información del Contacto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label>Nombre</Label>
                  <p className="text-sm font-medium">
                    {lead.contact?.name || "N/A"}
                  </p>
                </div>
                <div>
                  <Label>Teléfono</Label>
                  <p className="text-sm font-medium">
                    {lead.contact?.phone || "N/A"}
                  </p>
                </div>
                <div>
                  <Label>Email</Label>
                  <p className="text-sm font-medium">
                    {lead.contact?.email || "N/A"}
                  </p>
                </div>
                <div>
                  <Label>Canal de Origen</Label>
                  <Badge>
                    {CHANNEL_LABELS[lead.source as keyof typeof CHANNEL_LABELS]}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Lead Details */}
          <Card>
            <CardHeader>
              <CardTitle>Detalles de la Oportunidad</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Producto de Interés</Label>
                <p className="text-sm font-medium">
                  {lead.productInterest || "No especificado"}
                </p>
              </div>
              <div>
                <Label>Valor Estimado</Label>
                <p className="text-sm font-medium text-green-600">
                  ${formatNumber(lead.estimatedValue)} USD
                </p>
              </div>
              <div>
                <Label>Notas</Label>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {lead.notes || "Sin notas"}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Won/Lost Details */}
          {lead.status === LeadStatus.WON && lead.wonAmount && (
            <Card className="border-green-200 bg-green-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-700">
                  <CheckCircleIcon className="h-5 w-5" />
                  Oportunidad Ganada
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div>
                  <Label>Monto Ganado</Label>
                  <p className="text-2xl font-bold text-green-700">
                    ${formatNumber(lead.wonAmount)} USD
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {lead.status === LeadStatus.LOST && lead.lostReason && (
            <Card className="border-red-200 bg-red-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-700">
                  <CancelIcon className="h-5 w-5" />
                  Oportunidad Perdida
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div>
                  <Label>Razón</Label>
                  <p className="text-sm text-red-700">{lead.lostReason}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT COLUMN - Actions */}
        <div className="space-y-6">
          {/* Assign User */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Asignar a Usuario</CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={lead.assignedTo || ""}
                onValueChange={handleAssign}
              >
                <SelectTrigger>
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
            </CardContent>
          </Card>

          {/* Change Status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Cambiar Estado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                value={lead.status}
                onValueChange={(value) => handleStatusChange(value as LeadStatus)}
              >
                <SelectTrigger>
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

              {/* Won Amount Input */}
              {lead.status === LeadStatus.WON && (
                <div className="space-y-2">
                  <Label htmlFor="wonAmount">Monto Ganado (USD)</Label>
                  <Input
                    id="wonAmount"
                    type="number"
                    value={wonAmount}
                    onChange={(e) => setWonAmount(parseFloat(e.target.value) || 0)}
                    placeholder="0"
                  />
                  <Button
                    onClick={() =>
                      handleStatusChange(LeadStatus.WON)
                    }
                    className="w-full"
                    size="sm"
                  >
                    Guardar Monto
                  </Button>
                </div>
              )}

              {/* Lost Reason Input */}
              {lead.status === LeadStatus.LOST && (
                <div className="space-y-2">
                  <Label htmlFor="lostReason">Razón de Pérdida</Label>
                  <Textarea
                    id="lostReason"
                    value={lostReason}
                    onChange={(e) => setLostReason(e.target.value)}
                    placeholder="Precio muy alto, eligió competidor, etc."
                    rows={3}
                  />
                  <Button
                    onClick={() =>
                      handleStatusChange(LeadStatus.LOST)
                    }
                    className="w-full"
                    size="sm"
                    variant="destructive"
                  >
                    Guardar Razón
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Información</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">ID</span>
                <span className="font-mono text-xs">{lead.id.slice(0, 8)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Creada</span>
                <span>{safeFormatDate(lead.createdAt, "P")}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Actualizada</span>
                <span>{safeFormatDate(lead.updatedAt, "P")}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
