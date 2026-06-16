/**
 * USE CASES LAYER - Human-Handoff Detector
 *
 * Pure detection over text. Two entry points so the same interface covers
 * both the AI-said-it-can't-help path and the customer-asked-for-a-person
 * path. Implementations may be heuristic (keywords) or LLM-backed.
 *
 * Reason codes — used downstream for routing hints and audit logs:
 *   "ai_handoff_phrase"  — AI replied with a handoff phrase ("te derivo")
 *   "customer_request"   — Customer explicitly asked for a person
 */

export type HandoffSource = 'ai' | 'customer';

export interface HandoffDetection {
  needsHuman: boolean;
  source: HandoffSource | null;
  signals: string[];
  reason: string | null;
}

export interface IHumanHandoffDetector {
  /** Inspect an AI-generated reply for explicit handoff phrasing. */
  detectInAIReply(text: string): Promise<HandoffDetection>;
  /** Inspect a customer message for an explicit request to talk to a human. */
  detectInCustomerMessage(text: string): Promise<HandoffDetection>;
}

/** DI symbol for swap between heuristic and LLM-backed implementation. */
export const HUMAN_HANDOFF_DETECTOR = Symbol('IHumanHandoffDetector');
