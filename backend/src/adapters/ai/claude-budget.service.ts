/**
 * ADAPTERS LAYER — Claude cost guardrails.
 *
 * Two responsibilities:
 *   1) Track every successful Claude API call (input/output tokens,
 *      computed USD cost, call site) so admin can see the spend.
 *   2) Enforce a monthly USD cap. When current-month spend hits the cap,
 *      `ensureWithinBudget` returns allowed=false; the calling code then
 *      falls back to the deterministic path (keyword detector, etc).
 *
 * Why month-scoped: Anthropic billing is monthly, Marcos's accounting is
 * monthly, and the natural reset cadence ("oh it's the 1st, I have my
 * budget back") matches operator intuition.
 *
 * Tunable in `.env`:
 *   CLAUDE_MONTHLY_BUDGET_USD       — soft/hard cap. Default 100.
 *   CLAUDE_BUDGET_HARD_STOP         — 'true' (default) | 'false'. When
 *                                     false, we still record + warn but
 *                                     never block calls.
 *   CLAUDE_PRICE_INPUT_USD_PER_MTOK — input price per million tokens.
 *                                     Default 3.0 (Sonnet 4 baseline).
 *   CLAUDE_PRICE_OUTPUT_USD_PER_MTOK — output price per million tokens.
 *                                      Default 15.0.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { looksLikeTestContactName } from '../conversations/test-contact-patterns';
import { CostOptCounterService } from './cost-opt-counter.service';

function num(envKey: string, fallback: number): number {
  const v = process.env[envKey];
  const n = v != null ? Number(v) : fallback;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Per-model token pricing. Looks the model name up against a small
 * family table so a Haiku call gets Haiku prices and a Sonnet call gets
 * Sonnet prices — without that, every call recorded by the budget
 * tracker was priced at the global CLAUDE_PRICE_INPUT/OUTPUT defaults
 * (which mirror Sonnet) and the dashboard couldn't see the savings
 * from routing the quality scorer to Haiku.
 *
 * Each family can be overridden via env (CLAUDE_<FAMILY>_PRICE_INPUT_USD_PER_MTOK,
 * CLAUDE_<FAMILY>_PRICE_OUTPUT_USD_PER_MTOK). Unknown / null models
 * fall through to the legacy CLAUDE_PRICE_* envs.
 */
function pricesForModel(model?: string | null): {
  inputPricePerMtok: number;
  outputPricePerMtok: number;
} {
  const fallbackIn = num('CLAUDE_PRICE_INPUT_USD_PER_MTOK', 3);
  const fallbackOut = num('CLAUDE_PRICE_OUTPUT_USD_PER_MTOK', 15);
  const m = (model || '').toLowerCase();
  if (!m) return { inputPricePerMtok: fallbackIn, outputPricePerMtok: fallbackOut };
  if (m.includes('haiku')) {
    return {
      inputPricePerMtok: num('CLAUDE_HAIKU_PRICE_INPUT_USD_PER_MTOK', 0.8),
      outputPricePerMtok: num('CLAUDE_HAIKU_PRICE_OUTPUT_USD_PER_MTOK', 4),
    };
  }
  if (m.includes('opus')) {
    return {
      inputPricePerMtok: num('CLAUDE_OPUS_PRICE_INPUT_USD_PER_MTOK', 15),
      outputPricePerMtok: num('CLAUDE_OPUS_PRICE_OUTPUT_USD_PER_MTOK', 75),
    };
  }
  // Sonnet family + anything unrecognised falls through to the global
  // defaults (which mirror Sonnet 4 pricing).
  return { inputPricePerMtok: fallbackIn, outputPricePerMtok: fallbackOut };
}

function bool(envKey: string, fallback: boolean): boolean {
  const v = process.env[envKey];
  if (v == null || v.trim().length === 0) return fallback;
  return v.trim().toLowerCase() === 'true';
}

function startOfCurrentMonthUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export interface BudgetCheck {
  allowed: boolean;
  reason: string | null;
  spentUsd: number;
  capUsd: number;
  hardStop: boolean;
}

