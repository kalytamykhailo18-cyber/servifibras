/**
 * ADAPTERS LAYER - Keyword heuristic for human-handoff detection.
 *
 * Spanish-tuned. Two distinct phrase sets — one for things an AI assistant
 * would say when it gives up, one for things a customer says when they want
 * a person. Conservative on the customer side (we don't want to escalate on
 * a passing "una persona" mention) and a bit looser on the AI side because
 * an AI handoff phrase is unambiguous when it appears.
 */

import { Injectable } from '@nestjs/common';
import {
  IHumanHandoffDetector,
  HandoffDetection,
} from '../../use-cases/lead-detection/human-handoff-detector.interface';

// AI's "I'm handing you off" phrases — match if the AI explicitly transfers.
const AI_HANDOFF_PHRASES = [
  'te derivo',
  'te paso con',
  'te conecto con',
  'te contactará un asesor',
  'te contactaremos',
  'un asesor humano',
  'un asesor te',
  'un agente humano',
  'un agente te',
  'un representante humano',
  'un representante te',
  'persona del equipo',
  'equipo comercial te contactar',
  'no puedo ayudarte con',
  'no estoy capacitado',
  'no tengo esa información',
  'derivar tu consulta',
  'derivamos tu consulta',
];

// Customer's "I want to talk to a human" phrases. Stricter — we want intent,
// not casual mentions.
const CUSTOMER_HANDOFF_PHRASES = [
  'hablar con una persona',
  'hablar con alguien',
  'hablar con un humano',
  'hablar con un asesor',
  'hablar con un agente',
  'hablar con un vendedor',
  'hablar con un representante',
  'quiero un asesor',
  'quiero un humano',
  'quiero un agente',
  'quiero un vendedor',
  'necesito un asesor',
  'necesito un humano',
  'necesito un agente',
  'atención humana',
  'atencion humana',
  'no quiero hablar con un bot',
  'no quiero un bot',
  'pásame con',
  'pasame con',
  'comuniquenme con',
  'comunicarme con un',
];

function findHits(text: string, phrases: string[]): string[] {
  if (!text || typeof text !== 'string') return [];
  const t = text.toLowerCase();
  const hits: string[] = [];
  for (const p of phrases) if (t.includes(p)) hits.push(p);
  return hits;
}

@Injectable()
export class KeywordHumanHandoffDetector implements IHumanHandoffDetector {
  async detectInAIReply(text: string): Promise<HandoffDetection> {
    return this.detectInAIReplySync(text);
  }
  async detectInCustomerMessage(text: string): Promise<HandoffDetection> {
    return this.detectInCustomerMessageSync(text);
  }

  detectInAIReplySync(text: string): HandoffDetection {
    const hits = findHits(text, AI_HANDOFF_PHRASES);
    if (hits.length === 0) return { needsHuman: false, source: null, signals: [], reason: null };
    return {
      needsHuman: true,
      source: 'ai',
      signals: hits.map((h) => `ai_phrase:${h}`),
      reason: 'ai_handoff_phrase',
    };
  }

  detectInCustomerMessageSync(text: string): HandoffDetection {
    const hits = findHits(text, CUSTOMER_HANDOFF_PHRASES);
    if (hits.length === 0) return { needsHuman: false, source: null, signals: [], reason: null };
    return {
      needsHuman: true,
      source: 'customer',
      signals: hits.map((h) => `customer_phrase:${h}`),
      reason: 'customer_request',
    };
  }
}
