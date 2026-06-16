import { Global, Module } from '@nestjs/common';
import { OAuthCredentialsService } from '../../../adapters/oauth/oauth-credentials.service';
import { TiendaNubeAuthResolver } from '../../../adapters/oauth/tiendanube-auth.resolver';
import { MetaAuthResolver } from '../../../adapters/oauth/meta-auth.resolver';

@Global()
@Module({
  providers: [OAuthCredentialsService, TiendaNubeAuthResolver, MetaAuthResolver],
  exports: [OAuthCredentialsService, TiendaNubeAuthResolver, MetaAuthResolver],
})
export class OAuthModule {}
