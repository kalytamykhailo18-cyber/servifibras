/**
 * Standalone CLI: audita los últimos N días de respuestas AI en ML
 * contra el catálogo de patrones que Marcos viene flagueando. Útil
 * para cazar regresiones antes de que él las encuentre.
 *
 *   bash ops/ml-quality-sweep.sh [days=7] [limit=200]
 *
 * Lee directamente de prisma (con la encryption key del .env via
 * MessageCipher), corre la grilla de patrones, y devuelve un digest
 * agrupado por patrón con muestras.
 */

import { PrismaClient } from '@prisma/client';
import { getMessageCipher } from '../adapters/security/message-cipher';

interface Pattern {
  key: string;
  description: string;
  test: (text: string, message?: { metadata: any }) => boolean;
  severity: 'CRIT' | 'WARN' | 'INFO';
}

const PATTERNS: Pattern[] = [
  {
    key: 'mayorista_hijack',
    description: 'Hijack mayorista — "te conviene contactar al vendedor" en ML (fix 2026-06-25)',
    severity: 'CRIT',
    test: (t) => /te conviene contactar al vendedor/i.test(t) || /contactar al vendedor desde la publicaci[óo]n/i.test(t),
  },
  {
    key: 'depende_de_que',
    description: '"Depende de qué/cuál" opener — Marcos lo marcó como pattern a evitar',
    severity: 'CRIT',
    test: (t) => /\bdepende de (qu[ée]|cu[áa]l|c[óo]mo)\b/i.test(t),
  },
  {
    key: 'no_especifica',
    description: '"no especificás" / "no puedo responder sin saber" — Marcos lo marcó',
    severity: 'CRIT',
    test: (t) => /\bno especific[áa]s?\b/i.test(t) || /no puedo responder sin saber/i.test(t),
  },
  {
    key: 'tool_name_leak',
    description: 'Leak del nombre interno de tool (buscar_producto)',
    severity: 'CRIT',
    test: (t) => /\bbuscar_producto\b/i.test(t),
  },
  // "Quedo a disposición ante cualquier otra duda." es el cierre
  // canónico de continuación en ML (claude.service.ts:1288). NO se
  // flaguea — solo flagueamos las variantes "su / tu disposición" que
  // sí son formales.
  {
    key: 'formal_close_disposicion_pronoun',
    description: '"Quedo a SU/TU disposición" — formal con pronombre (la versión sin pronombre es el closer canónico)',
    severity: 'WARN',
    test: (t) => /quedo a (?:su |tu )disposici[óo]n/i.test(t),
  },
  {
    key: 'formal_close_atentamente',
    description: '"Atentamente" / "Cordialmente" / "Saludos cordiales" — cierre de oficina formal',
    severity: 'WARN',
    test: (t) => /\b(atentamente|cordialmente|saludos cordiales)\b/i.test(t),
  },
  {
    key: 'asesor_handoff',
    description: '"te paso con (un) asesor" / "le paso esta consulta al equipo"',
    severity: 'WARN',
    test: (t) => /te paso (?:con un|al) (?:asesor|equipo)/i.test(t) || /le paso esta consulta al equipo/i.test(t),
  },
  {
    key: 'crm_order_id_leak',
    description: 'Leak del formato interno ORD-AAAA-NNNN a comprador ML',
    severity: 'CRIT',
    test: (t) => /\bORD-\d{4}-\d+\b/.test(t),
  },
  // En ML el canal permite linkear a publicaciones alternativas
  // (cross-sell, channelGuardrailBlock rule 5.B). Solo flagueamos URLs
  // mal formadas — falta del sufijo "-_JM" canónico (reference: MLA
  // article URL format) o digit-pattern roto, indicando fabricación.
  {
    key: 'malformed_mla_link',
    description: 'Link MLA mal formado (falta sufijo "_JM" o digit-pattern incorrecto) — probablemente fabricado',
    severity: 'WARN',
    test: (t) => {
      const matches = t.match(/articulo\.mercadolibre\.com\.ar\/(MLA[^\s)\]]+)/gi);
      if (!matches) return false;
      return matches.some((m) => !/MLA-?\d{7,}-[^\s)\]]*_JM/i.test(m));
    },
  },
  // missing_greeting solo tiene sentido en el PRIMER reply de la AI en
  // la conversación. Las continuaciones (claude.service.ts:1283)
  // intencionalmente dropean el "Hola". Por eso el chequeo se aplica
  // afuera del PATTERNS map — necesita acceso a la cuenta de mensajes
  // previos en la misma conversación.
  {
    key: 'truncation_likely',
    description: 'Probable truncación (sin signo de cierre al final + muy larga)',
    severity: 'WARN',
    test: (t) => {
      const trimmed = t.trim();
      if (trimmed.length < 400) return false;
      const last = trimmed.slice(-1);
      return !/[.?!"…)]/.test(last);
    },
  },
  {
    key: 'apologetic_short',
    description: 'Respuesta apologética sin contenido útil ("Disculpá, no tengo esa info")',
    severity: 'WARN',
    test: (t) => {
      const tl = t.toLowerCase();
      if (t.length > 200) return false;
      return /\b(disculp[áa]|lamentablemente|lo siento)\b/i.test(t) && /no tengo|no cuento|no manejo/i.test(t);
    },
  },
];

