import { Global, Module } from '@nestjs/common';
import { SentryService } from '../../../adapters/monitoring/sentry.service';

@Global()
@Module({
  providers: [SentryService],
  exports: [SentryService],
})
export class MonitoringModule {}
