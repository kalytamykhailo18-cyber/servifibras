/**
 * INFRASTRUCTURE LAYER - NestJS Controller
 * HTTP entry point for AI functionality
 */

import { Controller, Post, Body, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ClaudeService } from '../../../adapters/ai/claude.service';

class AskQuestionDto {
  question: string;
}

@Controller('ai')
export class AIController {
  constructor(private readonly claudeService: ClaudeService) {}

  @Get('health')
  async healthCheck() {
    const isHealthy = await this.claudeService.healthCheck();
    if (!isHealthy) {
      throw new HttpException('AI service unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return {
      status: 'ok',
      service: 'claude-ai',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('ask')
  async askQuestion(@Body() dto: AskQuestionDto) {
    if (!dto.question || dto.question.trim() === '') {
      throw new HttpException('Question is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const answer = await this.claudeService.askQuestion(dto.question);
      return {
        question: dto.question,
        answer,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to get AI response',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
