/**
 * Centralised test-contact-name patterns.
 *
 * The E2E suite creates conversations on the real (non-sandbox) webchat
 * channel and the synthetic contact names follow a handful of repeating
 * shapes. Without this filter those land in the "real customer" bucket
 * on the cost / metrics dashboards and inflate the numbers Marcos reads.
 *
 * Why one file? Three code paths need to make the same decision:
 *   1. `ConversationHandlerService.isTestTrafficConv` — stamps the
 *      `isTestTraffic` flag on each Claude usage event at write time.
 *   2. `ConversationScorerService` — same stamp on quality-eval calls.
 *   3. `ClaudeBudgetService.getStats` — filters at read time so the
 *      dashboard counts ("preguntas reales este 24h") match the cost
 *      attribution.
 *
 * Adding a new pattern in one place but not the others recreates the
 * exact 212-vs-39 mismatch we got bitten by on 2026-06-05. Centralise
 * once, import everywhere.
 *
 * Patterns are deliberately conservative — real ML / WhatsApp buyer
 * names should not match. When in doubt, the unmatched name reports as
 * "real" (the safer side, since the test bucket is internal-only).
 */

export const TEST_CONTACT_NAME_PATTERNS: RegExp[] = [
  // Complexity classifier E2E fixtures: "Cmplx cmplx-l1-1780500123456"
  /^Cmplx\s+cmplx-l[123]-\d{10,}$/i,
  // 2D / two-dimensional E2E: "2D Test 2d-generic-…"
  /^2D\s+Test\s+2d-/i,
  // UI-handoff / handoff smoke tests: "Cliente UI Handoff", "Cliente Handoff",
  // "Cliente Test 17806…", "Cliente Gate", "Cliente Benigno"
  /^Cliente\s+(UI\s+Handoff|Handoff|Test|Gate|Benigno)/i,
  // Anchored loose "Benigno" — observed alone as a single-token fixture
  /^Benigno$/i,
  // PROBE / complexity probes
  /^PROBE[\s-]/i,
  /^complexity[-_]/i,
  // Quick-reply / pdf-attach UI fixtures: "UI QR 1780602611519",
  // "MS UI 1780627550700", "RT Test", "SYS CALCOS"
  /^UI\s+(QR|RT|MS)\s+\d{10,}/i,
  /^MS\s+UI\s+\d{10,}$/i,
  /^RT\s+Test/i,
  /^SYS\s+CALCOS/i,
  // PDF-attach probe: "ui-conv-pdf-…"
  /^ui-conv-/i,
  // ML / WhatsApp / Webchat sandbox seeds: trailing unix-ms or
  // YYYYMMDDHHmmss timestamp on an otherwise-name-shaped string.
  // Real ML nicknames sometimes carry short numeric suffixes (4–7 digits)
  // but never 10+. Anchored at end so we don't flag a real name that
  // happens to contain digits mid-string.
  /\d{10,}$/,
  // Generic numeric-only fixture ids (rare but seen in seeds): a name
  // that's nothing but a long digit string is never a real customer.
  // Bumped to 10+ digits to avoid catching ML internal user-id-style
  // 9-digit nicknames that occasionally come through.
  /^\d{10,}$/,
];

export function looksLikeTestContactName(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  return TEST_CONTACT_NAME_PATTERNS.some((re) => re.test(trimmed));
}
