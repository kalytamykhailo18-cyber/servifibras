/**
 * ADAPTERS LAYER — Conversation-style few-shot loader for Claude.
 *
 * Marcos's ask: "alimentar a Claude con conversaciones de prometheo para
 * que tenga el modo conversacional natural que tienen ellos." The
 * scaffold here implements the recommended approach (option 1 in
 * `/home/overview/reply.txt`): pick 10-20 hand-curated example
 * conversations and inject them as few-shot examples in the Claude
 * system prompt. The agent imitates style + tone without losing the
 * KB-grounded technical accuracy.
 *
 * Why few-shot, not fine-tune:
 *   - Anthropic doesn't offer fine-tuning on Claude as of 2026.
 *   - Few-shot reaches the same naturalness with full transparency: any
 *     admin can read / edit the examples in the DB.
 *   - Lets us scenario-tag examples (pricing / mayorista / postventa /
 *     handoff) and load only the relevant ones per inbound — keeps the
 *     prompt budget small.
 *
 * Storage: `ConversationExample` (Prisma model). Each row carries an
 * ordered list of turns plus a scenario tag. We load active rows on
 * boot (or on demand) and assemble a Spanish-language block that goes
 * into the system prompt.
 *
 * Knobs:
 *   CONVERSATION_STYLE_ENABLED         — kill switch ('true'/'false', default 'true')
 *   CONVERSATION_STYLE_MAX_EXAMPLES    — hard cap on how many examples we
 *                                         splice in (default 8). Keeps the
 *                                         prompt + token spend bounded.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Channel, PrismaClient } from '@prisma/client';

export interface StyleTurn {
  role: 'user' | 'assistant';
  content: string;
}

function isStyleTurn(t: any): t is StyleTurn {
  return (
    t &&
    typeof t === 'object' &&
    (t.role === 'user' || t.role === 'assistant') &&
    typeof t.content === 'string' &&
    t.content.length > 0
  );
}

// Same probe-token guard as conversation-scorer.service — kept local
// so the loader doesn't need to import from quality/. If a legacy row
// from before the 2026-06-15 cleanup ever resurfaces, the few-shot
// prompt still drops it instead of teaching the agent literal probe
// text like "PERSIST-PROBE 1780...: edición manual...".
const PROBE_CONTENT_RE =
  /\b(?:PERSIST-PROBE|CHANNEL-SCOPE-PROBE|CONFIG-PROBE|SCOPE-PROBE|PROBE\s+auto-mark-reviewed|PROBE\s+\d{10,})\b/i;

@Injectable()
export class ConversationStyleService {
  private readonly logger = new Logger(ConversationStyleService.name);
  private readonly prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  private isEnabled(): boolean {
    const raw = (process.env.CONVERSATION_STYLE_ENABLED || 'true').toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'yes';
  }

  private maxExamples(): number {
    const raw = process.env.CONVERSATION_STYLE_MAX_EXAMPLES;
    const n = raw != null ? Number(raw) : 8;
    return Number.isFinite(n) && n > 0 ? Math.min(50, n) : 8;
  }

  /**
   * Load examples for the prompt. When `scenario` is supplied we prefer
   * matching rows but always backfill with `general` so the prompt never
   * gets a one-shot diet. Order: scenario-specific first (so they appear
   * earliest in the prompt where Claude weighs them most), then general.
   * Within each tier, sort by `priority` desc, then `createdAt` desc.
   *
   * Marcos 2026-06-03: examples auto-promoted from a specific channel
   * (e.g. ML, with article URLs) must NOT leak to other channels
   * (WhatsApp / Instagram use different URL conventions). The
   * `channel` argument filters out rows tagged with a DIFFERENT
   * channel — rows where `channel = NULL` (cross-channel tone/style
   * examples) always pass through.
   */
  async loadExamples(
    scenario?: string,
    channel?: Channel,
  ): Promise<Array<{ scenario: string; turns: StyleTurn[] }>> {
    if (!this.isEnabled()) return [];
    try {
      const cap = this.maxExamples();
      // Channel filter: load rows that are either un-scoped (channel
      // is NULL, the legacy hand-seeded examples) OR scoped to the
      // current channel. Rows scoped to a DIFFERENT channel are
      // excluded so a ML-specific correction doesn't bleed into the
      // WhatsApp/Webchat/IG prompt.
      const where: any = { active: true };
      if (channel) {
        where.OR = [{ channel: null }, { channel }];
      }
      const all = await this.prisma.conversationExample.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        take: cap * 2, // overfetch — we'll filter and trim below
      });
      const validated = all
        .map((row) => {
          const turns = Array.isArray(row.turns) ? (row.turns as any[]).filter(isStyleTurn) : [];
          if (turns.length === 0) return null;
          // Defense-in-depth — never inject E2E probe text into the
          // few-shot prompt, even if a legacy row slipped past the
          // write-time guard. See conversation-scorer.service for
          // the canonical probe pattern.
          if (turns.some((t) => PROBE_CONTENT_RE.test(String(t.content ?? '')))) return null;
          return { scenario: row.scenario, turns: turns as StyleTurn[] };
        })
        .filter((x): x is { scenario: string; turns: StyleTurn[] } => x !== null);

      if (!scenario) return validated.slice(0, cap);
      const matching = validated.filter((e) => e.scenario === scenario);
      const general  = validated.filter((e) => e.scenario === 'general');
      const others   = validated.filter((e) => e.scenario !== scenario && e.scenario !== 'general');
      return [...matching, ...general, ...others].slice(0, cap);
    } catch (err: any) {
      this.logger.warn(`Could not load conversation examples: ${err.message}`);
      return [];
    }
  }

  /**
   * Build the prompt block. Returns the empty string when there are no
   * examples (so the caller can append it unconditionally without
   * polluting the system prompt). Format is intentionally readable so
   * a human can audit the prompt by reading the logs.
   */
  async buildSystemPromptBlock(scenario?: string, channel?: Channel): Promise<string> {
    const examples = await this.loadExamples(scenario, channel);
    if (examples.length === 0) return '';

    const lines: string[] = [];
    lines.push('### EJEMPLOS DE CONVERSACIONES (estilo y tono — imitá esta naturalidad)');
    lines.push('');
    lines.push('Estos son ejemplos de cómo el equipo de Servifibras suele responder. Tomá el');
    lines.push('tono cálido, directo, con jerga argentina (vos, dale, listo) y la concisión.');
    lines.push('No copies texto literal — el cliente no es el mismo. Usá la estructura.');
    lines.push('');

    for (let i = 0; i < examples.length; i++) {
      const ex = examples[i];
      lines.push(`--- Ejemplo ${i + 1} (${ex.scenario}) ---`);
      for (const turn of ex.turns) {
        const speaker = turn.role === 'user' ? 'Cliente' : 'Servifibras';
        lines.push(`${speaker}: ${turn.content}`);
      }
      lines.push('');
    }

    lines.push('### FIN DE EJEMPLOS');
    return lines.join('\n');
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }
}
