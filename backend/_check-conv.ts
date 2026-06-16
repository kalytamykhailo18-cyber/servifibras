import { PrismaClient } from '@prisma/client';
import { getMessageCipher } from './src/adapters/security/message-cipher';
(async () => {
  const prisma = new PrismaClient();
  const cipher = getMessageCipher();
  const conv = await prisma.conversation.findFirst({
    where: { channel: 'MERCADOLIBRE', createdAt: { gte: new Date('2026-06-02T22:55:00Z'), lte: new Date('2026-06-02T22:56:30Z') } },
    include: {
      messages: { orderBy: { timestamp: 'asc' } },
    },
  });
  if (!conv) { console.log('not found'); return; }
  console.log(`Conv ${conv.id} channel=${conv.channel} needsHuman=${conv.needsHumanAttention} metadata=${JSON.stringify(conv.metadata)}`);
  for (const m of conv.messages) {
    let t = '';
    try { t = cipher.decrypt(m.content ?? ''); } catch { t = m.content?.slice(0,40) ?? ''; }
    console.log(`  ${m.timestamp.toISOString()} ${m.sender} ai=${m.isFromAI}: ${t.slice(0, 250).replace(/\n/g, ' ⏎ ')}`);
  }
  await prisma.$disconnect();
})();
