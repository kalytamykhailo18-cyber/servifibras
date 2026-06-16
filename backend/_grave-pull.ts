import { PrismaClient } from '@prisma/client';
import { getMessageCipher } from './src/adapters/security/message-cipher';
(async () => {
  const prisma = new PrismaClient();
  const cipher = getMessageCipher();
  const rows = await prisma.conversationScore.findMany({
    where: { severeFlag: { not: 'NONE' } },
    orderBy: { createdAt: 'desc' },
    include: {
      conversation: {
        include: {
          messages: { orderBy: { timestamp: 'asc' }, take: 30 },
          contact: { select: { name: true } },
        },
      },
    },
  });
  console.log(`Total grave: ${rows.length}`);
  for (const r of rows) {
    console.log(`\n---\nscore=${r.score} flag=${r.severeFlag} convId=${r.conversationId.slice(0,8)} channel=${r.conversation.channel}`);
    console.log(`reason: ${r.severeReason}`);
    console.log(`contact: ${r.conversation.contact?.name}`);
    const msgs = r.conversation.messages;
    msgs.forEach(m => {
      const who = m.sender === 'CUSTOMER' ? 'CLIENT' : (m.isFromAI ? 'AI' : 'OP');
      let t;
      try { t = cipher.decrypt(m.content ?? ''); } catch { t = m.content ?? ''; }
      console.log(`  [${who}] ${(t || '').slice(0, 200).replace(/\n/g, ' ⏎ ')}`);
    });
  }
  await prisma.$disconnect();
})();
