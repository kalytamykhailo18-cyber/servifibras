/**
 * ADAPTERS LAYER - Channel Gate
 *
 * Single source of truth for "is this channel currently accepting inbound
 * traffic?". Webhook controllers consult it at the entry point so a flipped-
 * off channel in the admin panel actually drops traffic at the door.
 *
 * Default policy: a channel is enabled unless an admin has explicitly set
 * `{ enabled: false }` in its configuration. Missing config = enabled, so
 * channels work out of the box during onboarding before the admin has
 * configured anything.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaClient, Channel } from '@prisma/client';

@Injectable()
export class ChannelGateService {
  private readonly logger = new Logger(ChannelGateService.name);
  private readonly prisma: PrismaClient;

  constructor(
    @Optional() prismaShared?: import('../repositories/prisma.service').PrismaService,
  ) {
    this.prisma = prismaShared ?? new PrismaClient();
  }

  async isEnabled(channel: Channel): Promise<boolean> {
    try {
      const key = `channel_${channel.toLowerCase()}`;
      const cfg = await this.prisma.configuration.findUnique({ where: { key } });
      if (!cfg) return true; // no config yet → permissive default
      const value = cfg.value as { enabled?: boolean } | null;
      // Only block when the admin explicitly set enabled=false. Any other
      // shape (true/missing) is treated as enabled.
      return value?.enabled !== false;
    } catch (err: any) {
      // If the gate query itself fails, fail-open — better to deliver a
      // message we couldn't double-check than to drop legitimate traffic.
      this.logger.error(`Channel gate query failed for ${channel}, defaulting to enabled: ${err.message}`);
      return true;
    }
  }
}
