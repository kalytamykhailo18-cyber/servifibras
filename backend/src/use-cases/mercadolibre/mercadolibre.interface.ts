/**
 * USE CASES LAYER - MercadoLibre Service Interface
 */

import {
  MercadoLibreIncomingMessage,
  MercadoLibreOutgoingMessage,
  MercadoLibreSendResult,
} from '../../domain/entities/mercadolibre-message.entity';

export interface IMercadoLibreService {
  /**
   * Answer a product question
   */
  answerQuestion(questionId: string, text: string): Promise<MercadoLibreSendResult>;

  /**
   * Send a message (for direct messaging)
   */
  sendMessage(message: MercadoLibreOutgoingMessage): Promise<MercadoLibreSendResult>;

  /**
   * Parse incoming webhook notification
   */
  parseIncomingMessage(webhookPayload: any): MercadoLibreIncomingMessage | null;

  /**
   * Get unanswered questions
   */
  getUnansweredQuestions(): Promise<MercadoLibreIncomingMessage[]>;

  /**
   * Health check
   */
  healthCheck(): Promise<boolean>;
}
