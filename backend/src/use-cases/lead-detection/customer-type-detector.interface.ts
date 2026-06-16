/**
 * USE CASES LAYER - Customer-Type Detector
 *
 * Pure detection over a customer message. Tags the contact along Marcos's
 * customer-type dimension. Same pluggable pattern as the mayorista and
 * human-handoff detectors — heuristic today, LLM-backed tomorrow.
 *
 * Result is a coarse vote with confidence. The pipeline only applies the
 * type when confidence is above a threshold so we don't mislabel the
 * dominant class on a single weak signal.
 */

export type CustomerTypeCode =
  | 'ARTESANO'
  | 'EMPRENDEDOR'
  | 'MAYORISTA'
  | 'INDUSTRIAL'
  | 'PRFV_LAMINADOS'
  | 'PROVEEDOR';

export interface CustomerTypeDetection {
  type: CustomerTypeCode | null;
  signals: string[];
  confidence: number; // 0..1
}

export interface ICustomerTypeDetector {
  detect(text: string): Promise<CustomerTypeDetection>;
}

/** DI symbol for swap between heuristic and LLM-backed implementation. */
export const CUSTOMER_TYPE_DETECTOR = Symbol('ICustomerTypeDetector');
