/**
 * DOMAIN LAYER - TiendaNube Webchat Message Entities
 */

export enum WebchatMessageType {
  TEXT = 'text',
  IMAGE = 'image',
  FILE = 'file',
}

export class WebchatIncomingMessage {
  constructor(
    public readonly id: string,
    public readonly conversationId: string,
    public readonly customerId: string,
    public readonly customerName: string,
    public readonly customerEmail: string | null,
    public readonly type: WebchatMessageType,
    public readonly text: string,
    public readonly timestamp: Date,
  ) {}

  isTextMessage(): boolean {
    return this.type === WebchatMessageType.TEXT && this.text.length > 0;
  }

  needsReply(): boolean {
    return this.isTextMessage();
  }
}

export class WebchatOutgoingMessage {
  constructor(
    public readonly conversationId: string,
    public readonly text: string,
    public readonly type: WebchatMessageType = WebchatMessageType.TEXT,
  ) {}

  validate(): boolean {
    return this.text.length > 0 && this.text.length <= 5000;
  }
}

export class WebchatSendResult {
  constructor(
    public readonly success: boolean,
    public readonly messageId: string | null,
    public readonly error: string | null,
  ) {}

  static success(messageId: string): WebchatSendResult {
    return new WebchatSendResult(true, messageId, null);
  }

  static failure(error: string): WebchatSendResult {
    return new WebchatSendResult(false, null, error);
  }
}
