/**
 * USE CASES LAYER - Business logic interface
 * Defines what the AI can do, not how it does it
 */

import { AIConversation } from '../../domain/entities/ai-message.entity';
import { Channel } from '@prisma/client';

/**
 * Per-turn context the inbound handler can pass to ClaudeService so the
 * system prompt is enriched with channel-specific guardrails. ML adds
 * platform-TOS rules (no external contact info, single-message replies,
 * defer to publication context) that we can't safely embed in the base
 * Lucas prompt because they only apply on that one channel.
 *
 * `mercadolibreListing` lets the ML conversation handler hand over the
 * fetched listing snapshot (title, description, price, attributes,
 * permalink) so the agent's reply is anchored to the publication the
 * buyer is actually looking at, instead of guessing from generic
 * catalog matching.
 */
export interface AITurnContext {
  channel?: Channel;
  /** Customer display name / nickname for personalised greetings.
   *  On MercadoLibre the agent wraps the reply with
   *  "Hola {customerName}," and "Un saludo, Lucas de Servifibras."
   *  Marcos's 2026-06-01 ask: ML provides the buyer apodo with each
   *  question, so the agent must always greet them by name. */
  customerName?: string | null;
  /** True when this turn belongs to a sandbox / E2E test conversation.
   *  Lets the budget tracker stamp Claude usage events as dev/test so
   *  the dashboard can separate "real customer" spend from
   *  iteration-cycle spend. Marcos 2026-06-04: cost dashboard was
   *  mixing both — this is the signal that fixes the attribution. */
  isTestTraffic?: boolean;
  /** True when this is NOT the first AI reply in the conversation —
   *  the agent has already spoken to this buyer in the same thread.
   *  Marcos 2026-06-06: on ML pre-venta the buyer can ask multiple
   *  questions in a row on the same publication; the first reply
   *  greets ("Hola X,") + signs off ("Un saludo, Lucas..."), but
   *  subsequent replies in the same thread should drop the greeting
   *  and use a follow-up closer ("Quedo a disposición", "Estoy para
   *  lo que necesites"). Keeps the conversation human-like. The
   *  conversation handler computes this from the AI conversation
   *  history (any prior assistant message → isContinuation=true). */
  isContinuation?: boolean;
  /** Contact id of the customer this turn is talking to, when known.
   *  Bloque E item 2 (Marcos 2026-06-06): when set, ClaudeService
   *  loads the CustomerContextService block (identity / customer
   *  type / past orders / lead history) into the system prompt so
   *  the agent answers in that customer's context. Null/undefined
   *  → no extra block, agent runs on base prompt only. */
  contactId?: string | null;
  /** Optional model override for this turn. When set, ClaudeService uses
   *  this model ID instead of its configured default. The complexity
   *  classifier sets it to a cheaper model (Haiku) for routine L1
   *  questions so we don't burn Sonnet on "¿precio?" / "¿stock?" /
   *  "¿horarios?" while keeping Sonnet for L2/L3 reasoning. */
  modelOverride?: string;
  /** Complexity level from the classifier (1=routine, 2=careful, 3=escalate).
   *  Carried through so downstream code (token caps, logging) can pivot
   *  on the same signal that drove the model choice. */
  level?: 1 | 2 | 3;
  /** Bloque E item 5 (Marcos 2026-06-06): compressed-history hint.
   *  When the conversation handler decides the prior turns are too
   *  long to send verbatim, it provides a pre-rendered Spanish text
   *  block that summarises the older portion of the conversation
   *  (customer intent / products mentioned / status / key facts).
   *  ClaudeService pushes it as a cached system block so subsequent
   *  turns on the same conversation read from cache. Null/undefined →
   *  no compression, full history goes into the messages array. */
  compressedHistorySummary?: string | null;
  mercadolibreListing?: {
    itemId: string;
    title: string;
    subtitle: string | null;
    price: number | null;
    currencyId: string | null;
    availableQuantity: number | null;
    condition: string | null;
    permalink: string | null;
    descriptionPlain: string | null;
    attributes: Array<{ id: string; name: string; value: string }>;
    status: string | null;
  };
}

export interface IAIService {
  /**
   * Send a single question to AI and get response
   * @param question User's question
   * @returns AI's answer
   */
  askQuestion(question: string): Promise<string>;

  /**
   * Continue a conversation with context
   * @param conversation Previous conversation history
   * @param newMessage New user message
   * @param turn Optional per-turn channel + future itemId context
   * @returns AI's response
   */
  continueConversation(
    conversation: AIConversation,
    newMessage: string,
    turn?: AITurnContext,
  ): Promise<string>;

  /**
   * Check if AI service is available
   * @returns true if service is healthy
   */
  healthCheck(): Promise<boolean>;
}
