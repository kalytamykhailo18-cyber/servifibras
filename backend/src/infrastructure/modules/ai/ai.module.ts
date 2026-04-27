/**
 * INFRASTRUCTURE LAYER - NestJS Module
 * Wires everything together using dependency injection
 */

import { Module } from '@nestjs/common';
import { ClaudeService } from '../../../adapters/ai/claude.service';
import { AIController } from './ai.controller';

@Module({
  controllers: [AIController],
  providers: [ClaudeService],
  exports: [ClaudeService], // Export so other modules can use it
})
export class AIModule {}
