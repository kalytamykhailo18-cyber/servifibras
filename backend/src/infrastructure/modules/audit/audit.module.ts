import { Global, Module } from '@nestjs/common';
import { AuditLogService } from '../../../adapters/audit/audit-log.service';

@Global()
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
