import { Global, Module } from '@nestjs/common';
import { NotificationsGateway } from './notifications.gateway';
import { MetricsBroadcaster } from './metrics-broadcaster.service';
import { AuthModule } from '../modules/auth/auth.module';
// Path verified: /infrastructure/modules/auth/auth.module.ts

@Global()
@Module({
  imports: [AuthModule],
  providers: [NotificationsGateway, MetricsBroadcaster],
  exports: [NotificationsGateway, MetricsBroadcaster],
})
export class NotificationsModule {}
