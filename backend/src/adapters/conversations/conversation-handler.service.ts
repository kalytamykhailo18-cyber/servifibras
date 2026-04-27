/**
 * ADAPTERS LAYER - Conversation Handler Service
 * Connects incoming messages to AI and manages conversation history
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient, Channel, MessageSender, ConversationStatus, ContactType } from '@prisma/client';
import { IConversationHandler, ConversationHandleResult } from '../../use-cases/conversations/conversation-handler.interface';
import { WhatsAppIncomingMessage } from '../../domain/entities/whatsapp-message.entity';
import { ClaudeService } from '../ai/claude.service';
import { AIConversation, AIMessage } from '../../domain/entities/ai-message.entity';

@Injectable()
export class ConversationHandlerService implements IConversationHandler {
  private readonly logger = new Logger(ConversationHandlerService.name);
  private readonly prisma: PrismaClient;

  constructor(private readonly claudeService: ClaudeService) {
    this.prisma = new PrismaClient();
  }

  async handleWhatsAppMessage(
    message: WhatsAppIncomingMessage,
  ): Promise<ConversationHandleResult> {
    try {
      this.logger.log(`Processing message from ${message.from}`);

      // Only handle text messages for now
      if (!message.isTextMessage() || !message.text) {
        this.logger.debug('Non-text message or empty text, skipping AI processing');
        return {
          success: true,
          response: null,
          error: null,
        };
      }

      // Find or create contact
      const contact = await this.findOrCreateContact(message.from);

      // Find or create conversation
      const conversation = await this.findOrCreateConversation(contact.id, Channel.WHATSAPP);

      // Load recent conversation history
      const recentMessages = await this.getConversationHistory(message.from, 10);

      // Build AI conversation context
      const aiConversation = this.buildAIContext(recentMessages);

      // Save customer message to database
      await this.saveMessage(
        conversation.id,
        MessageSender.CUSTOMER,
        message.text,
        false, // isFromAI
      );

      // Get AI response
      this.logger.debug(`Sending to AI: "${message.text.substring(0, 50)}..."`);
      const aiResponse = await this.claudeService.continueConversation(
        aiConversation,
        message.text,
      );

      if (!aiResponse || aiResponse.length === 0) {
        throw new Error('AI returned empty response');
      }

      this.logger.log(`AI response: "${aiResponse.substring(0, 50)}..."`);

      // Save AI response to database
      await this.saveMessage(
        conversation.id,
        MessageSender.AI,
        aiResponse,
        true, // isFromAI
      );

      // Update conversation last message
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessage: aiResponse },
      });

      return {
        success: true,
        response: aiResponse,
        error: null,
      };
    } catch (error: any) {
      this.logger.error(`Error handling WhatsApp message: ${error.message}`);
      return {
        success: false,
        response: null,
        error: error.message,
      };
    }
  }

  async getConversationHistory(phoneNumber: string, limit: number = 10): Promise<any[]> {
    try {
      const contact = await this.prisma.contact.findUnique({
        where: { phone: phoneNumber },
      });

      if (!contact) {
        return [];
      }

      const conversation = await this.prisma.conversation.findFirst({
        where: {
          contactId: contact.id,
          channel: Channel.WHATSAPP,
        },
        include: {
          messages: {
            orderBy: { timestamp: 'desc' },
            take: limit,
          },
        },
      });

      if (!conversation) {
        return [];
      }

      // Return messages in chronological order (oldest first)
      return conversation.messages.reverse();
    } catch (error: any) {
      this.logger.error(`Error loading conversation history: ${error.message}`);
      return [];
    }
  }

  private async findOrCreateContact(phoneNumber: string) {
    let contact = await this.prisma.contact.findUnique({
      where: { phone: phoneNumber },
    });

    if (!contact) {
      this.logger.log(`Creating new contact: ${phoneNumber}`);
      contact = await this.prisma.contact.create({
        data: {
          phone: phoneNumber,
          name: phoneNumber, // Will be updated later with real name
          type: ContactType.MINORISTA, // Default, can be updated based on conversation
          channel: Channel.WHATSAPP,
        },
      });
    }

    return contact;
  }

  private async findOrCreateConversation(contactId: string, channel: Channel) {
    let conversation = await this.prisma.conversation.findFirst({
      where: {
        contactId,
        channel,
        status: { in: [ConversationStatus.ACTIVE, ConversationStatus.WAITING] },
      },
    });

    if (!conversation) {
      this.logger.log(`Creating new conversation for contact ${contactId}`);
      conversation = await this.prisma.conversation.create({
        data: {
          contactId,
          channel,
          status: ConversationStatus.ACTIVE,
        },
      });
    }

    return conversation;
  }

  private async saveMessage(
    conversationId: string,
    sender: MessageSender,
    content: string,
    isFromAI: boolean,
  ) {
    await this.prisma.message.create({
      data: {
        conversationId,
        sender,
        content,
        isFromAI,
      },
    });
  }

  private buildAIContext(recentMessages: any[]): AIConversation {
    const aiMessages: AIMessage[] = recentMessages.map((msg) => {
      const role = msg.isFromAI ? 'assistant' : 'user';
      return new AIMessage(role, msg.content);
    });

    return new AIConversation(aiMessages);
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
