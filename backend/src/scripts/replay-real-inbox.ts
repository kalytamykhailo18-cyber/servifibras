/**
 * Offline replay harness — pulls a random sample of REAL customer
 * conversations from the live DB (paused ones — nobody sees the reply),
 * rebuilds the AIConversation exactly the way the production
 * conversation handler would, and asks ClaudeService.continueConversation
 * what it WOULD have answered. The reply is written to a JSONL report;
 * no outbound message is sent, no conversation row is mutated.
 *
 * Why: WHATSAPP_DEFAULT_AI_PAUSED=true means the agent has never faced
 * real-customer inputs at scale — every complaint we get is from Marcos's
 * personal probes. This lets us surface the systemic failure modes that
 * the manual-testing loop would take weeks to find.
 *
 * All knobs read from .env — never hardcoded (project rule).
 */

import { NestFactory } from '@nestjs/core';
import { PrismaClient, Channel, MessageSender } from '@prisma/client';
import { promises as fs } from 'node:fs';
import { AppModule } from '../app.module';
import { ClaudeService } from '../adapters/ai/claude.service';
import { AIConversation, AIMessage } from '../domain/entities/ai-message.entity';
import { getMessageCipher } from '../adapters/security/message-cipher';

const STAFF_SENDERS = new Set<MessageSender>([
  MessageSender.ADMIN,
  MessageSender.BRENDA,
  MessageSender.FRANCO,
  MessageSender.ALDO,
]);

interface ReplayEntry {
  convId: string;
  contactId: string;
  historyTurns: number;
  lastCustomerMsg: string;
  agentReply: string;
  latencyMs: number;
  error?: string;
}

function buildAIContext(rawMessages: Array<{ isFromAI: boolean; sender: MessageSender; content: string }>): AIConversation {
  const cipher = getMessageCipher();
  const raw: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const msg of rawMessages) {
    const content = cipher.decrypt(msg.content ?? '').trim();
    if (content.length === 0) continue;
    let role: 'user' | 'assistant';
    if (msg.isFromAI) role = 'assistant';
    else if (STAFF_SENDERS.has(msg.sender)) role = 'assistant';
    else role = 'user';
    raw.push({ role, content });
  }
  const merged: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const m of raw) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n\n${m.content}`;
    else merged.push({ role: m.role, content: m.content });
  }
  return new AIConversation(merged.map((m) => new AIMessage(m.role, m.content)));
}

async function main() {
  const lookbackDays = Number(process.env.REPLAY_LOOKBACK_DAYS ?? 5);
  const sampleSize = Number(process.env.REPLAY_SAMPLE_SIZE ?? 20);
  const historyLimit = Number(process.env.REPLAY_HISTORY_LIMIT ?? 15);
  const outFile =
    process.env.REPLAY_OUT_JSONL ??
    `/tmp/replay-real-inbox-${Date.now()}.jsonl`;
  const skipConvId = process.env.REPLAY_SKIP_CONV_ID ?? '';

  console.log(
    `[replay] lookback=${lookbackDays}d sample=${sampleSize} historyLimit=${historyLimit} out=${outFile}`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  const prisma = new PrismaClient();
  const claude = app.get(ClaudeService);

  const since = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);

  // Pull random convs whose LAST message came from CUSTOMER (i.e. still
  // waiting for a reply — those are the ones where the agent's answer
  // matters). Include Marcos's own test conv only if not skipped.
  const convs: Array<{ id: string; contactId: string; lastMessageAt: Date | null }> =
    await prisma.$queryRawUnsafe(`
      SELECT c.id, c."contactId", c."lastMessageAt"
      FROM conversations c
      WHERE c.channel = 'WHATSAPP'
        AND COALESCE(c."isSandbox", false) = false
        AND c."lastMessageAt" >= $1
        AND ($2 = '' OR c.id <> $2)
        AND EXISTS (
          SELECT 1 FROM messages m
          WHERE m."conversationId" = c.id
            AND m.timestamp >= $1
            AND m.sender = 'CUSTOMER'
        )
      ORDER BY random()
      LIMIT $3
    `, since, skipConvId, sampleSize);

  console.log(`[replay] picked ${convs.length} conversations`);

  const outFd = await fs.open(outFile, 'w');
  let successes = 0;
  let failures = 0;

  for (const [i, conv] of convs.entries()) {
    const history = await prisma.message.findMany({
      where: { conversationId: conv.id },
      orderBy: { timestamp: 'desc' },
      take: historyLimit,
      select: { isFromAI: true, sender: true, content: true, timestamp: true },
    });
    history.reverse();

    // Find last CUSTOMER message; skip its raw text out of the priorHistory
    // and pass it as `newMessage`. If it's empty/media, skip conv.
    let lastCustomerIdx = -1;
    for (let j = history.length - 1; j >= 0; j--) {
      if (history[j].sender === MessageSender.CUSTOMER) { lastCustomerIdx = j; break; }
    }
    if (lastCustomerIdx < 0) continue;
    const cipher = getMessageCipher();
    const lastCustomerMsg = cipher.decrypt(history[lastCustomerIdx].content ?? '').trim();
    if (lastCustomerMsg.length === 0) continue;

    const priorHistory = history.slice(0, lastCustomerIdx);
    const aiConv = buildAIContext(priorHistory);

    const t0 = Date.now();
    let entry: ReplayEntry;
    try {
      const reply = await claude.continueConversation(aiConv, lastCustomerMsg, {
        channel: Channel.WHATSAPP,
        contactId: conv.contactId,
        isTestTraffic: true,
        isContinuation: aiConv.messages.length > 0,
      });
      entry = {
        convId: conv.id,
        contactId: conv.contactId,
        historyTurns: aiConv.messages.length,
        lastCustomerMsg,
        agentReply: reply,
        latencyMs: Date.now() - t0,
      };
      successes++;
    } catch (err: any) {
      entry = {
        convId: conv.id,
        contactId: conv.contactId,
        historyTurns: aiConv.messages.length,
        lastCustomerMsg,
        agentReply: '',
        latencyMs: Date.now() - t0,
        error: String(err?.message ?? err),
      };
      failures++;
    }
    await outFd.write(JSON.stringify(entry) + '\n');
    console.log(
      `[replay] ${String(i + 1).padStart(3, '0')}/${convs.length} conv=${conv.id.slice(0, 8)} ` +
        `hist=${entry.historyTurns} q="${entry.lastCustomerMsg.replace(/\s+/g, ' ').slice(0, 60)}" ` +
        `→ r="${entry.agentReply.replace(/\s+/g, ' ').slice(0, 80)}" ${entry.latencyMs}ms` +
        (entry.error ? ` ERROR: ${entry.error.slice(0, 100)}` : ''),
    );
  }

  await outFd.close();
  console.log(`[replay] done — ${successes} ok, ${failures} errors, out=${outFile}`);
  await prisma.$disconnect();
  await app.close();
}

main().catch((err) => {
  console.error(`[replay] fatal: ${err?.message ?? err}`);
  console.error(err?.stack);
  process.exit(1);
});
