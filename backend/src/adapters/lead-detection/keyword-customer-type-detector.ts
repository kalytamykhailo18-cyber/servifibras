/**
 * ADAPTERS LAYER - Spanish keyword heuristic for customer-type detection.
 *
 * Each customer-type has its own bag of phrases. The detector returns the
 * type with the most hits; ties default to EMPRENDEDOR as the most generic
 * commercial bucket. Confidence is `hits / total_phrases_for_winner`,
 * capped at 1.
 */

import { Injectable } from '@nestjs/common';
import {
  ICustomerTypeDetector,
  CustomerTypeDetection,
  CustomerTypeCode,
} from '../../use-cases/lead-detection/customer-type-detector.interface';

const PHRASES: Record<CustomerTypeCode, string[]> = {
  ARTESANO: [
    'hobby',
    'hobbysta',
    'artesan',
    'manualidades',
    'manualidad',
    'casero',
    'pequeñ',
    'para mí',
    'para mi proyecto',
    'me gustaría probar',
    'hago figuras',
    'hago accesorios',
    'pieza',
    'maquetas',
  ],
  EMPRENDEDOR: [
    'emprendimiento',
    'emprendedor',
    'mi marca',
    'mi tienda',
    'estoy arrancando',
    'tengo un local pequeño',
    'kit emprendedor',
    'empezando a vender',
    'lanzo',
    'mi proyecto comercial',
  ],
  MAYORISTA: [
    'mayorista',
    'mayoreo',
    'al por mayor',
    'por mayor',
    'a granel',
    'reventa',
    'revender',
    'distribuid',
    'comercio',
    'lote completo',
    'cantidades grandes',
  ],
  INDUSTRIAL: [
    'industrial',
    'fábrica',
    'fabrica',
    'planta',
    'producción industrial',
    'línea de producción',
    'consumo industrial',
    'uso industrial',
    'orden de compra',
    'compra empresa',
    'cuit',
    'iva responsable',
  ],
  PRFV_LAMINADOS: [
    'prfv',
    'laminado',
    'laminados',
    'laminación',
    'fibra de vidrio',
    'composite',
    'molde',
    'náutica',
    'nautica',
    'tanque',
    'pileta',
    'piscina',
  ],
  PROVEEDOR: [
    'proveedor',
    'proveedora',
    'somos proveedores',
    'distribuyo',
    'tengo stock',
    'somos importadores',
    'represento',
    'somos fabricantes',
  ],
};

const ALL_TYPES = Object.keys(PHRASES) as CustomerTypeCode[];

@Injectable()
export class KeywordCustomerTypeDetector implements ICustomerTypeDetector {
  /** Async per the interface; LLM adapter uses `detectSync` as fallback. */
  async detect(text: string): Promise<CustomerTypeDetection> {
    return this.detectSync(text);
  }

  detectSync(text: string): CustomerTypeDetection {
    if (!text || typeof text !== 'string') {
      return { type: null, signals: [], confidence: 0 };
    }
    const t = text.toLowerCase();
    const hitsPerType: Record<CustomerTypeCode, string[]> = {
      ARTESANO: [], EMPRENDEDOR: [], MAYORISTA: [], INDUSTRIAL: [], PRFV_LAMINADOS: [], PROVEEDOR: [],
    };
    // Match longer phrases first and skip overlapping shorter ones — so
    // 'al por mayor' doesn't also count 'por mayor' as a separate hit.
    for (const tp of ALL_TYPES) {
      const consumed: Array<[number, number]> = [];
      const sorted = [...PHRASES[tp]].sort((a, b) => b.length - a.length);
      for (const p of sorted) {
        const idx = t.indexOf(p);
        if (idx === -1) continue;
        const overlap = consumed.some(([s, e]) => idx < e && idx + p.length > s);
        if (overlap) continue;
        consumed.push([idx, idx + p.length]);
        hitsPerType[tp].push(p);
      }
    }

    // Pick the winner — most hits, ties broken by a coarse priority list
    // (more-specific types first so MAYORISTA beats EMPRENDEDOR on overlap).
    const priority: CustomerTypeCode[] = ['INDUSTRIAL', 'MAYORISTA', 'PRFV_LAMINADOS', 'PROVEEDOR', 'EMPRENDEDOR', 'ARTESANO'];
    let winner: CustomerTypeCode | null = null;
    let bestCount = 0;
    for (const tp of priority) {
      if (hitsPerType[tp].length > bestCount) {
        winner = tp;
        bestCount = hitsPerType[tp].length;
      }
    }

    if (!winner || bestCount === 0) {
      return { type: null, signals: [], confidence: 0 };
    }

    const signals = hitsPerType[winner].map((p) => `${winner}:${p}`);
    const confidence = Math.min(1, bestCount / 3); // 3+ hits = 1.0
    return { type: winner, signals, confidence };
  }
}
