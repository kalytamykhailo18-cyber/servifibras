"use client";

// Marcos 2026-07-21: wrapper fino para el deep-link
// /conversations/{id}. El cuerpo de la vista vive en
// ConversationDetailPanel para poder reusarse embedded en el
// split-pane de /conversations. Este wrapper simplemente lee el id
// del route y renderiza el panel fullscreen.

import { useParams } from "next/navigation";
import { ConversationDetailPanel } from "@/components/conversations/conversation-detail-panel";

export default function ConversationDetailPage() {
  const params = useParams();
  const conversationId = params.id as string;
  return <ConversationDetailPanel conversationId={conversationId} />;
}