async function main() {
  const days = (() => {
    const n = Number(process.argv[2]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 7;
  })();
  const limit = (() => {
    const n = Number(process.argv[3]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200;
  })();

  const prisma = new PrismaClient();
  const cipher = getMessageCipher();
  const since = new Date(Date.now() - days * 86_400_000);

  console.log(`[ml-quality-sweep] window=${days}d limit=${limit} since=${since.toISOString()}`);
  console.log(`[ml-quality-sweep] encryption enabled=${cipher.isEnabled()}`);

  const messages = await prisma.message.findMany({
    where: {
      isFromAI: true,
      timestamp: { gte: since },
      conversation: { channel: 'MERCADOLIBRE' as any },
    },
    select: {
      id: true,
      content: true,
      timestamp: true,
      metadata: true,
      conversationId: true,
    },
    orderBy: { timestamp: 'desc' },
    take: limit,
  });

  console.log(`[ml-quality-sweep] scanned ${messages.length} ML AI messages`);

  // Compute first-AI-message-per-conversation set so we only flag
  // missing greeting on first replies (continuations drop "Hola"
  // intentionally per claude.service.ts:1283).
  const firstAiByConv = await prisma.message.groupBy({
    by: ['conversationId'],
    where: {
      isFromAI: true,
      conversation: { channel: 'MERCADOLIBRE' as any },
      timestamp: { gte: since },
    },
    _min: { timestamp: true },
  });
  const firstAiTimestamp = new Map<string, number>();
  for (const r of firstAiByConv) {
    if (r._min.timestamp) firstAiTimestamp.set(r.conversationId, r._min.timestamp.getTime());
  }

  const findings = new Map<string, Array<{ id: string; ts: string; sample: string; meta: any }>>();
  for (const p of PATTERNS) findings.set(p.key, []);
  findings.set('missing_greeting_first_reply', []);

  let totalFlagged = 0;
  const flaggedIds = new Set<string>();

  for (const m of messages) {
    const plain = cipher.decrypt(m.content);
    if (!plain || plain.length === 0) continue;
    const isFirstAi = firstAiTimestamp.get(m.conversationId) === m.timestamp.getTime();
    // Aceptamos "Hola X,", "Hola!", "Hola.", "Hola\n", "Buen día", "Buenos días"
    // como saludos válidos al inicio del primer reply.
    if (isFirstAi && !/^(hola[, !.\n]|buen[oa]s?\s+(?:d[íi]as?|tardes|noches)|buen\s+d[íi]a)/i.test(plain.trim())) {
      const arr = findings.get('missing_greeting_first_reply')!;
      if (arr.length < 5) {
        arr.push({
          id: m.id,
          ts: m.timestamp.toISOString(),
          sample: plain.length > 220 ? plain.slice(0, 220) + '…' : plain,
          meta: m.metadata,
        });
      } else {
        arr.push({ id: m.id, ts: m.timestamp.toISOString(), sample: '', meta: m.metadata });
      }
      if (!flaggedIds.has(m.id)) {
        flaggedIds.add(m.id);
        totalFlagged++;
      }
    }
    for (const p of PATTERNS) {
      try {
        if (p.test(plain, { metadata: m.metadata })) {
          const arr = findings.get(p.key)!;
          if (arr.length < 5) {
            arr.push({
              id: m.id,
              ts: m.timestamp.toISOString(),
              sample: plain.length > 220 ? plain.slice(0, 220) + '…' : plain,
              meta: m.metadata,
            });
          } else {
            arr.push({ id: m.id, ts: m.timestamp.toISOString(), sample: '', meta: m.metadata });
          }
          if (!flaggedIds.has(m.id)) {
            flaggedIds.add(m.id);
            totalFlagged++;
          }
        }
      } catch {
        // ignore pattern errors
      }
    }
  }

  console.log('');
  console.log('==== ML QUALITY SWEEP REPORT ====');
  console.log(`Window: last ${days} day(s) · Sample: ${messages.length} ML AI messages · Flagged: ${totalFlagged} (${messages.length > 0 ? ((totalFlagged / messages.length) * 100).toFixed(1) : 0}%)`);
  console.log('');

  // Print missing-greeting-first-reply separately (INFO).
  {
    const hits = findings.get('missing_greeting_first_reply') ?? [];
    if (hits.length > 0) {
      console.log(`  [INFO] missing_greeting_first_reply: ${hits.length} — Primer reply de la AI en la conversación, sin "Hola {nick},"`);
      for (const h of hits.slice(0, 3)) {
        if (h.sample) {
          console.log(`    ${h.ts}  ${h.id}`);
          console.log(`      "${h.sample.replace(/\n+/g, ' ¶ ')}"`);
        }
      }
      if (hits.length > 3) console.log(`    … +${hits.length - 3} más`);
    } else {
      console.log(`  [INFO] missing_greeting_first_reply: 0 — Primer reply de la AI en la conversación, sin "Hola {nick},"`);
    }
  }

  const order: Array<'CRIT' | 'WARN' | 'INFO'> = ['CRIT', 'WARN', 'INFO'];
  for (const sev of order) {
    for (const p of PATTERNS) {
      if (p.severity !== sev) continue;
      const hits = findings.get(p.key) ?? [];
      if (hits.length === 0) {
        console.log(`  [${sev}] ${p.key}: 0 — ${p.description}`);
        continue;
      }
      console.log(`  [${sev}] ${p.key}: ${hits.length} — ${p.description}`);
      for (const h of hits.slice(0, 3)) {
        if (h.sample) {
          console.log(`    ${h.ts}  ${h.id}`);
          console.log(`      "${h.sample.replace(/\n+/g, ' ¶ ')}"`);
        }
      }
      if (hits.length > 3) console.log(`    … +${hits.length - 3} más`);
    }
  }
  console.log('');
  console.log('==== END REPORT ====');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(`[ml-quality-sweep] fatal: ${err?.message ?? err}`);
  process.exit(1);
});
