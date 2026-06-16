/**
 * ADAPTERS LAYER - Spanish keyword heuristic for complexity classification.
 *
 * Decision flow per inbound customer message:
 *   1. If any L3 phrase fires → L3 (sensitive — human-only).
 *   2. Else if any L2 phrase fires → L2 (AI replies + alert Brenda).
 *   3. Else → L1 (AI handles alone — the common case).
 *
 * L3 is conservative — only true escalation triggers. L2 catches cases
 * where the agent CAN answer but a human should know about it (large
 * quotes, important enterprise customers, multi-step deals).
 */

import { Injectable } from '@nestjs/common';
import {
  IComplexityClassifier,
  ComplexityClassification,
  ComplexityLevel,
} from '../../use-cases/lead-detection/complexity-classifier.interface';

// L3 — sensitive: complaints, refunds, legal, strategic mayoristas.
// AI must NOT auto-respond; conversation goes straight to a human queue.
const L3_PHRASES = [
  'reclamo',
  'queja',
  'denuncia',
  'demanda',
  'abogado',
  'defensa del consumidor',
  'estafa',
  'fraude',
  'me cobraron mal',
  'me cobraron de más',
  'no me llegó',
  'no llegó',
  'producto roto',
  'producto dañado',
  'producto fallado',
  'devolución',
  'devolver',
  'reembolso',
  'me devuelvan',
  'cancelar pedido',
  'cancelar orden',
  'mal servicio',
  'pésima atención',
  'pesima atencion',
  'urgente',
  'es urgente',
];

// L2 — complex enough that Brenda should know after the AI replies.
// Big quotes, large quantities (caught by mayorista detection too but
// we surface it here as an extra signal), enterprise / industrial intent,
// multi-product orders.
const L2_PHRASES = [
  'cotización formal',
  'cotizacion formal',
  'presupuesto formal',
  'orden de compra',
  'compra empresa',
  'compra industrial',
  'cuit',
  'iva responsable',
  'factura a',
  'licitación',
  'licitacion',
  'convenio',
  'distribuidor',
  'mayorista estratégico',
  'mayorista estrategico',
  'lote completo',
  'a granel',
  'representante',
];

function findHits(text: string, phrases: string[]): string[] {
  if (!text || typeof text !== 'string') return [];
  const t = text.toLowerCase();
  const hits: string[] = [];
  for (const p of phrases) if (t.includes(p)) hits.push(p);
  return hits;
}

@Injectable()
export class KeywordComplexityClassifier implements IComplexityClassifier {
  /**
   * Synchronous internals; `async` only to satisfy the interface signature
   * shared with the LLM-backed implementation. JS wraps the return value
   * in `Promise.resolve` for free.
   */
  async classify(text: string): Promise<ComplexityClassification> {
    return this.classifySync(text);
  }

  /** Public sync entry-point — used by the LLM adapter as a deterministic
   *  fallback when Claude isn't available. */
  classifySync(text: string): ComplexityClassification {
    const l3 = findHits(text, L3_PHRASES);
    if (l3.length > 0) {
      return {
        level: 3 as ComplexityLevel,
        signals: l3.map((p) => `l3:${p}`),
        reason: 'sensitive_or_complaint',
      };
    }
    const l2 = findHits(text, L2_PHRASES);
    if (l2.length > 0) {
      return {
        level: 2 as ComplexityLevel,
        signals: l2.map((p) => `l2:${p}`),
        reason: 'complex_business_signal',
      };
    }
    return { level: 1 as ComplexityLevel, signals: [], reason: 'routine' };
  }
}
