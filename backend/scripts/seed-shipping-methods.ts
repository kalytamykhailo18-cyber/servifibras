/**
 * Seed `configurations.shipping_methods` con los métodos actuales de la
 * tienda (Marcos 2026-08-19 vía Ustym report Frente C). Fuente: los
 * métodos configurados hoy en TiendaNube. Un cron futuro puede
 * sobrescribir esta fila leyendo `/v1/{store}/shipping_carriers`.
 *
 *   cd /home/servifibras/backend
 *   set -a && . ./.env && set +a
 *   npx ts-node --transpile-only scripts/seed-shipping-methods.ts
 */

import { PrismaClient, ConfigurationType } from '@prisma/client';

const METHODS = [
  {
    name: 'CABA GRATUITO (15hs a 21hs)',
    zones: ['CABA'],
    deliveryDays: '1 a 2 días hábiles',
    costMode: 'free',
    notes: 'Franja horaria 15hs-21hs.',
  },
  {
    name: 'GBA 1 / 2 / 3 GRATIS (15hs a 21hs)',
    zones: ['GBA1', 'GBA2', 'GBA3'],
    deliveryDays: '0 a 2 días hábiles',
    costMode: 'free',
    notes: 'Franja horaria 15hs-21hs.',
  },
  {
    name: 'Despacho a terminal de micro',
    zones: ['INTERIOR'],
    deliveryDays: '3 a 4 días hábiles',
    costMode: 'pay_on_arrival',
    notes: 'El envío lo abonás cuando llega a tu localidad.',
  },
  {
    name: 'Tarifa Nacional encomienda a terminal',
    zones: ['INTERIOR'],
    deliveryDays: '4 a 7 días hábiles',
    costMode: 'pay_on_arrival',
    notes: 'Encomienda nacional, se abona al retirar.',
  },
  {
    name: 'Retiro en Servifibras',
    zones: ['RETIRO'],
    deliveryDays: 'Inmediato en horario de atención',
    costMode: 'pickup',
    notes: 'Retiro sin costo en Caseros (dirección de la tienda).',
  },
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const value = { methods: METHODS, updatedAt: new Date().toISOString() };
    const row = await prisma.configuration.upsert({
      where: { key: 'shipping_methods' },
      update: { value, updatedAt: new Date() },
      create: {
        key: 'shipping_methods',
        type: ConfigurationType.SYSTEM,
        value,
        description:
          'Métodos de envío disponibles para el agente. Consumido por ShippingMethodsService → herramienta consultar_envio. Sobrescribible por cron de TN.',
      },
    });
    console.log(
      `✅ configurations.shipping_methods upserted (id=${row.id}, methods=${METHODS.length})`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
