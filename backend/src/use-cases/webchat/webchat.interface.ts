/**
 * USE CASES LAYER - TiendaNube Webchat Service Interface
 */

import {
  WebchatIncomingMessage,
  WebchatOutgoingMessage,
  WebchatSendResult,
} from '../../domain/entities/webchat-message.entity';

export interface IWebchatService {
  sendMessage(message: WebchatOutgoingMessage): Promise<WebchatSendResult>;
  parseIncomingMessage(webhookPayload: any): WebchatIncomingMessage | null;
  healthCheck(): Promise<boolean>;
}