export interface UsageStats {
  capUsd: number;
  hardStop: boolean;
  monthSpentUsd: number;
  monthCalls: number;
  todaySpentUsd: number;
  todayCalls: number;
  byCallSite: Array<{ callSite: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number }>;
  daily: Array<{ day: string; calls: number; costUsd: number }>;
  // Cache observability — populated from ClaudeUsageEvent.cache*Tokens.
  // `savedUsd` is the headline number for the dashboard widget: what
  // we'd have paid for those tokens at the normal input rate minus
  // what we actually paid at the cache write/read rates.
  cache: {
    createTokens: number;
    readTokens: number;
    hitRatio: number;       // 0..1
    baselineUsd: number;    // hypothetical "all uncached" cost
    actualUsd: number;      // actual cost of cache traffic
    savedUsd: number;       // baseline − actual (always ≥ 0)
  };
  // Per-question cost over the last N hours. Marcos 2026-06-04: the
  // widget's "calls" number reads as user questions to non-engineers
  // (each question fires ~5 internal calls), inflating the
  // back-of-the-envelope cost-per-question by 5-10×. This field
  // surfaces the actual customer-facing number so the dashboard
  // matches reality.
  perQuestion: {
    windowHours: number;
    questions: number;       // distinct CUSTOMER messages in window
    spendUsd: number;        // REAL-customer spend in window (excludes dev/test)
    spendUsdTest: number;    // dev/test spend in window (separately tracked)
    costPerQuestionUsd: number;
  };
  // Real vs dev/test split at the month level. 2026-06-04: dashboard
  // was mixing both streams, inflating the "spent" headline by the
  // amount of sweep/sandbox iteration during development.
  attribution: {
    monthRealUsd: number;
    monthTestUsd: number;
    monthRealCalls: number;
    monthTestCalls: number;
  };
  /**
   * Marcos 2026-06-24: Bloque E visibility. Cuántas veces dispararon
   * los shortcuts skip-Claude este mes + tokens estimados ahorrados
   * + USD estimado al precio normal de input. Permite que el widget
   * muestre el ahorro demostrable de las optimizaciones de costo.
   */
  costOpts: {
    bySource: Array<{ source: string; count: number; estimatedTokensSaved: number; estimatedUsdSaved: number }>;
    totalCount: number;
    totalTokensSaved: number;
    totalUsdSaved: number;
  };
}

export class BudgetExceededError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'BudgetExceededError';
  }
}

@Injectable()
export class ClaudeBudgetService {
  private readonly logger = new Logger(ClaudeBudgetService.name);
  private readonly prisma: PrismaClient;

