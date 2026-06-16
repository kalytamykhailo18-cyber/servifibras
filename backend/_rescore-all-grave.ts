import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();
  // Authenticate
  const r = await fetch('http://localhost:3001/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@servifibras.com', password: 'admin123' }),
  });
  const j: any = await r.json();
  const tk = j.accessToken || j.token;
  if (!tk) { console.log('No token', j); process.exit(1); }

  const graves = await prisma.conversationScore.findMany({
    where: { severeFlag: { not: 'NONE' } },
    orderBy: { createdAt: 'desc' },
    select: { conversationId: true, severeFlag: true, score: true },
  });
  console.log(`Re-scoring ${graves.length} grave conversations...`);
  const tally = { skipped: 0, stillGrave: 0, cleared: 0, failed: 0 };
  for (const g of graves) {
    try {
      const rr = await fetch(`http://localhost:3001/admin/quality/${g.conversationId}/rescore`, {
        method: 'POST', headers: { Authorization: `Bearer ${tk}` },
      });
      const jj: any = await rr.json();
      const after = jj?.data;
      const newFlag = after?.severeFlag ?? 'unknown';
      const newScore = after?.score;
      let bucket;
      if (after?.rawError === 'skipped_internal_marker_only' || (newScore === null && newFlag === 'NONE')) bucket = 'skipped';
      else if (newFlag !== 'NONE') bucket = 'stillGrave';
      else bucket = 'cleared';
      tally[bucket]++;
      console.log(`  ${g.conversationId.slice(0,8)}  ${g.severeFlag} → ${newFlag}  (score ${g.score}→${newScore})  [${bucket}]`);
    } catch (e: any) {
      tally.failed++;
      console.log(`  ${g.conversationId.slice(0,8)} ERR: ${e.message}`);
    }
  }
  console.log(`\nTally: ${JSON.stringify(tally)}`);
  // Refresh: pull cleaned grave set
  const after = await prisma.conversationScore.findMany({
    where: { severeFlag: { not: 'NONE' } },
    select: { conversationId: true, severeFlag: true, severeReason: true, score: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`\nGrave alerts AFTER re-score: ${after.length}`);
  for (const a of after) {
    console.log(`  ${a.conversationId.slice(0,8)} score=${a.score} flag=${a.severeFlag}`);
    console.log(`    ${(a.severeReason || '').slice(0, 200)}`);
  }
  await prisma.$disconnect();
})();
