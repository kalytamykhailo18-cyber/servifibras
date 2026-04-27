/**
 * ADAPTERS LAYER - Claude AI implementation
 * Implements IAIService interface using Anthropic SDK
 * Can be swapped with another AI provider without touching use cases
 */

import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { IAIService } from '../../use-cases/ai/ai.interface';
import { AIConversation } from '../../domain/entities/ai-message.entity';

@Injectable()
export class ClaudeService implements IAIService {
  private readonly logger = new Logger(ClaudeService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly isConfigured: boolean;

  constructor() {
    // ✅ RULE 1: All config from .env, never hardcoded
    const apiKey = process.env.CLAUDE_API_KEY;
    this.model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

    if (!apiKey || apiKey === 'sk-ant-your-api-key-here') {
      this.logger.warn(
        '⚠️  CLAUDE_API_KEY not configured. Service will start but API calls will fail.',
      );
      this.logger.warn('   Add your API key to .env: CLAUDE_API_KEY=sk-ant-...');
      this.client = null;
      this.isConfigured = false;
    } else {
      this.client = new Anthropic({ apiKey });
      this.isConfigured = true;
      this.logger.log(`✅ Claude Service initialized with model: ${this.model}`);
    }
  }

  private ensureConfigured(): void {
    if (!this.isConfigured || !this.client) {
      throw new Error(
        'Claude API not configured. Please add CLAUDE_API_KEY to .env file.',
      );
    }
  }

  async askQuestion(question: string): Promise<string> {
    this.ensureConfigured();

    try {
      this.logger.debug(`Sending question to Claude: ${question.substring(0, 50)}...`);

      const response = await this.client!.messages.create({
        model: this.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: question,
          },
        ],
      });

      const answer = this.extractTextFromResponse(response);
      this.logger.debug(`Received answer: ${answer.substring(0, 50)}...`);

      return answer;
    } catch (error) {
      this.logger.error('Failed to get response from Claude', error);
      throw new Error(`AI service error: ${error.message}`);
    }
  }

  async continueConversation(
    conversation: AIConversation,
    newMessage: string,
  ): Promise<string> {
    this.ensureConfigured();

    try {
      // Convert domain AIConversation to Anthropic format
      const messages = [
        ...conversation.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        {
          role: 'user' as const,
          content: newMessage,
        },
      ];

      this.logger.debug(
        `Continuing conversation with ${messages.length} messages`,
      );

      const response = await this.client!.messages.create({
        model: this.model,
        max_tokens: 1024,
        messages,
      });

      return this.extractTextFromResponse(response);
    } catch (error) {
      this.logger.error('Failed to continue conversation', error);
      throw new Error(`AI service error: ${error.message}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.isConfigured || !this.client) {
      this.logger.warn('Health check failed: API not configured');
      return false;
    }

    try {
      // Simple ping to verify API key works
      await this.client.messages.create({
        model: this.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return true;
    } catch (error) {
      this.logger.error('Health check failed', error);
      return false;
    }
  }

  private extractTextFromResponse(response: Anthropic.Message): string {
    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text content in Claude response');
    }
    return textContent.text;
  }
}
