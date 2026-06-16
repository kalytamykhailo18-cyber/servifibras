"use client";

// Connects the realtime socket while the dashboard is mounted and surfaces
// server-pushed events as toasts. Renders nothing visible — it's a behavioural
// component.

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useRealtimeConnection, useRealtimeEvent } from "@/lib/realtime/use-realtime";

interface ConversationTransferredPayload {
  conversationId: string;
  fromUserId: string;
  fromUserName?: string;
  note: string | null;
  at: string;
}

interface LeadAssignedPayload {
  leadId: string;
  conversationId: string;
  contactId: string;
  channel: string;
  signals: string[];
  confidence: number;
  at: string;
}

interface NeedsHumanPayload {
  conversationId: string;
  contactId: string;
  source: "ai" | "customer";
  reason: string;
  signals: string[];
  routedTo: "VENTAS" | "LOGISTICA" | "ATENCION" | "ADMIN" | "NONE";
  at: string;
}

interface OrderCreatedPayload {
  orderId: string;
  orderNumber: string;
  contact: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    customerType: string | null;
  };
  amount: number;
  currency: string;
  products: Array<{ name?: string; product?: string; quantity?: number; price?: number }> | unknown;
  status: string;
  at: string;
}

interface LowStockPayload {
  productId: string;
  sku: string;
  name: string;
  baseUnit: string;
  stockQuantity: number;
  threshold: number;
  inStock: boolean;
  at: string;
}

export function RealtimeNotifications() {
  const router = useRouter();
  useRealtimeConnection();

  const onTransferred = useCallback(
    (payload: ConversationTransferredPayload) => {
      const from = payload.fromUserName || "Un compañero";
      toast.message(`${from} te transfirió una conversación`, {
        description: payload.note ? `Nota: ${payload.note}` : "Sin nota interna",
        action: {
          label: "Abrir",
          onClick: () => router.push(`/conversations/${payload.conversationId}`),
        },
        duration: 8000,
      });
    },
    [router],
  );

  const onLeadAssigned = useCallback(
    (payload: LeadAssignedPayload) => {
      const reasons = payload.signals
        .filter((s) => s.startsWith("keyword:") || s.startsWith("quantity:"))
        .map((s) => s.replace(/^keyword:/, "").replace(/^quantity:[\d.]+/, ""))
        .slice(0, 2)
        .join(" · ");
      toast.message("Nueva oportunidad mayorista", {
        description: reasons ? `Detectado: ${reasons}` : "Detectado automáticamente desde un mensaje",
        action: {
          label: "Ver",
          onClick: () => router.push(`/leads/${payload.leadId}`),
        },
        duration: 9000,
      });
    },
    [router],
  );

  const onNeedsHuman = useCallback(
    (payload: NeedsHumanPayload) => {
      const reason =
        payload.source === "customer"
          ? "El cliente pidió hablar con una persona"
          : "La IA derivó la conversación";
      toast.warning("Pendiente humano", {
        description: reason,
        action: {
          label: "Abrir",
          onClick: () => router.push(`/conversations/${payload.conversationId}`),
        },
        duration: 10000,
      });
    },
    [router],
  );

  const onOrderCreated = useCallback(
    (payload: OrderCreatedPayload) => {
      const products = Array.isArray(payload.products) ? payload.products : [];
      const itemCount = products.length;
      const firstProduct =
        products[0]?.name || products[0]?.product || (itemCount > 0 ? "productos" : "");
      const summary =
        itemCount === 0
          ? `${payload.contact.name} · ${payload.currency} ${payload.amount}`
          : itemCount === 1
            ? `${firstProduct} · ${payload.contact.name}`
            : `${firstProduct} +${itemCount - 1} más · ${payload.contact.name}`;
      toast.message(`Pedido mayorista #${payload.orderNumber}`, {
        description: summary,
        action: {
          label: "Ver",
          onClick: () => router.push(`/orders/${payload.orderId}`),
        },
        duration: 10000,
      });
    },
    [router],
  );

  const onLowStock = useCallback(
    (payload: LowStockPayload) => {
      toast.warning(`Stock bajo: ${payload.name}`, {
        description: `${payload.stockQuantity} ${payload.baseUnit} restantes (umbral ${payload.threshold}) · SKU ${payload.sku}`,
        action: {
          label: "Ver",
          onClick: () => router.push(`/products`),
        },
        duration: 12000,
      });
    },
    [router],
  );

  useRealtimeEvent<ConversationTransferredPayload>("conversation:transferred", onTransferred);
  useRealtimeEvent<LeadAssignedPayload>("lead:assigned", onLeadAssigned);
  useRealtimeEvent<NeedsHumanPayload>("conversation:needs_human", onNeedsHuman);
  useRealtimeEvent<OrderCreatedPayload>("order:created", onOrderCreated);
  useRealtimeEvent<LowStockPayload>("product:low_stock", onLowStock);

  return null;
}
