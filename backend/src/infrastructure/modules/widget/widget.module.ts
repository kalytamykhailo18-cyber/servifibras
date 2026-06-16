import { Module } from '@nestjs/common';
import { WidgetController } from './widget.controller';
import { SocialModule } from '../social/social.module';

@Module({
  imports: [SocialModule],
  controllers: [WidgetController],
})
export class WidgetModule {}
