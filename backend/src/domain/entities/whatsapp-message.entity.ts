/**
 * DOMAIN LAYER - WhatsApp Message Entities
 * Pure business entities, no external dependencies
 */

export enum WhatsAppMessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VOICE = 'audio',
  VIDEO = 'video',
  DOCUMENT = 'document',
}

export enum WhatsAppMessageStatus {
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
  FAILED = 'failed',
}

/**
 * Represents an incoming WhatsApp message from a customer
 */
export class WhatsAppIncomingMessage {
  constructor(
    public readonly messageId: string,
    public readonly from: string, // Phone number
    public readonly timestamp: Date,
    public readonly type: WhatsAppMessageType,
    public readonly text: string | null,
    public readonly mediaUrl: string | null,
    public readonly mediaId: string | null,
  ) {}

  isTextMessage(): boolean {
    return this.type === WhatsAppMessageType.TEXT && this.text !== null;
  }

  hasMedia(): boolean {
    return this.mediaUrl !== null || this.mediaId !== null;
  }
}

/**
 * Represents an outgoing WhatsApp message to be sent to a customer
 */
export class WhatsAppOutgoingMessage {
  constructor(
    public readonly to: string, // Phone number
    public readonly text: string,
    public readonly replyToMessageId?: string,
  ) {}

  validate(): boolean {
    return (
      this.to.length > 0 &&
      this.text.length > 0 &&
      this.text.length <= 4096 // WhatsApp text limit
    );
  }
}

/**
 * Represents the result of sending a WhatsApp message
 */
export class WhatsAppSendResult {
  constructor(
    public readonly success: boolean,
    public readonly messageId: string | null,
    public readonly error: string | null,
  ) {}

  static success(messageId: string): WhatsAppSendResult {
    return new WhatsAppSendResult(true, messageId, null);
  }

  static failure(error: string): WhatsAppSendResult {
    return new WhatsAppSendResult(false, null, error);
  }
}
