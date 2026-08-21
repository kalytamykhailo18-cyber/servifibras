/**
 * Seed `configurations.carrier_defaults` con la regla de default por
 * (source, zone) que Marcos flageó 2026-08-19 vía Ustym report Frente
 * D0: TiendaNube + AMBA (CABA/GBA 1/2/3) → JYJ.
 *
 *   cd /home/servifibras/backend
 *   set -a && . ./.env && set +a
 *   npx ts-node --transpile-only scripts/seed-carrier-defaults.ts
 */

import { PrismaClient, ConfigurationType } from '@prisma/client';

const DEFAULTS = {
  sourceZoneDefaults: [
    { source: 'TIENDANUBE', zone: 'CABA', carrier: 'JyJ' },
    { source: 'TIENDANUBE', zone: 'GBA1', carrier: 'JyJ' },
    { source: 'TIENDANUBE', zone: 'GBA2', carrier: 'JyJ' },
    { source: 'TIENDANUBE', zone: 'GBA3', carrier: 'JyJ' },
  ],
};

async function main() {
  const prisma = new PrismaClient();
  try {
    const value = { ...DEFAULTS, updatedAt: new Date().toISOString() };
    const row = await prisma.configuration.upsert({
      where: { key: 'carrier_defaults' },
      update: { value, updatedAt: new Date() },
      create: {
        key: 'carrier_defaults',
        type: ConfigurationType.SYSTEM,
        value,
        description:
          'Defaults por (source, zone) para resolver mensajería cuando el operador no picó. Consumido por CarrierDefaultsService → carrier-resolver.util. El pick del operador siempre lo pisa.',
      },
    });
    console.log(
      `✅ configurations.carrier_defaults upserted (id=${row.id}, defaults=${DEFAULTS.sourceZoneDefaults.length})`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
