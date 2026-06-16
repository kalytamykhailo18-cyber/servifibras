import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();

  const all = await prisma.conversationScore.count();
  const grave = await prisma.conversationScore.count({ where: { severeFlag: { not: 'NONE' } } });
  const noneWithError = await prisma.conversationScore.count({
    where: { severeFlag: 'NONE', rawError: { not: null } },
  });
  const markerSkipped = await prisma.conversationScore.count({
    where: { rawError: 'skipped_internal_marker_only' },
  });
  const claudeNull = await prisma.conversationScore.count({
    where: { rawError: 'claude_returned_null' },
  });

  console.log(`total scores:           ${all}`);
  console.log(`current grave:          ${grave}`);
  console.log(`NONE + rawError:        ${noneWithError}`);
  console.log(`marker-skipped:         ${markerSkipped}`);
  console.log(`claude_returned_null:   ${claudeNull}`);

  // Re-score the rows whose previous score was wiped to NONE by the
  // budget-exhausted run. They had real flags before; let's re-score
  // them with the new scorer config (channel guide + catalog with prices).
  const candidates = await prisma.conversationScore.findMany({
    where: { rawError: 'claude_returned_null' },
    select: { conversationId: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  console.log(`\nrows to re-score (claude_returned_null): ${candidates.length}`);
  for (const c of candidates.slice(0, 5)) {
    console.log(`  ${c.conversationId.slice(0,8)} updated=${c.updatedAt.toISOString()}`);
  }

  await prisma.$disconnect();
})();
