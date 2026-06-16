import { Global, Module } from '@nestjs/common';
import { ChannelGateService } from '../../../adapters/channel-gate/channel-gate.service';

@Global()
@Module({
  providers: [ChannelGateService],
  exports: [ChannelGateService],
})
export class ChannelGateModule {}
