/**
 * One-shot maintenance script — re-encrypts every plaintext row left
 * over from before `CONVERSATION_ENCRYPTION_KEY` was turned on.
 *
 * Walks three columns: Message.content, Conversation.lastMessage,
 * InternalNote.content. For each non-empty row whose value does NOT
 * already start with the `enc:v1:` sentinel, encrypts in place. The
 * cipher's pass-through behavior on legacy rows means the system is
 * already mixed-mode-readable; this script's job is to remove the mix.
 *
 * Idempotent — running it twice is a no-op on already-encrypted rows.
 *
 * Usage:
 *   ts-node scripts/encrypt-existing-rows.ts            # dry run
 *   ts-node scripts/encrypt-existing-rows.ts --apply    # write
 *
 * Run on a quiet window — every UPDATE goes through Prisma so writes
 * are safe under concurrent reads, but a heavy chat hour will produce
 * extra DB traffic.
 */

import { PrismaClient } from '@prisma/client';
import { MessageCipher, getMessageCipher } from '../src/adapters/security/message-cipher';

const SENTINEL = 'enc:v1:';
const BATCH_SIZE = 500;

interface Stats {
  scanned: number;
  alreadyEncrypted: number;
  emptyOrNull: number;
  rewrote: number;
  failed: number;
}
function newStats(): Stats {
  return { scanned: 0, alreadyEncrypted: 0, emptyOrNull: 0, rewrote: 0, failed: 0 };
}

async function backfillTable(
  prisma: PrismaClient,
  cipher: MessageCipher,
  apply: boolean,
  table: 'message' | 'conversation' | 'internalNote',
  column: 'content' | 'lastMessage',
): Promise<Stats> {
  const stats = newStats();
  const tableLabel = `${table}.${column}`;

  let cursor: string | null = null;
  while (true) {
    const args: any = {
      where: cursor ? { id: { gt: cursor } } : {},
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, [column]: true },
    };
    const batch = await (prisma as any)[table].findMany(args);
    if (batch.length === 0) break;

    for (const row of batch) {
      stats.scanned++;
      const value: string | null = row[column];
      if (value == null || value.length === 0) {
        stats.emptyOrNull++;
        continue;
      }
      if (value.startsWith(SENTINEL)) {
        stats.alreadyEncrypted++;
        continue;
      }
      const encrypted = cipher.encrypt(value);
      // Defense-in-depth: if the cipher returned the same value (key
      // missing), don't write — this is the no-key-loaded scenario and
      // the script should be a no-op there.
      if (!encrypted.startsWith(SENTINEL)) {
        stats.failed++;
        continue;
      }
      if (apply) {
        try {
          await (prisma as any)[table].update({
            where: { id: row.id },
            data: { [column]: encrypted },
          });
          stats.rewrote++;
        } catch (err: any) {
          console.error(`[${tableLabel}] update failed for ${row.id}: ${err.message}`);
          stats.failed++;
        }
      } else {
        stats.rewrote++;
      }
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH_SIZE) break;
  }
  return stats;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const cipher = getMessageCipher();
  if (!cipher.isEnabled()) {
    console.error(
      'CONVERSATION_ENCRYPTION_KEY is not set in the environment. ' +
      'Refusing to run — there is nothing to encrypt with.',
    );
    process.exit(2);
  }

  const prisma = new PrismaClient();
  console.log(apply ? 'APPLY mode — writes will go through' : 'DRY RUN — no writes');

  const tables: Array<{ table: 'message' | 'conversation' | 'internalNote'; column: 'content' | 'lastMessage' }> = [
    { table: 'message',       column: 'content' },
    { table: 'conversation',  column: 'lastMessage' },
    { table: 'internalNote',  column: 'content' },
  ];

  let totalRewrote = 0;
  for (const t of tables) {
    console.log(`\n→ ${t.table}.${t.column}`);
    const s = await backfillTable(prisma, cipher, apply, t.table, t.column);
    console.log(
      `  scanned=${s.scanned}  already=${s.alreadyEncrypted}  empty=${s.emptyOrNull}  ` +
      `${apply ? 'rewrote' : 'wouldRewrite'}=${s.rewrote}  failed=${s.failed}`,
    );
    totalRewrote += s.rewrote;
  }

  console.log(
    `\nDone. ${apply ? 'Encrypted' : 'Would encrypt'} ${totalRewrote} rows in total.`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
