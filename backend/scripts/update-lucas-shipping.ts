/**
 * Patch en la fila `configurations.lucas_prompt`: reemplaza el bloque
 * "REGLA DURA — costo de envío" por una versión que instruye a llamar
 * la herramienta `consultar_envio`. Marcos 2026-08-19 (Ustym report
 * Frente C): la versión anterior mandaba a pedir el CP para "confirmar"
 * un costo que el agente no podía calcular → loop garantizado.
 *
 *   cd /home/servifibras/backend
 *   set -a && . ./.env && set +a
 *   npx ts-node --transpile-only scripts/update-lucas-shipping.ts
 */

import { PrismaClient } from '@prisma/client';

const OLD_BLOCK = `REGLA DURA — costo de envío
Nunca des un monto ni un rango. No tenés acceso a la tabla de costos por CP ni a las promos de envío gratis.

"El costo depende del código postal. Pasame el tuyo y te confirmo el costo exacto y si aplica envío gratis."

Prohibido "unos X pesos", "estimo alrededor de", "aproximadamente entre".`;

const NEW_BLOCK = `REGLA — costo de envío
Nunca inventes montos ni plazos. Antes de responder cualquier consulta de envío llamá a la herramienta \`consultar_envio(localidad_o_cp)\` con la localidad, ciudad, provincia o código postal que dio el comprador. Devuelve la zona (CABA / GBA1 / GBA2 / GBA3 / INTERIOR / RETIRO) y los métodos que aplican, cada uno con su plazo (\`deliveryDays\`) y modo de cobro (\`costMode\`).

Cómo armar la respuesta según lo que devuelve la herramienta:
- CABA o GBA (1/2/3), \`costMode: free\` → decí que el envío es sin cargo y mencioná el plazo. No pidas el CP; alcanza con que sea de esa zona.
- INTERIOR, \`costMode: pay_on_arrival\` → decí que va por despacho a terminal de micro y que el envío lo abona el comprador cuando llega a su localidad. Mencioná el plazo. No des un monto — no lo tenemos y no lo inventes.
- RETIRO, \`costMode: pickup\` → mencioná que el retiro es gratis en Caseros con su horario.

Si la herramienta devuelve \`zone: null\` (no reconoce la localidad), pedí la localidad o CP con una sola línea. Prohibido pedirlo dos veces: si el comprador ya lo dio, releé el hilo antes de responder.

Prohibido "unos X pesos", "estimo alrededor de", "aproximadamente entre". Prohibido pedir el CP cuando la localidad ya alcanza para resolver la zona.`;

async function main() {
  const prisma = new PrismaClient();
  try {
    const row = await prisma.configuration.findUnique({
      where: { key: 'lucas_prompt' },
    });
    if (!row) {
      console.error('❌ configurations.lucas_prompt not found');
      process.exit(2);
    }
    const value = row.value as any;
    const content: string = value?.content ?? '';
    if (!content.includes(OLD_BLOCK)) {
      console.error('❌ old shipping block not found in current lucas_prompt — was it already updated?');
      console.error('   Preview around "REGLA":');
      const idx = content.indexOf('REGLA');
      console.error(content.slice(Math.max(0, idx - 40), idx + 400));
      process.exit(3);
    }
    const patched = content.replace(OLD_BLOCK, NEW_BLOCK);
    if (patched === content) {
      console.error('❌ replace was a no-op');
      process.exit(4);
    }
    const newValue = { ...value, content: patched };
    await prisma.configuration.update({
      where: { key: 'lucas_prompt' },
      data: { value: newValue, updatedAt: new Date() },
    });
    console.log(`✅ lucas_prompt patched (was ${content.length} chars, now ${patched.length})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
