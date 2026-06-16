/**
 * USE CASES LAYER - Complexity Classifier
 *
 * Marcos's three-level routing rule:
 *
 *   L1 — AI responds alone. Routine: price, stock, basic technical info.
 *   L2 — AI responds AND alerts Brenda. Complex quote, important new
 *        customer, anything that benefits from human follow-up after the
 *        agent's reply.
 *   L3 — AI does NOT respond; conversation goes straight to a human. Used
 *        for complaints, sensitive situations, strategic mayoristas, refund
 *        requests, anything where an automated reply would be wrong.
 *
 * Pluggable interface — heuristic now, LLM-backed later. Same shape so the
 * pipeline doesn't care which is wired.
 */

export type ComplexityLevel = 1 | 2 | 3;

export interface ComplexityClassification {
  level: ComplexityLevel;
  signals: string[];
  reason: string;
}

export interface IComplexityClassifier {
  /**
   * Async signature is required so an LLM-backed implementation can fit.
   * The keyword adapter wraps its sync result in `Promise.resolve`.
   */
  classify(text: string): Promise<ComplexityClassification>;
}

/** Symbol token for DI lookup — lets us swap the implementation by env. */
export const COMPLEXITY_CLASSIFIER = Symbol('IComplexityClassifier');
