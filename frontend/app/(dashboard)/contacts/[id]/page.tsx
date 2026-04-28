"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

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
        <Skeleton className="h-10 w-full" />
        <div className="grid lg:grid-cols-3 gap-6">
          <Skeleton className="h-[400px]" />
          <div className="lg:col-span-2">
            <Skeleton className="h-[600px]" />
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
        <Button variant="ghost" onClick={() => router.push("/dashboard/contacts")}>
          <ArrowBackIcon className="h-4 w-4 mr-2" />
          Volver
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error || "Contacto no encontrado"}</AlertDescription>
        </Alert>
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
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => router.push("/dashboard/contacts")}>
          <ArrowBackIcon className="h-4 w-4 mr-2" />
          Volver
        </Button>

        <Button variant="outline" size="sm">
          <EditIcon className="h-4 w-4 mr-2" />
          Editar Contacto
        </Button>
      </div>

      {/* MAIN CONTENT GRID */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* SIDEBAR - Contact Info */}
        <div className="space-y-4">
          {/* Contact Information Card */}
          <Card>
            <CardHeader>
              <CardTitle>Información del Contacto</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="text-2xl font-bold mb-2">
                  {contact.name || <span className="text-muted-foreground italic">Sin nombre</span>}
                </h3>
                <Badge variant="outline" className="mb-4">
                  {CONTACT_TYPE_LABELS[contact.type]}
                </Badge>
              </div>

              {contact.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <PhoneIcon className="h-4 w-4 text-muted-foreground" />
                  <span>{contact.phone}</span>
                </div>
              )}

              {contact.email && (
                <div className="flex items-center gap-2 text-sm">
                  <EmailIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="break-all">{contact.email}</span>
                </div>
              )}

              {contact.channel && (
                <div className="flex items-center gap-2 text-sm">
                  <LocalOfferIcon className="h-4 w-4 text-muted-foreground" />
                  <Badge variant="outline">
                    {CHANNEL_LABELS[contact.channel]}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Statistics Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Estadísticas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <ChatBubbleOutlineIcon className="h-4 w-4 text-muted-foreground" />
                  <span>Conversaciones</span>
                </div>
                <Badge variant="outline">{conversationsCount}</Badge>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <TrendingUpIcon className="h-4 w-4 text-muted-foreground" />
                  <span>Oportunidades</span>
                </div>
                <Badge variant="outline">{leadsCount}</Badge>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <InventoryIcon className="h-4 w-4 text-muted-foreground" />
                  <span>Pedidos</span>
                </div>
                <Badge variant="outline">{ordersCount}</Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* MAIN CONTENT - Tabs */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="conversations" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="conversations">
                Conversaciones ({conversationsCount})
              </TabsTrigger>
              <TabsTrigger value="leads">
                Oportunidades ({leadsCount})
              </TabsTrigger>
              <TabsTrigger value="orders">
                Pedidos ({ordersCount})
              </TabsTrigger>
            </TabsList>

            {/* CONVERSATIONS TAB */}
            <TabsContent value="conversations" className="space-y-4">
              {contact.conversations && contact.conversations.length > 0 ? (
                contact.conversations.map((conversation) => (
                  <Link
                    key={conversation.id}
                    href={`/dashboard/conversations/${conversation.id}`}
                  >
                    <Card className="hover:shadow-md transition-shadow cursor-pointer">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex gap-2">
                            <Badge variant="outline">
                              {CHANNEL_LABELS[conversation.channel]}
                            </Badge>
                            <Badge variant="outline">
                              {CONVERSATION_STATUS_LABELS[conversation.status]}
                            </Badge>
                          </div>
                          {conversation.lastMessageAt && (
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(conversation.lastMessageAt), {
                                addSuffix: true,
                                locale: es,
                              })}
                            </span>
                          )}
                        </div>
                        {conversation.lastMessage && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {conversation.lastMessage}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </Link>
                ))
              ) : (
                <div className="text-center py-12 border rounded-lg">
                  <ChatBubbleOutlineIcon className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p className="text-muted-foreground">No hay conversaciones</p>
                </div>
              )}
            </TabsContent>

            {/* LEADS TAB */}
            <TabsContent value="leads" className="space-y-4">
              {contact.leads && contact.leads.length > 0 ? (
                contact.leads.map((lead) => (
                  <Card key={lead.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <Badge>{lead.status}</Badge>
                          {lead.productInterest && (
                            <p className="text-sm mt-2">{lead.productInterest}</p>
                          )}
                        </div>
                        {lead.estimatedValue && (
                          <span className="text-sm font-medium">
                            ${lead.estimatedValue.toLocaleString("es-AR")}
                          </span>
                        )}
                      </div>
                      {lead.notes && (
                        <p className="text-sm text-muted-foreground">{lead.notes}</p>
                      )}
                    </CardContent>
                  </Card>
                ))
              ) : (
                <div className="text-center py-12 border rounded-lg">
                  <TrendingUpIcon className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p className="text-muted-foreground">No hay oportunidades de venta</p>
                </div>
              )}
            </TabsContent>

            {/* ORDERS TAB */}
            <TabsContent value="orders" className="space-y-4">
              {contact.orders && contact.orders.length > 0 ? (
                contact.orders.map((order) => (
                  <Card key={order.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-medium">{order.orderNumber}</p>
                          <Badge className="mt-1">{order.status}</Badge>
                        </div>
                        <span className="text-sm font-medium">
                          ${order.amount.toLocaleString("es-AR")} {order.currency}
                        </span>
                      </div>
                      {order.trackingNumber && (
                        <p className="text-sm text-muted-foreground">
                          Tracking: {order.trackingNumber}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))
              ) : (
                <div className="text-center py-12 border rounded-lg">
                  <InventoryIcon className="h-12 w-12 mx-auto mb-4 opacity-20" />
                  <p className="text-muted-foreground">No hay pedidos</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
