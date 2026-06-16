import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();

  console.log('=== Sandbox cleanup (DRY RUN by default — pass --apply to delete) ===\n');
  const apply = process.argv.includes('--apply');

  // Conversation IDs to clean
  const sandboxConvIds = (await prisma.conversation.findMany({
    where: { isSandbox: true },
    select: { id: true },
  })).map((c) => c.id);

  const sandboxContactIds = (await prisma.contact.findMany({
    where: { isSandbox: true },
    select: { id: true },
  })).map((c) => c.id);

  console.log(`Sandbox conversations:   ${sandboxConvIds.length}`);
  console.log(`Sandbox contacts:        ${sandboxContactIds.length}`);

  if (!apply) {
    console.log('\nDRY RUN — no rows deleted. Pass --apply to execute.');
    await prisma.$disconnect();
    return;
  }

  console.log('\nDeleting...');

  // Order: scores → messages → conversation_examples linked → leads/orders → conversations → contacts
  // Use deleteMany with conversationId filter.
  const scoresDeleted = await prisma.conversationScore.deleteMany({
    where: { conversationId: { in: sandboxConvIds } },
  });
  console.log(`  conversation_scores: ${scoresDeleted.count}`);

  const msgsDeleted = await prisma.message.deleteMany({
    where: { conversationId: { in: sandboxConvIds } },
  });
  console.log(`  messages:            ${msgsDeleted.count}`);

  // Internal notes attached to these conversations
  try {
    const notesDeleted = await prisma.internalNote.deleteMany({
      where: { conversationId: { in: sandboxConvIds } },
    });
    console.log(`  internal_notes:      ${notesDeleted.count}`);
  } catch (err: any) {
    console.log(`  internal_notes:      skipped (${err.message})`);
  }

  // Leads attached to sandbox contacts
  try {
    const leadsDeleted = await prisma.lead.deleteMany({
      where: { contactId: { in: sandboxContactIds } },
    });
    console.log(`  leads:               ${leadsDeleted.count}`);
  } catch (err: any) {
    console.log(`  leads:               skipped (${err.message})`);
  }

  // Orders attached to sandbox contacts
  try {
    const ordersDeleted = await prisma.order.deleteMany({
      where: { contactId: { in: sandboxContactIds } },
    });
    console.log(`  orders:              ${ordersDeleted.count}`);
  } catch (err: any) {
    console.log(`  orders:              skipped (${err.message})`);
  }

  const convsDeleted = await prisma.conversation.deleteMany({
    where: { isSandbox: true },
  });
  console.log(`  conversations:       ${convsDeleted.count}`);

  const contactsDeleted = await prisma.contact.deleteMany({
    where: { isSandbox: true },
  });
  console.log(`  contacts:            ${contactsDeleted.count}`);

  console.log('\nDone.');
  await prisma.$disconnect();
})();
