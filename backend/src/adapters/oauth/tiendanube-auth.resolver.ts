import { Injectable, Logger } from '@nestjs/common';
import { OAuthCredentialsService } from './oauth-credentials.service';

export interface TiendaNubeAuth {
  storeId: string;
  accessToken: string;
}

@Injectable()
export class TiendaNubeAuthResolver {
  private readonly logger = new Logger(TiendaNubeAuthResolver.name);

  constructor(private readonly credentials: OAuthCredentialsService) {}

  async resolve(): Promise<TiendaNubeAuth | null> {
    const stored = await this.credentials.getRaw('tiendanube');
    if (stored?.accessToken && stored.externalId) {
      return {
        storeId: stored.externalId,
        accessToken: stored.accessToken,
      };
    }
    const envToken = process.env.TIENDANUBE_ACCESS_TOKEN;
    const envStore = process.env.TIENDANUBE_STORE_ID;
    if (envToken && envStore) {
      return { storeId: envStore, accessToken: envToken };
    }
    return null;
  }
}
