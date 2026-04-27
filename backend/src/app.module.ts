import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AIModule } from './infrastructure/modules/ai/ai.module';

@Module({
  imports: [AIModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
