/**
 * USE CASES LAYER - Inbound message → mayorista lead pipeline
 */

export interface InboundMessageContext {
  contactId: string;
  conversationId: string;
  channel: string; // Channel enum value as string
  text: string;
}

export interface AutoAssignmentOutcome {
  created: boolean;
  leadId: string | null;
  assignedTo: string | null;
  reason: string;
  signals: string[];
}

export interface ILeadAutoAssignmentService {
  processInboundMessage(input: InboundMessageContext): Promise<AutoAssignmentOutcome>;
}
