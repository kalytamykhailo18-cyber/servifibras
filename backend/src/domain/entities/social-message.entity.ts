/**
 * DOMAIN LAYER - Social Media Message Entities
 * For Facebook and Instagram interactions
 */

export enum SocialMessageType {
  COMMENT = 'comment',
  DIRECT_MESSAGE = 'direct_message',
  MENTION = 'mention',
  STORY_REPLY = 'story_reply',
}

export enum SocialPlatform {
  FACEBOOK = 'facebook',
  INSTAGRAM = 'instagram',
}

/**
 * Represents an incoming message from Facebook or Instagram
 */
export class SocialIncomingMessage {
  constructor(
    public readonly messageId: string,
    public readonly platform: SocialPlatform,
    public readonly type: SocialMessageType,
    public readonly from: string, // User ID or username
    public readonly senderId: string, // Platform user ID
    public readonly text: string,
    public readonly timestamp: Date,
    public readonly postId?: string, // For comments
    public readonly parentCommentId?: string, // For comment replies
  ) {}

  isComment(): boolean {
    return this.type === SocialMessageType.COMMENT;
  }

  isDirectMessage(): boolean {
    return this.type === SocialMessageType.DIRECT_MESSAGE;
  }

  needsReply(): boolean {
    return this.text && this.text.length > 0;
  }
}

/**
 * Represents an outgoing message to Facebook or Instagram
 */
export class SocialOutgoingMessage {
  constructor(
    public readonly platform: SocialPlatform,
    public readonly type: SocialMessageType,
    public readonly to: string, // User ID or comment ID
    public readonly text: string,
    public readonly postId?: string, // For comments
    public readonly parentCommentId?: string, // For replies to comments
  ) {}

  validate(): boolean {
    return (
      this.text.length > 0 &&
      this.text.length <= 8000 && // Facebook/Instagram limit
      this.to.length > 0
    );
  }

  isComment(): boolean {
    return this.type === SocialMessageType.COMMENT;
  }

  isDirectMessage(): boolean {
    return this.type === SocialMessageType.DIRECT_MESSAGE;
  }
}

/**
 * Result of sending a social media message
 */
export class SocialSendResult {
  constructor(
    public readonly success: boolean,
    public readonly messageId: string | null,
    public readonly error: string | null,
  ) {}

  static success(messageId: string): SocialSendResult {
    return new SocialSendResult(true, messageId, null);
  }

  static failure(error: string): SocialSendResult {
    return new SocialSendResult(false, null, error);
  }
}
