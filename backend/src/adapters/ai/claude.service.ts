/**
 * ADAPTERS LAYER - Claude AI implementation
 * Implements IAIService interface using Anthropic SDK
 * Can be swapped with another AI provider without touching use cases
 */

import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { IAIService } from '../../use-cases/ai/ai.interface';
import { AIConversation } from '../../domain/entities/ai-message.entity';
import { KnowledgeRepository } from '../repositories/knowledge.repository';
import { PricingCalculatorService } from '../pricing/pricing-calculator.service';

@Injectable()
export class ClaudeService implements IAIService {
  private readonly logger = new Logger(ClaudeService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly isConfigured: boolean;
  private knowledgeBaseContext: string | null = null;

  constructor(
    private readonly knowledgeRepo: KnowledgeRepository,
    private readonly pricingCalculator: PricingCalculatorService,
  ) {
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

    // Load knowledge base asynchronously
    this.loadKnowledgeBase();
  }

  private async loadKnowledgeBase(): Promise<void> {
    try {
      this.knowledgeBaseContext = await this.knowledgeRepo.getFormattedForAI();
      this.logger.log('✅ Knowledge base loaded for AI context');
    } catch (error) {
      this.logger.error('Failed to load knowledge base', error);
      this.knowledgeBaseContext = null;
    }
  }

  private ensureConfigured(): void {
    if (!this.isConfigured || !this.client) {
      throw new Error(
        'Claude API not configured. Please add CLAUDE_API_KEY to .env file.',
      );
    }
  }

  private getPricingTools(): Anthropic.Tool[] {
    return [
      {
        name: 'calculate_price',
        description:
          'Calcula el precio de un producto de Servifibras. Usa esta herramienta cuando el cliente pregunte por precios, cotizaciones o costos. Funciona con resinas, fibra de vidrio y siliconas. Retorna el precio en pesos argentinos (ARS) y dólares (USD) al tipo de cambio del día.',
        input_schema: {
          type: 'object',
          properties: {
            productName: {
              type: 'string',
              description:
                'Nombre del producto (ej: "Resina Epoxi 5kg", "Resina Poliéster 20 litros", "Fibra Mat 300")',
            },
            quantity: {
              type: 'number',
              description: 'Cantidad de unidades solicitadas (mínimo 1)',
            },
            customerType: {
              type: 'string',
              enum: ['minorista', 'mayorista', 'emprendedor', 'industrial'],
              description:
                'Tipo de cliente: minorista (retail), mayorista (wholesale), emprendedor (entrepreneur), industrial',
            },
            channel: {
              type: 'string',
              enum: ['whatsapp', 'facebook', 'instagram', 'mercadolibre'],
              description: 'Canal de venta (opcional, por defecto whatsapp)',
            },
          },
          required: ['productName', 'quantity', 'customerType'],
        },
      },
    ];
  }

  private async handleToolUse(
    toolName: string,
    toolInput: any,
  ): Promise<string> {
    if (toolName === 'calculate_price') {
      try {
        const { productName, quantity, customerType, channel } = toolInput;
        const quote = await this.pricingCalculator.calculatePriceByName(
          productName,
          quantity,
          customerType || 'minorista',
          channel || 'whatsapp',
        );

        // Return structured result for AI to format naturally
        return JSON.stringify({
          product: quote.product.name,
          quantity: quote.quantity,
          priceUSD: Math.round(quote.finalPriceUSD),
          priceARS: Math.round(quote.finalPriceARS),
          exchangeRate: quote.exchangeRate.rate,
          discounts: {
            volume: quote.volumeDiscount,
            customer: quote.channelDiscount,
          },
          formatted: quote.toFormattedString(),
        });
      } catch (error: any) {
        this.logger.error('Failed to calculate price', error);
        return JSON.stringify({
          error: error.message || 'No se pudo calcular el precio',
        });
      }
    }

    return JSON.stringify({ error: 'Unknown tool' });
  }

  async askQuestion(question: string): Promise<string> {
    this.ensureConfigured();

    try {
      this.logger.debug(`Sending question to Claude: ${question.substring(0, 50)}...`);

      // Build system prompt with knowledge base and pricing instructions
      let systemPrompt = '';
      if (this.knowledgeBaseContext) {
        systemPrompt = this.knowledgeBaseContext + '\n\n';
      }
      systemPrompt += `Eres un asistente de ventas técnico de Servifibras, empresa argentina de materiales compuestos.

IMPORTANTE sobre precios:
- Cuando el cliente pregunte por precios, usa la herramienta calculate_price
- Si no estás seguro del tipo de cliente, pregunta o asume "minorista" por defecto
- Los mayoristas compran grandes volúmenes (100L+, distribuyen, tienen empresa)
- Siempre responde en español con el cliente, profesional pero amigable
- Después de dar un precio, pregunta si necesita algo más o si quiere hacer el pedido`;

      // Build request with tools
      const messages: Anthropic.MessageParam[] = [
        {
          role: 'user',
          content: question,
        },
      ];

      let response = await this.client!.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages,
        tools: this.getPricingTools(),
      });

      this.logger.debug(`Response stop_reason: ${response.stop_reason}`);

      // Handle tool use
      if (response.stop_reason === 'tool_use') {
        // Find tool use block
        const toolUseBlock = response.content.find(
          (block) => block.type === 'tool_use',
        ) as Anthropic.ToolUseBlock | undefined;

        if (toolUseBlock) {
          this.logger.debug(
            `Tool used: ${toolUseBlock.name} with input: ${JSON.stringify(toolUseBlock.input)}`,
          );

          // Execute tool
          const toolResult = await this.handleToolUse(
            toolUseBlock.name,
            toolUseBlock.input,
          );

          this.logger.debug(`Tool result: ${toolResult}`);

          // Continue conversation with tool result
          messages.push({
            role: 'assistant',
            content: response.content,
          });

          messages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolUseBlock.id,
                content: toolResult,
              },
            ],
          });

          // Get final response
          response = await this.client!.messages.create({
            model: this.model,
            max_tokens: 2048,
            system: systemPrompt,
            messages,
            tools: this.getPricingTools(),
          });
        }
      }

      const answer = this.extractTextFromResponse(response);
      this.logger.debug(`Final answer: ${answer.substring(0, 100)}...`);

      return answer;
    } catch (error: any) {
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

      // Build request with optional system context
      const requestConfig: any = {
        model: this.model,
        max_tokens: 1024,
        messages,
      };

      // Add knowledge base as system context if available
      if (this.knowledgeBaseContext) {
        requestConfig.system = this.knowledgeBaseContext;
      }

      const response = await this.client!.messages.create(requestConfig);

      return this.extractTextFromResponse(response);
    } catch (error: any) {
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
