"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api/endpoints";
import type { ContactWithRelations } from "@/types";
import { CONTACT_TYPE_LABELS, CHANNEL_LABELS, CONVERSATION_STATUS_LABELS } from "@/types";
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import EditIcon from '@mui/icons-material/Edit';
import EmailIcon from '@mui/icons-material/Email';
import InventoryIcon from '@mui/icons-material/Inventory';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import PhoneIcon from '@mui/icons-material/Phone';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import { safeFormatDistanceToNow } from "@/lib/date";
import { formatNumber } from "@/lib/format";

export default function ContactDetailPage() {
  const params = useParams();
  const router = useRouter();
  const contactId = params.id as string;

  const [contact, setContact] = useState<ContactWithRelations | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ========================================================================
  // FETCH CONTACT
  // ========================================================================

  const fetchContact = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await api.contacts.getById(contactId);
      setContact(data);
    } catch (err: any) {
      setError(err.message || "Error al cargar contacto");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchContact();
  }, [contactId]);

  // ========================================================================
  // RENDER: LOADING STATE
  // ========================================================================

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-24 rounded-full" />
          <Skeleton className="h-10 w-44 rounded-full" />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4">
            <Skeleton className="h-72 rounded-2xl" />
            <Skeleton className="h-56 rounded-2xl" />
          </div>
          <div className="space-y-4 lg:col-span-2">
            <Skeleton className="h-12 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  // ========================================================================
  // RENDER: ERROR STATE
  // ========================================================================

  if (error || !contact) {
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => router.push("/contacts")}
          className="group inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900"
        >
          <ArrowBackIcon
            sx={{ fontSize: 16 }}
            className="transition-transform duration-300 group-hover:-translate-x-0.5"
          />
          Volver
        </button>
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200/70 bg-red-50/80 px-4 py-3 text-sm text-red-700">
          <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-red-500" />
          <span>{error || "Contacto no encontrado"}</span>
        </div>
      </div>
    );
  }

  // ========================================================================
  // RENDER: MAIN CONTENT
  // ========================================================================

  const conversationsCount = contact.conversations?.length || 0;
  const leadsCount = contact.leads?.length || 0;
  const ordersCount = contact.orders?.length || 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* TOP BAR */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.push("/contacts")}
          className="group inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-slate-600 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900 active:scale-[0.97]"
        >
          <ArrowBackIcon
            sx={{ fontSize: 16 }}
            className="transition-transform duration-300 group-hover:-translate-x-0.5"
          />
          Volver
        </button>

        <button
          type="button"
          className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 hover:shadow-[0_8px_20px_-6px_rgb(245_158_11/0.25)] active:translate-y-0 active:scale-[0.97]"
        >
          <EditIcon sx={{ fontSize: 16 }} />
          Editar Contacto
        </button>
      </div>

      {/* MAIN CONTENT GRID */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* SIDEBAR - Contact Info */}
        <div className="space-y-4">
          {/* CONTACT INFORMATION */}
          <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            {/* Identity header — gradient top with avatar */}
            <div className="relative flex flex-col items-center gap-3 bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 px-5 pb-5 pt-7 text-center">
              <span className="grid h-16 w-16 place-items-center rounded-full bg-white text-xl font-bold text-emerald-700 shadow-[0_8px_20px_-4px_rgb(15_23_42/0.25)]">
                {contact.name
                  ? contact.name
                      .split(" ")
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((p) => p[0])
                      .join("")
                      .toUpperCase()
                  : "?"}
              </span>
              <div>
                <h2 className="text-lg font-bold tracking-tight text-white">
                  {contact.name || <span className="italic opacity-80">Sin nombre</span>}
                </h2>
                <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  {CONTACT_TYPE_LABELS[contact.type]}
                </span>
              </div>
            </div>

            {/* Detail rows */}
            <div className="space-y-3 p-5 text-sm">
              {contact.phone && (
                <div className="flex items-center gap-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600">
                    <PhoneIcon sx={{ fontSize: 14 }} />
                  </span>
                  <span className="text-slate-700">{contact.phone}</span>
                </div>
              )}

              {contact.email && (
                <div className="flex items-center gap-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-600">
                    <EmailIcon sx={{ fontSize: 14 }} />
                  </span>
                  <span className="break-all text-slate-700">{contact.email}</span>
                </div>
              )}

              {contact.channel && (
                <div className="flex items-center gap-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
                    <LocalOfferIcon sx={{ fontSize: 14 }} />
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    {CHANNEL_LABELS[contact.channel]}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* STATISTICS */}
          <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]">
            <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Estadísticas
            </h3>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-blue-100 bg-blue-50/40 px-3 py-2.5">
                <div className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 text-white">
                    <ChatBubbleOutlineIcon sx={{ fontSize: 14 }} />
                  </span>
                  Conversaciones
                </div>
                <span className="text-base font-bold tabular-nums text-blue-700">{conversationsCount}</span>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-orange-100 bg-orange-50/40 px-3 py-2.5">
                <div className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-orange-500 to-red-400 text-white">
                    <TrendingUpIcon sx={{ fontSize: 14 }} />
                  </span>
                  Oportunidades
                </div>
                <span className="text-base font-bold tabular-nums text-orange-700">{leadsCount}</span>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-xl border border-green-100 bg-green-50/40 px-3 py-2.5">
                <div className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-green-500 to-emerald-400 text-white">
                    <InventoryIcon sx={{ fontSize: 14 }} />
                  </span>
                  Pedidos
                </div>
                <span className="text-base font-bold tabular-nums text-green-700">{ordersCount}</span>
              </div>
            </div>
          </div>
        </div>

        {/* MAIN CONTENT - Tabs */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="conversations" className="w-full">
            <TabsList className="grid h-12 w-full grid-cols-3 gap-1 rounded-2xl border border-slate-200/70 bg-slate-100/60 p-1.5">
              <TabsTrigger
                value="conversations"
                className="group relative gap-2 rounded-xl border-0 px-3 py-2 text-sm font-medium text-slate-600 transition-all duration-200 hover:text-slate-900 data-active:bg-white data-active:text-blue-700 data-active:shadow-[0_4px_12px_-2px_rgb(15_23_42/0.08)]"
              >
                <ChatBubbleOutlineIcon sx={{ fontSize: 16 }} />
                <span className="hidden sm:inline">Conversaciones</span>
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-200/80 px-1.5 text-[10px] font-bold text-slate-700 tabular-nums group-data-active:bg-blue-100 group-data-active:text-blue-700">
                  {conversationsCount}
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="leads"
                className="group relative gap-2 rounded-xl border-0 px-3 py-2 text-sm font-medium text-slate-600 transition-all duration-200 hover:text-slate-900 data-active:bg-white data-active:text-orange-700 data-active:shadow-[0_4px_12px_-2px_rgb(15_23_42/0.08)]"
              >
                <TrendingUpIcon sx={{ fontSize: 16 }} />
                <span className="hidden sm:inline">Oportunidades</span>
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-200/80 px-1.5 text-[10px] font-bold text-slate-700 tabular-nums group-data-active:bg-orange-100 group-data-active:text-orange-700">
                  {leadsCount}
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="orders"
                className="group relative gap-2 rounded-xl border-0 px-3 py-2 text-sm font-medium text-slate-600 transition-all duration-200 hover:text-slate-900 data-active:bg-white data-active:text-green-700 data-active:shadow-[0_4px_12px_-2px_rgb(15_23_42/0.08)]"
              >
                <InventoryIcon sx={{ fontSize: 16 }} />
                <span className="hidden sm:inline">Pedidos</span>
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-200/80 px-1.5 text-[10px] font-bold text-slate-700 tabular-nums group-data-active:bg-green-100 group-data-active:text-green-700">
                  {ordersCount}
                </span>
              </TabsTrigger>
            </TabsList>

            {/* CONVERSATIONS TAB */}
            <TabsContent value="conversations" className="mt-4 space-y-3">
              {contact.conversations && contact.conversations.length > 0 ? (
                contact.conversations.map((conversation) => (
                  <Link
                    key={conversation.id}
                    href={`/conversations/${conversation.id}`}
                    className="group block rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)] transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_12px_28px_-8px_rgb(15_23_42/0.15)]"
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="flex flex-wrap gap-1.5">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200/70 bg-blue-50 px-2.5 py-0.5 text-[11px] font-medium text-blue-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                          {CHANNEL_LABELS[conversation.channel]}
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                          {CONVERSATION_STATUS_LABELS[conversation.status]}
                        </span>
                      </div>
                      {conversation.lastMessageAt && (
                        <span className="shrink-0 text-xs text-slate-500">
                          {safeFormatDistanceToNow(conversation.lastMessageAt)}
                        </span>
                      )}
                    </div>
                    {conversation.lastMessage && (
                      <p className="line-clamp-2 text-sm leading-relaxed text-slate-600">
                        {conversation.lastMessage}
                      </p>
                    )}
                  </Link>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-14 text-center">
                  <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-slate-200 to-slate-100 text-slate-400">
                    <ChatBubbleOutlineIcon sx={{ fontSize: 24 }} />
                  </span>
                  <p className="text-sm font-medium text-slate-700">Sin conversaciones</p>
                  <p className="mt-0.5 text-xs text-slate-500">Aún no hay conversaciones con este contacto.</p>
                </div>
              )}
            </TabsContent>

            {/* LEADS TAB */}
            <TabsContent value="leads" className="mt-4 space-y-3">
              {contact.leads && contact.leads.length > 0 ? (
                contact.leads.map((lead) => (
                  <div
                    key={lead.id}
                    className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-orange-200/70 bg-orange-50 px-2.5 py-0.5 text-[11px] font-medium text-orange-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                          {lead.status}
                        </span>
                        {lead.productInterest && (
                          <p className="mt-2 text-sm font-medium text-slate-900">
                            {lead.productInterest}
                          </p>
                        )}
                      </div>
                      {lead.estimatedValue && (
                        <span className="shrink-0 rounded-lg bg-gradient-to-br from-orange-500 to-red-400 px-2.5 py-1 text-sm font-semibold tabular-nums text-white shadow-[0_4px_10px_-2px_rgb(249_115_22/0.45)]">
                          ${formatNumber(lead.estimatedValue)}
                        </span>
                      )}
                    </div>
                    {lead.notes && (
                      <p className="text-sm leading-relaxed text-slate-600">{lead.notes}</p>
                    )}
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-14 text-center">
                  <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-orange-100 to-amber-50 text-orange-400">
                    <TrendingUpIcon sx={{ fontSize: 24 }} />
                  </span>
                  <p className="text-sm font-medium text-slate-700">Sin oportunidades</p>
                  <p className="mt-0.5 text-xs text-slate-500">No hay oportunidades de venta para este contacto.</p>
                </div>
              )}
            </TabsContent>

            {/* ORDERS TAB */}
            <TabsContent value="orders" className="mt-4 space-y-3">
              {contact.orders && contact.orders.length > 0 ? (
                contact.orders.map((order) => (
                  <div
                    key={order.id}
                    className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_0_rgb(15_23_42/0.04)]"
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-semibold tracking-tight text-slate-900">
                          {order.orderNumber}
                        </p>
                        <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-green-200/70 bg-green-50 px-2.5 py-0.5 text-[11px] font-medium text-green-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                          {order.status}
                        </span>
                      </div>
                      <span className="shrink-0 rounded-lg bg-gradient-to-br from-green-500 to-emerald-400 px-2.5 py-1 text-sm font-semibold tabular-nums text-white shadow-[0_4px_10px_-2px_rgb(34_197_94/0.45)]">
                        ${formatNumber(order.amount)} {order.currency}
                      </span>
                    </div>
                    {order.trackingNumber && (
                      <p className="text-xs text-slate-500">
                        <span className="font-medium text-slate-700">Tracking:</span>{" "}
                        <span className="font-mono">{order.trackingNumber}</span>
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-14 text-center">
                  <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-green-100 to-emerald-50 text-green-400">
                    <InventoryIcon sx={{ fontSize: 24 }} />
                  </span>
                  <p className="text-sm font-medium text-slate-700">Sin pedidos</p>
                  <p className="mt-0.5 text-xs text-slate-500">No hay pedidos registrados para este contacto.</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
