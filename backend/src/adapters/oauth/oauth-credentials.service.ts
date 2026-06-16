import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export interface OAuthCredentialsSnapshot {
  accessToken: string;
  externalId: string | null;
  refreshToken: string | null;
  expiresAt: Date;
  metadata: any;
}

export interface OAuthExchangeResult {
  accessToken: string;
  refreshToken?: string | null;
  externalId?: string | null;
  expiresInSec: number;
  metadata?: Record<string, any>;
}

const REFRESH_LEEWAY_SEC =
  Number(process.env.OAUTH_REFRESH_LEEWAY_SEC) || 5 * 60;

@Injectable()
export class OAuthCredentialsService {
  private readonly logger = new Logger(OAuthCredentialsService.name);

  private readonly prisma = new PrismaClient();

  async save(
    provider: string,
    payload: OAuthExchangeResult,
  ): Promise<OAuthCredentialsSnapshot> {
    const expiresAt = new Date(Date.now() + payload.expiresInSec * 1000);
    const row = await this.prisma.oAuthCredential.upsert({
      where: { provider },
      create: {
        provider,
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken ?? null,
        externalId: payload.externalId ?? null,
        expiresAt,
        metadata: payload.metadata ?? null,
      },
      update: {
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken ?? null,
        externalId: payload.externalId ?? null,
        expiresAt,
        metadata: payload.metadata ?? null,
      },
    });
    this.logger.log(
      `${provider}: credentials saved (externalId=${row.externalId ?? '—'}, expiresAt=${row.expiresAt.toISOString()})`,
    );
    return this.snapshot(row);
  }

  async getRaw(provider: string): Promise<OAuthCredentialsSnapshot | null> {
    const row = await this.prisma.oAuthCredential.findUnique({
      where: { provider },
    });
    return row ? this.snapshot(row) : null;
  }

  async getFresh(
    provider: string,
    refresher?: (
      refreshToken: string,
    ) => Promise<OAuthExchangeResult>,
  ): Promise<OAuthCredentialsSnapshot | null> {
    const row = await this.getRaw(provider);
    if (!row) return null;

    const dueAt = row.expiresAt.getTime() - REFRESH_LEEWAY_SEC * 1000;
    if (Date.now() < dueAt) return row;

    if (!refresher || !row.refreshToken) {
      this.logger.warn(
        `${provider}: access token within leeway window, no refresher available — returning stale value`,
      );
      return row;
    }

    try {
      const next = await refresher(row.refreshToken);
      return await this.save(provider, {
        ...next,
        externalId: next.externalId ?? row.externalId,
      });
    } catch (err: any) {
      this.logger.error(
        `${provider}: refresh failed (${err.message}); returning stale credentials`,
      );
      return row;
    }
  }

  private snapshot(row: {
    accessToken: string;
    refreshToken: string | null;
    externalId: string | null;
    expiresAt: Date;
    metadata: any;
  }): OAuthCredentialsSnapshot {
    return {
      accessToken: row.accessToken,
      refreshToken: row.refreshToken,
      externalId: row.externalId,
      expiresAt: row.expiresAt,
      metadata: row.metadata,
    };
  }
}
