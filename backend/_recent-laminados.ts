import { PrismaClient } from '@prisma/client';
import { getMessageCipher } from './src/adapters/security/message-cipher';
(async () => {
  const prisma = new PrismaClient();
  const cipher = getMessageCipher();

  // Most-recent ML conversations after my path-(b) deploy (~17:30 UTC
  // today) where the agent emitted a reply. Looking for laminate-titled
  // publications that still got answered.
  const since = new Date('2026-06-02T17:30:00Z');
  const recent = await prisma.conversation.findMany({
    where: {
      channel: 'MERCADOLIBRE',
      isSandbox: false,
      createdAt: { gte: since },
    },
    orderBy: { updatedAt: 'desc' },
    take: 30,
    select: {
      id: true,
      createdAt: true,
      needsHumanAttention: true,
      metadata: true,
      messages: {
        orderBy: { timestamp: 'asc' },
        take: 5,
        select: { sender: true, content: true, timestamp: true, isFromAI: true },
      },
    },
  });

  let lamCount = 0;
  for (const c of recent) {
    const firstClient = c.messages.find((m) => m.sender === 'CUSTOMER');
    const firstAi = c.messages.find((m) => m.isFromAI);
    if (!firstClient) continue;
    let q = '';
    try { q = cipher.decrypt(firstClient.content ?? ''); } catch {}
    const lamText = /\b(lamin|l[áa]mina|plancha|prfv|revestimiento)\b/i.test(q);
    if (lamText) {
      lamCount++;
      console.log(`\n${c.createdAt.toISOString()}  needsHuman=${c.needsHumanAttention}  itemId=${(c.metadata as any)?.mercadolibreItemId ?? '-'}`);
      console.log(`  Q: ${q.slice(0, 200).replace(/\n/g, ' ⏎ ')}`);
      if (firstAi) {
        let a = '';
        try { a = cipher.decrypt(firstAi.content ?? ''); } catch {}
        console.log(`  A: ${a.slice(0, 200).replace(/\n/g, ' ⏎ ')}`);
      } else {
        console.log(`  (no AI reply emitted)`);
      }
    }
  }
  console.log(`\nLaminate-text questions since 17:30 UTC: ${lamCount}`);
  await prisma.$disconnect();
})();
