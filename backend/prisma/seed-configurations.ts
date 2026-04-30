/**
 * Configuration seeder — populates the `configurations` table with the
 * defaults each settings form expects to load. Idempotent (upserts), safe
 * to re-run on every deploy.
 *
 * Run with:
 *   npx ts-node prisma/seed-configurations.ts
 */

import { PrismaClient, ConfigurationType } from '@prisma/client';

const prisma = new PrismaClient();

type ConfigSeed = {
  key: string;
  type: ConfigurationType;
  description: string;
  value: Record<string, unknown>;
};

const SEEDS: ConfigSeed[] = [
  {
    key: 'ai_settings',
    type: ConfigurationType.AI,
    description: 'AI agent model, prompts, and automation thresholds',
    value: {
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
      temperature: 0.7,
      maxTokens: 2000,
      systemPrompt:
        'Sos el agente comercial de Servifibras, distribuidor argentino de resinas, fibra de vidrio y cauchos de silicona. Respondé consultas técnicas con precisión, identificá pedidos mayoristas y derivá al equipo cuando corresponda. Hablá siempre en español rioplatense.',
      autoResponseEnabled: true,
      confidenceThreshold: 0.8,
      escalationKeywords: 'mayorista,distribuidor,industrial,licitación,pedido grande,200 litros,500 litros',
    },
  },
  {
    key: 'pricing_rules',
    type: ConfigurationType.PRICING,
    description: 'Currency, tax, volume and channel discount rules',
    value: {
      currency: 'ARS',
      taxRate: 21,
      discountRules: [
        { name: 'volume_20L', threshold: 20, percent: 5 },
        { name: 'volume_100L', threshold: 100, percent: 10 },
        { name: 'volume_200L', threshold: 200, percent: 15 },
        { name: 'mayorista_extra', threshold: 0, percent: 10 },
      ],
      shippingRates: {
        CABA: 0,
        'Gran Buenos Aires': 1500,
        Interior: 3500,
      },
    },
  },
  {
    key: 'system_settings',
    type: ConfigurationType.SYSTEM,
    description: 'Operational toggles, session policy, feature flags',
    value: {
      maintenanceMode: false,
      maxConcurrentConversations: 100,
      sessionTimeoutMinutes: 30,
      backupEnabled: true,
      logLevel: 'info',
      features: {
        aiAutoResponse: true,
        knowledgeBase: true,
        analytics: true,
        multiChannel: true,
      },
    },
  },
];

const CHANNELS = ['whatsapp', 'facebook', 'instagram', 'mercadolibre', 'tiendanube_webchat'] as const;
for (const ch of CHANNELS) {
  SEEDS.push({
    key: `channel_${ch}`,
    type: ConfigurationType.CHANNEL,
    description: `Configuration for ${ch} channel`,
    value: {
      enabled: false, // Phase 1: explicit opt-in per channel as creds arrive
      apiKey: '',
      apiSecret: '',
      webhookUrl: `https://api-dev.servifibras.com/${ch === 'tiendanube_webchat' ? 'webchat' : ch}/webhook`,
      autoResponse: true,
      responseDelay: 1,
      businessHours: { start: '09:00', end: '18:00' },
    },
  });
}

async function main() {
  console.log(`Seeding ${SEEDS.length} configurations...`);

  for (const seed of SEEDS) {
    await prisma.configuration.upsert({
      where: { key: seed.key },
      create: {
        type: seed.type,
        key: seed.key,
        value: seed.value as object,
        description: seed.description,
      },
      update: {
        type: seed.type,
        value: seed.value as object,
        description: seed.description,
      },
    });
    console.log(`  ✓ ${seed.key}`);
  }

  const total = await prisma.configuration.count();
  console.log(`\nDone. ${total} configurations in DB.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
