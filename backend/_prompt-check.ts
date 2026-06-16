import { PrismaClient } from '@prisma/client';
(async () => {
  const prisma = new PrismaClient();
  const cfg = await prisma.configuration.findUnique({ where: { key: 'lucas_prompt' } });
  if (cfg) {
    const val = cfg.value as any;
    console.log('DB override ACTIVE');
    console.log(`length: ${(val?.content || '').length}`);
    console.log(`first 200 chars: ${(val?.content || '').slice(0, 200)}`);
  } else {
    console.log('No DB override — using file at LUCAS_PROMPT_PATH');
  }
  await prisma.$disconnect();
})();
