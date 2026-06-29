import { PrismaClient } from '@prisma/client';
import { getMessageCipher } from '../adapters/security/message-cipher';

async function main() {
  const prisma = new PrismaClient();
  const cipher = getMessageCipher();
  const rows = await prisma.message.findMany({
    where: {
      isFromAI: true,
      timestamp: { gte: new Date(Date.now() - 48 * 3600 * 1000) },
      conversation: { channel: 'MERCADOLIBRE' as any },
    },
    orderBy: { timestamp: 'desc' },
    take: 30,
    select: { id: true, content: true, timestamp: true, metadata: true },
  });
  for (const r of rows) {
    const meta = (r.metadata as any) ?? {};
    const text = cipher.decrypt(r.content);
    console.log(`\n--- ${r.timestamp.toISOString()} item=${meta.mlItemId ?? '-'} ---`);
    console.log(text.slice(0, 400));
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
