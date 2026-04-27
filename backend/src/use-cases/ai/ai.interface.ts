/**
 * USE CASES LAYER - Business logic interface
 * Defines what the AI can do, not how it does it
 */

import { AIConversation } from '../../domain/entities/ai-message.entity';

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
   * @returns AI's response
   */
  continueConversation(
    conversation: AIConversation,
    newMessage: string,
  ): Promise<string>;

  /**
   * Check if AI service is available
   * @returns true if service is healthy
   */
  healthCheck(): Promise<boolean>;
}
