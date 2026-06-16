/**
 * USE CASES LAYER — Order-status intent detection.
 *
 * Defines the contract for "is the customer asking about an order?".
 * Heuristic implementation today; LLM-backed implementation later (same swap
 * pattern as mayorista / human-handoff / customer-type / complexity).
 */

export interface OrderStatusIntentResult {
  /** True when the message looks like an order-status question. */
  match: boolean;
  /**
   * If the customer pasted a specific order number (e.g. "ORD-2026-1234"),
   * surface it so the reply service can prefer that order over "most recent".
   */
  orderNumber: string | null;
  /** Phrases that fired — useful for logging and audit. */
  signals: string[];
}

export interface IOrderStatusIntent {
  detect(text: string): OrderStatusIntentResult;
}

export const ORDER_STATUS_INTENT = Symbol('IOrderStatusIntent');
