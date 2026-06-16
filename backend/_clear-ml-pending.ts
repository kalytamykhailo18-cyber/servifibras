import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();

  // Pre-venta on ML = QUESTION-type inbound. Reviews and claims keep
  // needsHumanAttention=true on purpose (legal-sensitive, post-purchase).
  // Distinguishing: review/claim conversations have a placeholder
  // message with metadata.kind === 'ml_review' or 'ml_claim'.
  const candidates = await prisma.conversation.findMany({
    where: {
      channel: 'MERCADOLIBRE',
      needsHumanAttention: true,
    },
    select: {
      id: true,
      isSandbox: true,
      escalatedAt: true,
      assignedTo: true,
      messages: {
        where: {
          OR: [
            { metadata: { path: ['kind'], equals: 'ml_review' } },
            { metadata: { path: ['kind'], equals: 'ml_claim' } },
          ],
        },
        take: 1,
        select: { id: true, metadata: true },
      },
    },
  });

  console.log(`ML conversations with needsHumanAttention=true: ${candidates.length}`);

  const toClear = candidates.filter((c) => c.messages.length === 0);
  const keep = candidates.filter((c) => c.messages.length > 0);
  console.log(`  → pre-venta QUESTION (to clear): ${toClear.length}`);
  console.log(`  → review/claim (kept): ${keep.length}`);

  if (toClear.length > 0) {
    const ids = toClear.map((c) => c.id);
    const result = await prisma.conversation.updateMany({
      where: { id: { in: ids } },
      data: {
        needsHumanAttention: false,
        escalatedAt: null,
      },
    });
    console.log(`Cleared ${result.count} conversations.`);
  }

  await prisma.$disconnect();
})();
