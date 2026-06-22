/**
 * DOMAIN LAYER - MercadoLibre Message Entities
 * For MercadoLibre questions and direct messages
 */

export enum MercadoLibreMessageType {
  QUESTION = 'question', // Question on product listing
  MESSAGE = 'message',   // Direct message
  REVIEW = 'review',     // Buyer feedback on order — comes via topic="feedback" or "orders_feedback"
  CLAIM = 'claim',       // Buyer-opened claim — comes via topic="claims"
}

export enum MercadoLibreStatus {
  UNANSWERED = 'UNANSWERED',
  ANSWERED = 'ANSWERED',
  CLOSED_UNANSWERED = 'CLOSED_UNANSWERED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  BANNED = 'BANNED',
}

/**
 * Represents an incoming question or message from MercadoLibre
 */
export class MercadoLibreIncomingMessage {
  constructor(
    public readonly id: string,
    public readonly type: MercadoLibreMessageType,
    public readonly from: string, // User ID or nickname
    public readonly fromId: string, // User ID
    public readonly text: string,
    public readonly itemId: string | null, // Product ID for questions
    public readonly status: MercadoLibreStatus,
    public readonly dateCreated: Date,
    // Bloque B item 1 — Marcos 2026-06-06: the OAuthCredential
    // `provider` key for the cuenta this inbound landed through
    // ("mercadolibre" = cuenta 1, "mercadolibre_cuenta2" = cuenta 2).
    // Null when the resolver couldn't match the webhook user_id
    // (unconnected cuenta, stale credential). The conversation
    // handler stamps it on the persisted Conversation so analytics
    // can split metrics per store.
    public readonly mlAccountKey: string | null = null,
    /**
     * Marcos 2026-06-22: para reclamos — de quién es el próximo turno
     * según los `available_actions` de los players[] en el payload de
     * /post-purchase/v1/claims/{id}. Sirve para segmentar el panel
     * de reclamos por prioridad: 'seller' es lo que el equipo de
     * Servifibras tiene que accionar (máxima prioridad), 'buyer' es
     * pendiente del comprador, 'ml' está en revisión por la
     * mediación de Mercado Libre.
     */
    public readonly pendingFor: 'seller' | 'buyer' | 'ml' | null = null,
  ) {}

  isQuestion(): boolean {
    return this.type === MercadoLibreMessageType.QUESTION;
  }

  isMessage(): boolean {
    return this.type === MercadoLibreMessageType.MESSAGE;
  }

  needsAnswer(): boolean {
    return this.status === MercadoLibreStatus.UNANSWERED && this.text && this.text.length > 0;
  }
}

/**
 * Represents an outgoing answer to MercadoLibre
 */
export class MercadoLibreOutgoingMessage {
  constructor(
    public readonly type: MercadoLibreMessageType,
    public readonly questionId: string | null, // For answering questions
    public readonly text: string,
  ) {}

  validate(): boolean {
    // MercadoLibre limit is 2000 characters for answers
    return (
      this.text.length > 0 &&
      this.text.length <= 2000 &&
      (this.type === MercadoLibreMessageType.MESSAGE || this.questionId !== null)
    );
  }
}

/**
 * Result of sending a MercadoLibre message
 */
export class MercadoLibreSendResult {
  constructor(
    public readonly success: boolean,
    public readonly messageId: string | null,
    public readonly error: string | null,
  ) {}

  static success(messageId: string): MercadoLibreSendResult {
    return new MercadoLibreSendResult(true, messageId, null);
  }

  static failure(error: string): MercadoLibreSendResult {
    return new MercadoLibreSendResult(false, null, error);
  }
}
