/**
 * USE CASES LAYER - Mayorista (wholesale) Lead Detector
 *
 * Pure detection over text. No I/O. Implementations may be heuristic
 * (keyword + quantity) or LLM-backed; both must satisfy this interface so the
 * inbound-message pipeline doesn't care which one is wired.
 */

export interface MayoristaDetectionResult {
  /** True if the message is judged to be a wholesale lead. */
  isMayorista: boolean;
  /** Signals that fired — useful for explainability and debug logs. */
  signals: string[];
  /** Coarse confidence: 0..1. Heuristics don't need to be precise here. */
  confidence: number;
}

export interface IMayoristaDetector {
  /**
   * Inspect the raw customer message and decide whether it indicates a
   * wholesale buying intent.
   */
  detect(text: string): Promise<MayoristaDetectionResult>;
}

/** DI symbol for swap between heuristic and LLM-backed implementation. */
export const MAYORISTA_DETECTOR = Symbol('IMayoristaDetector');
