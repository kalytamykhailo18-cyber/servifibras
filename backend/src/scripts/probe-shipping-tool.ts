/**
 * Probe the consultar_envio tool end-to-end: boots ClaudeService in an
 * isolated Nest context (WHATSAPP_QR_ENABLED overridden so we don't
 * kick the prod Baileys socket) and runs a handful of synthetic
 * shipping-question turns through the real tool loop. Prints each
 * question + the agent's reply.
 *
 * Marcos 2026-08-19 (Ustym report Frente C): the C1 conversation showed
 * the agent asking for the CP three times and never answering. This
 * probe reproduces that shape and confirms the new tool + prompt path
 * breaks the loop.
 *
 *   set -a && . ./.env && set +a
 *   WHATSAPP_QR_ENABLED=false \
 *     npx ts-node --transpile-only src/scripts/probe-shipping-tool.ts
 */

import { NestFactory } from '@nestjs/core';
import { Channel } from '@prisma/client';
import { AppModule } from '../app.module';
import { ClaudeService } from '../adapters/ai/claude.service';
import { AIConversation } from '../domain/entities/ai-message.entity';

const CASES = process.env.PROBE_CASES
  ? JSON.parse(process.env.PROBE_CASES) as string[]
  : [
      'Hola buenos días, si quisiera mandarle a mi prima que vive en córdoba capital, ¿cuánto saldría?',
      'quisiera saber cuanto sale el envío a CABA',
      'hacen envíos a Salta?',
      '¿cuánto sale mandar a Palermo?',
      'llegan a La Plata?',
    ];

async function main() {
  if ((process.env.WHATSAPP_QR_ENABLED ?? '').toLowerCase() !== 'false') {
    console.error(
      '[probe] refusing to boot with WHATSAPP_QR_ENABLED != false — would steal the prod WA socket.',
    );
    process.exit(2);
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  const claude = app.get(ClaudeService);
  const emptyConv = new AIConversation([]);

  for (const q of CASES) {
    const t0 = Date.now();
    try {
      const r = await claude.continueConversation(emptyConv, q, {
        channel: Channel.WHATSAPP,
        isTestTraffic: true,
      });
      const dt = Date.now() - t0;
      console.log(`\nQ: ${q}`);
      console.log(`R: ${r.replace(/\s+/g, ' ')}`);
      console.log(`(${dt}ms)`);
    } catch (err: any) {
      console.log(`\nQ: ${q}`);
      console.log(`ERROR: ${err?.message ?? err}`);
    }
  }

  await app.close();
}

main().catch((err) => {
  console.error(`[probe] fatal: ${err?.message ?? err}`);
  console.error(err?.stack);
  process.exit(1);
});
