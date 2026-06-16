import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();

  console.log('=== Test-data audit (READ-ONLY) ===\n');

  // Sandbox-tagged
  const sandboxConvs = await prisma.conversation.count({ where: { isSandbox: true } });
  const sandboxContacts = await prisma.contact.count({ where: { isSandbox: true } });
  console.log(`isSandbox=true conversations: ${sandboxConvs}`);
  console.log(`isSandbox=true contacts:      ${sandboxContacts}`);

  // Messages in sandbox conversations
  const sandboxMsgs = await prisma.message.count({
    where: { conversation: { isSandbox: true } },
  });
  const sandboxScores = await prisma.conversationScore.count({
    where: { conversation: { isSandbox: true } },
  });
  console.log(`messages in sandbox convs:    ${sandboxMsgs}`);
  console.log(`scores in sandbox convs:      ${sandboxScores}`);

  // Real (non-sandbox) data that would be preserved
  const realConvs = await prisma.conversation.count({ where: { isSandbox: false } });
  const realContacts = await prisma.contact.count({ where: { isSandbox: false } });
  console.log(`\nNON-sandbox conversations (preserved): ${realConvs}`);
  console.log(`NON-sandbox contacts (preserved):      ${realContacts}`);

  // Real data sample
  const sample = await prisma.conversation.findMany({
    where: { isSandbox: false },
    orderBy: { updatedAt: 'desc' },
    take: 10,
    select: {
      id: true,
      channel: true,
      updatedAt: true,
      contact: { select: { name: true, channel: true } },
    },
  });
  console.log(`\nSample of NON-sandbox conversations (most recent ${sample.length}):`);
  for (const c of sample) {
    console.log(`  ${c.updatedAt.toISOString()}  ${c.channel.padEnd(20)}  ${c.contact?.name ?? '(no name)'}`);
  }

  // Also check: marker-only conversations that might NOT be tagged
  // sandbox (the channel-toggle probe creates rows via webchat without
  // setting isSandbox in some cases).
  const markerLeftovers = await prisma.message.count({
    where: {
      content: { contains: 'MARKER-' },
    },
  });
  console.log(`\nMessages still containing MARKER-* string (encrypted, so 0 expected): ${markerLeftovers}`);

  await prisma.$disconnect();
})();
