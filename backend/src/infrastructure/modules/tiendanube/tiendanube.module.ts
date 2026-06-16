import { Module } from '@nestjs/common';
import { TiendaNubeOAuthController } from './tiendanube-oauth.controller';
import { TiendaNubePrivacyController } from './tiendanube-privacy.controller';
import { TiendaNubeWebhookController } from './tiendanube-webhook.controller';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [AdminModule],
  controllers: [TiendaNubeOAuthController, TiendaNubePrivacyController, TiendaNubeWebhookController],
})
export class TiendaNubeModule {}