  // Marcos 2026-06-24: Opcional para no romper tests/seeds que
  // instancian ClaudeBudgetService sin el contador de Bloque E.
  constructor(
    @Optional() private readonly costOptCounter?: CostOptCounterService,
    @Optional() prismaShared?: import('../repositories/prisma.service').PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  /**
   * Returns whether the current call is allowed under the monthly cap.
   * When hard-stop is disabled (CLAUDE_BUDGET_HARD_STOP=false) this
   * always returns allowed=true but still surfaces current spend so the
   * dashboard can colour-code "over budget but still flowing".
   */
  async ensureWithinBudget(_callSite: string): Promise<BudgetCheck> {
    const cap = num('CLAUDE_MONTHLY_BUDGET_USD', 100);
    const hardStop = bool('CLAUDE_BUDGET_HARD_STOP', true);
    const spent = await this.getMonthSpentUsd();
    if (cap > 0 && spent >= cap) {
      const reason = `Claude monthly budget reached: USD ${spent.toFixed(2)} of USD ${cap}`;
      if (hardStop) {
        return { allowed: false, reason, spentUsd: spent, capUsd: cap, hardStop };
      }
      this.logger.warn(reason + ' (hard-stop disabled — letting through)');
    }
    return { allowed: true, reason: null, spentUsd: spent, capUsd: cap, hardStop };
  }

  /**
   * Persist a usage record after a Claude call (success or failure).
   * `response` is the Anthropic SDK return value when available; on errors
   * pass `null` and the row will record 0 tokens with errored=true so the
   * UI can show "X% of LLM attempts failed".
   */
  async recordUsage(
    callSite: string,
    model: string,
    response: {
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        // Prompt-caching fields — present on responses when the system
        // is sent as an array of TextBlockParams with `cache_control`
        // markers. Anthropic bills these at modified rates: cache write
        // 1.25×, cache read 0.1×. See computeCost below.
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    } | null,
    erroredOrOpts: boolean | { errored?: boolean; isTestTraffic?: boolean } = false,
  ): Promise<void> {
    // Back-compat: callers either pass `errored: boolean` (legacy) or
    // an options object `{ errored, isTestTraffic }`. Marcos 2026-06-04
    // added the test-traffic flag so dev/test calls don't get mixed
    // with real-customer spend on the dashboard.
    const opts =
      typeof erroredOrOpts === 'boolean'
        ? { errored: erroredOrOpts, isTestTraffic: false }
        : { errored: erroredOrOpts.errored ?? false, isTestTraffic: erroredOrOpts.isTestTraffic ?? false };
    const inputTokens = response?.usage?.input_tokens ?? 0;
    const outputTokens = response?.usage?.output_tokens ?? 0;
    const cacheCreate = response?.usage?.cache_creation_input_tokens ?? 0;
    const cacheRead = response?.usage?.cache_read_input_tokens ?? 0;
    const costUsd = this.computeCost(inputTokens, outputTokens, cacheCreate, cacheRead, model);
    try {
      // Cache deltas now persist as their own columns so the dashboard
      // widget can compute hit ratio + savings without re-parsing JSON.
      // `inputTokens` is the TOTAL billable input (uncached + cache
      // write + cache read) so existing reports that read just that
      // column don't break; the breakdown reads the cache* columns.
      await this.prisma.claudeUsageEvent.create({
        data: {
          callSite,
          model,
          inputTokens: inputTokens + cacheCreate + cacheRead,
          outputTokens,
          cacheCreateTokens: cacheCreate,
          cacheReadTokens: cacheRead,
          costUsd,
          errored: opts.errored,
          isTestTraffic: opts.isTestTraffic,
        },
      });
    } catch (err: any) {
      // Tracking must never break the calling flow.
      this.logger.warn(`Failed to record usage event (non-fatal): ${err.message}`);
    }
  }

  /**
   * Cost includes the four input-token classes that Anthropic bills
   * differently when prompt caching is on:
   *   inputTokens   — uncached input (normal rate)
   *   cacheCreate   — cache write (1.25× normal — adds ~25% on first call)
   *   cacheRead     — cache read (0.1× normal — the big savings)
   *   outputTokens  — model output (normal output rate)
   *
   * Model-aware: prices are looked up per family (Haiku vs Sonnet vs
   * Opus) so when the quality scorer routes to Haiku the dashboard
   * reflects the real ~5× cost drop instead of pricing every call at
   * the Sonnet rate.
   */
  computeCost(
    inputTokens: number,
    outputTokens: number,
    cacheCreate: number = 0,
    cacheRead: number = 0,
    model?: string | null,
  ): number {
    const { inputPricePerMtok, outputPricePerMtok } = pricesForModel(model);
    const cacheCreateMult = num('CLAUDE_PRICE_CACHE_CREATE_MULT', 1.25);
    const cacheReadMult = num('CLAUDE_PRICE_CACHE_READ_MULT', 0.1);
    const cost =
      (inputTokens * inputPricePerMtok) / 1_000_000 +
      (cacheCreate * inputPricePerMtok * cacheCreateMult) / 1_000_000 +
      (cacheRead * inputPricePerMtok * cacheReadMult) / 1_000_000 +
      (outputTokens * outputPricePerMtok) / 1_000_000;
    return Math.round(cost * 1_000_000) / 1_000_000; // 6dp precision is plenty
  }

  async getMonthSpentUsd(): Promise<number> {
    const since = startOfCurrentMonthUtc();
    const agg = await this.prisma.claudeUsageEvent.aggregate({
      where: { createdAt: { gte: since } },
      _sum: { costUsd: true },
    });
    return Number(agg._sum.costUsd ?? 0);
  }

  /**
   * Stats payload for the admin widget: monthly + today totals plus
   * call-site breakdown and a 30-day daily series so the operator can
   * eyeball whether spend is trending up or flat.
   */
  async getStats(): Promise<UsageStats> {
    const cap = num('CLAUDE_MONTHLY_BUDGET_USD', 100);
    const hardStop = bool('CLAUDE_BUDGET_HARD_STOP', true);

    const monthStart = startOfCurrentMonthUtc();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    // Monthly aggregates per callSite — split on isTestTraffic so the
    // dashboard "desglose por uso" panel shows real-customer spend only,
    // matching the per-question + attribution cards. Marcos 2026-06-05:
    // the unsplit total was showing 2.175 quality-eval calls and he
    // (correctly) suspected most were on test conversations. Filtering
    // here is consistent with the rest of the "real customer" framing.
    const grouped = await this.prisma.claudeUsageEvent.groupBy({
      by: ['callSite'],
      where: { createdAt: { gte: monthStart }, isTestTraffic: false },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    });
    const byCallSite = grouped
      .map((g) => ({
        callSite: g.callSite,
        calls: g._count._all,
        inputTokens: g._sum.inputTokens ?? 0,
        outputTokens: g._sum.outputTokens ?? 0,
        costUsd: Number(g._sum.costUsd ?? 0),
      }))
      .sort((a, b) => b.costUsd - a.costUsd);

    // Headline totals stay UNSPLIT (test + real) because the "Uso de IA
    // — este mes" card shows the cap-vs-spend bar, and the cap covers
    // every call we make. The attribution sub-card breaks down what
    // fraction was customer-driven vs internal iteration.
    const monthTotalsAgg = await this.prisma.claudeUsageEvent.aggregate({
      where: { createdAt: { gte: monthStart } },
      _count: { _all: true },
      _sum: { costUsd: true },
    });
    const monthSpentUsd = Number(monthTotalsAgg._sum.costUsd ?? 0);
    const monthCalls = monthTotalsAgg._count._all;

    const todayAgg = await this.prisma.claudeUsageEvent.aggregate({
      where: { createdAt: { gte: todayStart } },
      _count: { _all: true },
      _sum: { costUsd: true },
    });

    // Cache observability — month-level aggregates so the widget can
    // show "saved USD X this month thanks to prompt caching". The
    // "savings" number is what those cache-read tokens WOULD have cost
    // at the normal input rate, minus what they actually cost at the
    // 0.1× rate. Cache-write rows cost a 25% premium on first call,
    // which subtracts from the saving — netted out below.
    const cacheAgg = await this.prisma.claudeUsageEvent.aggregate({
      where: { createdAt: { gte: monthStart } },
      _sum: { cacheCreateTokens: true, cacheReadTokens: true },
    });
    const monthCacheCreate = cacheAgg._sum.cacheCreateTokens ?? 0;
    const monthCacheRead = cacheAgg._sum.cacheReadTokens ?? 0;
    const inputPricePerMtok = num('CLAUDE_PRICE_INPUT_USD_PER_MTOK', 3);
    const cacheCreateMult = num('CLAUDE_PRICE_CACHE_CREATE_MULT', 1.25);
    const cacheReadMult = num('CLAUDE_PRICE_CACHE_READ_MULT', 0.1);
    // Hypothetical "all uncached" cost of those cached tokens.
    const baselineUsd = ((monthCacheCreate + monthCacheRead) * inputPricePerMtok) / 1_000_000;
    // Actual cost of those cached tokens.
    const actualUsd =
      (monthCacheCreate * inputPricePerMtok * cacheCreateMult) / 1_000_000 +
      (monthCacheRead * inputPricePerMtok * cacheReadMult) / 1_000_000;
    const cacheSavedUsd = Math.max(0, baselineUsd - actualUsd);
    const totalCacheTokens = monthCacheCreate + monthCacheRead;
    const cacheHitRatio = totalCacheTokens > 0 ? monthCacheRead / totalCacheTokens : 0;

    // 30-day daily series. Group at the SQL layer to avoid pulling rows.
    const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const dailyRaw = await this.prisma.$queryRaw<Array<{ day: Date; calls: bigint; costUsd: number }>>(
      Prisma.sql`
        SELECT
          date_trunc('day', "createdAt") AS day,
          COUNT(*)::bigint AS "calls",
          COALESCE(SUM("costUsd"), 0) AS "costUsd"
        FROM "claude_usage_events"
        WHERE "createdAt" >= ${since30}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
    );
    const daily = dailyRaw.map((r) => ({
      day: r.day.toISOString().slice(0, 10),
      calls: Number(r.calls),
      costUsd: Number(r.costUsd),
    }));

    // Per-question cost: Marcos 2026-06-04 read the widget's "calls"
    // number as user questions and divided spend by it, landing on a
    // ~$2/question estimate that's off by ~10×. The reality is one
    // user question fires multiple internal Claude calls (intent
    // classification, catalog search, reply, scoring). We count actual
    // inbound CUSTOMER messages and divide REAL-traffic spend over
    // those — the resulting number is what the customer ACTUALLY
    // costs us, with dev/test/sandbox iteration stripped out
    // (`isTestTraffic` flag added 2026-06-04 PM).
    const today24h = new Date(Date.now() - 24 * 3600 * 1000);
    // Marcos 2026-06-05 (AM): the "questions" count was using
    // `conversation.isSandbox=false` alone, which lets E2E fixtures
    // through (their conversations live on the real webchat channel,
    // `isSandbox=false`). Spend attribution already handles this via
    // `isTestTraffic` on usage events, but THIS count didn't — that's
    // the 212-vs-39 gap he reported. Pull messages with contact name,
    // strip the same test-fixture patterns that `looksLikeTestContact`
    // uses on the write path, then count what's left.
    const rawQuestions = await this.prisma.message.findMany({
      where: {
        sender: 'CUSTOMER',
        timestamp: { gte: today24h },
        conversation: { isSandbox: false },
      },
      select: { conversation: { select: { contact: { select: { name: true } } } } },
    });
    const questionsToday = rawQuestions.filter(
      (m) => !looksLikeTestContactName(m.conversation?.contact?.name),
    ).length;
    const realCost24h = Number(
      (await this.prisma.claudeUsageEvent.aggregate({
        where: { createdAt: { gte: today24h }, isTestTraffic: false },
        _sum: { costUsd: true },
      }))._sum.costUsd ?? 0,
    );
    const testCost24h = Number(
      (await this.prisma.claudeUsageEvent.aggregate({
        where: { createdAt: { gte: today24h }, isTestTraffic: true },
        _sum: { costUsd: true },
      }))._sum.costUsd ?? 0,
    );
    const costPerQuestionUsd =
      questionsToday > 0 ? realCost24h / questionsToday : 0;

    // Month-level split for the headline dashboard line so the operator
    // sees customer-only spend vs internal dev/test spend.
    const monthSplitAgg = await this.prisma.claudeUsageEvent.groupBy({
      by: ['isTestTraffic'],
      where: { createdAt: { gte: monthStart } },
      _sum: { costUsd: true },
      _count: { _all: true },
    });
    const monthRealUsd = Number(
      monthSplitAgg.find((g) => g.isTestTraffic === false)?._sum.costUsd ?? 0,
    );
    const monthTestUsd = Number(
      monthSplitAgg.find((g) => g.isTestTraffic === true)?._sum.costUsd ?? 0,
    );
    const monthRealCalls =
      monthSplitAgg.find((g) => g.isTestTraffic === false)?._count._all ?? 0;
    const monthTestCalls =
      monthSplitAgg.find((g) => g.isTestTraffic === true)?._count._all ?? 0;

    return {
      capUsd: cap,
      hardStop,
      monthSpentUsd,
      monthCalls,
      todaySpentUsd: Number(todayAgg._sum.costUsd ?? 0),
      todayCalls: todayAgg._count._all,
      byCallSite,
      daily,
      cache: {
        // Tokens classified as cache write vs cache read this month.
        createTokens: monthCacheCreate,
        readTokens: monthCacheRead,
        // Hit ratio — what fraction of cache traffic was a read (the
        // cheap path). Closer to 1 = the cache is paying off.
        hitRatio: Math.round(cacheHitRatio * 1000) / 1000,
        // What the cached tokens would have cost without caching.
        baselineUsd: Math.round(baselineUsd * 1_000_000) / 1_000_000,
        // What they actually cost — write at 1.25×, read at 0.1×.
        actualUsd: Math.round(actualUsd * 1_000_000) / 1_000_000,
        // Net saving (always ≥ 0).
        savedUsd: Math.round(cacheSavedUsd * 1_000_000) / 1_000_000,
      },
      perQuestion: {
        windowHours: 24,
        questions: questionsToday,
        // `spendUsd` is REAL-customer spend only (was previously total
        // spend, which mixed dev/test load and inflated the per-msg cost
        // by 30-50%). `spendUsdTest` exposes the test-bucket separately
        // so Marcos can see how much of the dashboard total is ours.
        spendUsd: Math.round(realCost24h * 100) / 100,
        spendUsdTest: Math.round(testCost24h * 100) / 100,
        costPerQuestionUsd: Math.round(costPerQuestionUsd * 10_000) / 10_000,
      },
      attribution: {
        // Month-level split so the operator sees "$X went to real
        // customers, $Y went to dev/test". Both buckets add up to
        // `monthSpentUsd` (the legacy total field above).
        monthRealUsd: Math.round(monthRealUsd * 100) / 100,
        monthTestUsd: Math.round(monthTestUsd * 100) / 100,
        monthRealCalls,
        monthTestCalls,
      },
      // Marcos 2026-06-24: Bloque E visibility.
      costOpts: await this.costOptsBreakdown(inputPricePerMtok),
    };
  }

  /**
   * Marcos 2026-06-24: agregado mensual de eventos de Bloque E. Cuenta
   * cuántas veces cada source (FAQ pre-IA, publication-FAQ, etc) se
   * activó este mes, suma tokens estimados ahorrados, y traduce a USD
   * usando el precio actual de input. Si CostOptCounter no esta
   * inyectado (e.g. test seed) devuelve zeros sin fallar.
   */
  private async costOptsBreakdown(inputPricePerMtok: number): Promise<UsageStats['costOpts']> {
    if (!this.costOptCounter) {
      return { bySource: [], totalCount: 0, totalTokensSaved: 0, totalUsdSaved: 0 };
    }
    try {
      const summary = await this.costOptCounter.monthSummary();
      const bySource = summary.bySource.map((r) => ({
        source: r.source,
        count: r.count,
        estimatedTokensSaved: r.estimatedTokensSaved,
        estimatedUsdSaved: Math.round(((r.estimatedTokensSaved * inputPricePerMtok) / 1_000_000) * 1_000_000) / 1_000_000,
      }));
      const totalUsdSaved = Math.round(((summary.totalTokensSaved * inputPricePerMtok) / 1_000_000) * 1_000_000) / 1_000_000;
      return {
        bySource,
        totalCount: summary.totalCount,
        totalTokensSaved: summary.totalTokensSaved,
        totalUsdSaved,
      };
    } catch (err: any) {
      this.logger.warn(`cost-opt breakdown failed (non-fatal): ${err.message}`);
      return { bySource: [], totalCount: 0, totalTokensSaved: 0, totalUsdSaved: 0 };
    }
  }

  /**
   * Marcos 2026-06-05 (dispute settlement): para validar Bloque E
   * el cliente necesita ver con datos concretos cuánto bajó el costo
   * después de los 5 cost opts (N1 → Haiku, FAQ pre-IA, batch ML,
   * compresión historial, caps L1/L2). Este snapshot compara dos
   * ventanas de 10 días: la previa al deploy de las opts vs la
   * última semana. Ambas usan el mismo filtro `isTestTraffic=false`
   * para no inflarse con tráfico de dev/test.
   *
   * `optsLiveSince` se lee de env (CLAUDE_OPTS_LIVE_SINCE_ISO) con
   * default 2026-06-05 — el día que el todo.md registra el deploy
   * de las opts. Si el cliente cambia esa fecha el snapshot lo
   * refleja sin recompilar.
   */
  async getSavingsSnapshot(): Promise<{
    optsLiveSince: string;
    baseline: SavingsWindow;
    current: SavingsWindow;
    delta: {
      costPctChange: number;          // -0.85 = -85% (cheaper)
      callsPctChange: number;
      costPerQuestionPctChange: number;
    };
    byModelCurrent: Array<{ model: string; calls: number; costUsd: number; share: number }>;
    byCallSiteCurrent: Array<{ callSite: string; calls: number; costUsd: number; share: number }>;
  }> {
    const optsIso = (process.env.CLAUDE_OPTS_LIVE_SINCE_ISO || '2026-06-05T00:00:00Z').trim();
    const optsDate = new Date(optsIso);
    if (Number.isNaN(optsDate.getTime())) {
      throw new Error(`Invalid CLAUDE_OPTS_LIVE_SINCE_ISO: ${optsIso}`);
    }
    const windowDays = num('CLAUDE_SAVINGS_WINDOW_DAYS', 10);
    const dayMs = 86400 * 1000;
    // Baseline: 10 días JUSTO ANTES del deploy de las opts.
    const baselineTo = optsDate;
    const baselineFrom = new Date(optsDate.getTime() - windowDays * dayMs);
    // Current: últimos 10 días (rolling).
    const currentTo = new Date();
    const currentFrom = new Date(currentTo.getTime() - windowDays * dayMs);

    const summarize = async (from: Date, to: Date): Promise<SavingsWindow> => {
      const agg = await this.prisma.claudeUsageEvent.aggregate({
        where: {
          createdAt: { gte: from, lt: to },
          isTestTraffic: false,
        },
        _count: { _all: true },
        _sum: { costUsd: true, inputTokens: true, outputTokens: true, cacheReadTokens: true },
      });
      const cost = Number(agg._sum.costUsd ?? 0);
      const calls = agg._count._all;
      const rawQuestions = await this.prisma.message.findMany({
        where: {
          sender: 'CUSTOMER',
          timestamp: { gte: from, lt: to },
          conversation: { isSandbox: false },
        },
        select: { conversation: { select: { contact: { select: { name: true } } } } },
      });
      const questions = rawQuestions.filter(
        (m) => !looksLikeTestContactName(m.conversation?.contact?.name),
      ).length;
      return {
        fromIso: from.toISOString(),
        toIso: to.toISOString(),
        days: Math.round((to.getTime() - from.getTime()) / dayMs),
        costUsd: Math.round(cost * 100) / 100,
        calls,
        questions,
        costPerCallUsd: calls > 0 ? Math.round((cost / calls) * 10_000) / 10_000 : 0,
        costPerQuestionUsd: questions > 0 ? Math.round((cost / questions) * 10_000) / 10_000 : 0,
        inputTokens: agg._sum.inputTokens ?? 0,
        outputTokens: agg._sum.outputTokens ?? 0,
        cacheReadTokens: agg._sum.cacheReadTokens ?? 0,
      };
    };

    const baseline = await summarize(baselineFrom, baselineTo);
    const current = await summarize(currentFrom, currentTo);

    const pctChange = (now: number, before: number): number =>
      before > 0 ? Math.round(((now - before) / before) * 1000) / 1000 : 0;

    // Model split y callSite split para la ventana actual — el
    // cliente quiere ver QUÉ modelo está pagando (Haiku barato vs
    // Sonnet caro) y EN QUÉ se gasta (replies vs JSON classify).
    const modelRaw = await this.prisma.claudeUsageEvent.groupBy({
      by: ['model'],
      where: {
        createdAt: { gte: currentFrom, lt: currentTo },
        isTestTraffic: false,
      },
      _count: { _all: true },
      _sum: { costUsd: true },
    });
    const totalCurrentCost = current.costUsd || 1;
    const byModelCurrent = modelRaw
      .map((g) => ({
        model: g.model,
        calls: g._count._all,
        costUsd: Math.round(Number(g._sum.costUsd ?? 0) * 100) / 100,
        share: Math.round((Number(g._sum.costUsd ?? 0) / totalCurrentCost) * 1000) / 1000,
      }))
      .sort((a, b) => b.costUsd - a.costUsd);

    const callSiteRaw = await this.prisma.claudeUsageEvent.groupBy({
      by: ['callSite'],
      where: {
        createdAt: { gte: currentFrom, lt: currentTo },
        isTestTraffic: false,
      },
      _count: { _all: true },
      _sum: { costUsd: true },
    });
    const byCallSiteCurrent = callSiteRaw
      .map((g) => ({
        callSite: g.callSite,
        calls: g._count._all,
        costUsd: Math.round(Number(g._sum.costUsd ?? 0) * 100) / 100,
        share: Math.round((Number(g._sum.costUsd ?? 0) / totalCurrentCost) * 1000) / 1000,
      }))
      .sort((a, b) => b.costUsd - a.costUsd);

    return {
      optsLiveSince: optsDate.toISOString(),
      baseline,
      current,
      delta: {
        costPctChange: pctChange(current.costUsd, baseline.costUsd),
        callsPctChange: pctChange(current.calls, baseline.calls),
        costPerQuestionPctChange: pctChange(current.costPerQuestionUsd, baseline.costPerQuestionUsd),
      },
      byModelCurrent,
      byCallSiteCurrent,
    };
  }
}

export interface SavingsWindow {
  fromIso: string;
  toIso: string;
  days: number;
  costUsd: number;
  calls: number;
  questions: number;
  costPerCallUsd: number;
  costPerQuestionUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}
