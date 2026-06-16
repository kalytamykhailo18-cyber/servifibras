/**
 * USE CASES LAYER - Human Handoff Service contract
 */

import { HandoffSource } from './human-handoff-detector.interface';

export interface HandoffContext {
  conversationId: string;
  contactId: string;
  /** "customer" or "ai" — which side triggered the handoff */
  source: HandoffSource;
  /** detector signal codes for audit */
  signals: string[];
  /** human-readable reason for logs / UI */
  reason: string;
}

export interface HandoffOutcome {
  escalated: boolean;
  conversationId: string;
  assignedTo: string | null;
  routedTo: 'VENTAS' | 'LOGISTICA' | 'ATENCION' | 'ADMIN' | 'NONE';
  reason: string;
}

export interface IHumanHandoffService {
  /** Flag the conversation as needing a human and route it to the right role. */
  escalate(ctx: HandoffContext): Promise<HandoffOutcome>;

  /** Clear the human-needed flag — called when a human staff member replies. */
  clearFlag(conversationId: string): Promise<void>;
}
