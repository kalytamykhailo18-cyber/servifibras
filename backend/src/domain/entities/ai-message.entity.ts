/**
 * DOMAIN LAYER - Pure business entity
 * No dependencies on frameworks or external libraries
 */

export class AIMessage {
  constructor(
    public readonly role: 'user' | 'assistant',
    public readonly content: string,
    public readonly timestamp: Date = new Date(),
  ) {}

  static fromUser(content: string): AIMessage {
    return new AIMessage('user', content);
  }

  static fromAssistant(content: string): AIMessage {
    return new AIMessage('assistant', content);
  }
}

export class AIConversation {
  constructor(
    public readonly messages: AIMessage[] = [],
  ) {}

  addMessage(message: AIMessage): AIConversation {
    return new AIConversation([...this.messages, message]);
  }

  addUserMessage(content: string): AIConversation {
    return this.addMessage(AIMessage.fromUser(content));
  }

  addAssistantMessage(content: string): AIConversation {
    return this.addMessage(AIMessage.fromAssistant(content));
  }

  getLastMessage(): AIMessage | undefined {
    return this.messages[this.messages.length - 1];
  }
}
