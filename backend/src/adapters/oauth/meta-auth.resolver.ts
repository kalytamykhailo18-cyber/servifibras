import { Injectable, Logger } from '@nestjs/common';
import { OAuthCredentialsService } from './oauth-credentials.service';

export interface MetaAuth {
  pageAccessToken: string;
  pageId: string;
  instagramAccountId: string | null;
  pageName: string | null;
  instagramUsername: string | null;
}

/**
 * Resolves Meta (Facebook + Instagram) credentials at call time,
 * preferring the OAuth-installed row in `oauth_credentials` and
 * falling back to the legacy FACEBOOK_PAGE_ACCESS_TOKEN / _PAGE_ID /
 * INSTAGRAM_ACCOUNT_ID env vars when no DB row exists.
 *
 * Same shape and policy as the TiendaNube resolver — services consume
 * `auth.pageAccessToken` instead of capturing env at construction.
 */
@Injectable()
export class MetaAuthResolver {
  private readonly logger = new Logger(MetaAuthResolver.name);

  constructor(private readonly credentials: OAuthCredentialsService) {}

  async resolve(): Promise<MetaAuth | null> {
    const stored = await this.credentials.getRaw('meta');
    if (stored?.accessToken && stored.externalId) {
      const meta = (stored.metadata as any) ?? {};
      return {
        pageAccessToken: stored.accessToken,
        pageId: stored.externalId,
        instagramAccountId: meta.instagramAccountId ?? null,
        pageName: meta.pageName ?? null,
        instagramUsername: meta.instagramUsername ?? null,
      };
    }
    const envToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    const envPageId = process.env.FACEBOOK_PAGE_ID;
    const envIgId = process.env.INSTAGRAM_ACCOUNT_ID;
    if (envToken && (envPageId || envIgId)) {
      return {
        pageAccessToken: envToken,
        pageId: envPageId ?? '',
        instagramAccountId: envIgId || null,
        pageName: null,
        instagramUsername: null,
      };
    }
    return null;
  }
}
