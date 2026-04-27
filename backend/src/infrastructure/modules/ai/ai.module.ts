/**
 * INFRASTRUCTURE LAYER - NestJS Module
 * Wires everything together using dependency injection
 */

import { Module } from '@nestjs/common';
import { ClaudeService } from '../../../adapters/ai/claude.service';
import { KnowledgeRepository } from '../../../adapters/repositories/knowledge.repository';
import { AIController } from './ai.controller';
import { PricingModule } from '../pricing/pricing.module';

@Module({
  imports: [PricingModule], // Import PricingModule to access PricingCalculatorService
  controllers: [AIController],
  providers: [
    KnowledgeRepository,
    ClaudeService,
  ],
  exports: [ClaudeService], // Export so other modules can use it
})
export class AIModule {}
