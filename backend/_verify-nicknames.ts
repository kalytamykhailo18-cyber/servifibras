import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();
  // Most recent 5 non-sandbox ML contacts
  const recent = await prisma.contact.findMany({
    where: { channel: 'MERCADOLIBRE', isSandbox: false },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: { id: true, name: true, createdAt: true, metadata: true },
  });
  console.log('Most-recent non-sandbox ML contacts:');
  for (const c of recent) {
    console.log(`  ${c.createdAt.toISOString()}  name="${c.name}"  meta=${JSON.stringify(c.metadata)}`);
  }
  await prisma.$disconnect();
})();
