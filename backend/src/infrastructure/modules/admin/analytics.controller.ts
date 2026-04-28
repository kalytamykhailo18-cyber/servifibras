/**
 * INFRASTRUCTURE LAYER - Admin Analytics Controller
 * Provides analytics and metrics endpoints for the dashboard
 */

import {
  Controller,
  Get,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { AnalyticsService } from '../../../adapters/admin/analytics.service';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';

@Controller('admin/analytics')
@UseGuards(AuthGuard, RolesGuard)
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * Get dashboard summary with key metrics
   * GET /admin/analytics/dashboard
   */
  @Get('dashboard')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getDashboardSummary() {
    try {
      const summary = await this.analyticsService.getDashboardSummary();

      return {
        success: true,
        data: summary,
      };
    } catch (error: any) {
      this.logger.error(`Error getting dashboard summary: ${error.message}`);
      return {
        success: false,
        error: 'Failed to get dashboard summary',
      };
    }
  }

  /**
   * Get conversation metrics
   * GET /admin/analytics/conversations/metrics
   */
  @Get('conversations/metrics')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getConversationMetrics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    try {
      const timeRange =
        startDate && endDate
          ? {
              startDate: new Date(startDate),
              endDate: new Date(endDate),
            }
          : undefined;

      const metrics = await this.analyticsService.getConversationMetrics(timeRange);

      return {
        success: true,
        data: metrics,
      };
    } catch (error: any) {
      this.logger.error(`Error getting conversation metrics: ${error.message}`);
      return {
        success: false,
        error: 'Failed to get conversation metrics',
      };
    }
  }

  /**
   * Get conversation trends
   * GET /admin/analytics/conversations/trends
   */
  @Get('conversations/trends')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getConversationTrends(@Query('days') days?: string) {
    try {
      const daysNum = days ? parseInt(days) : 7;
      const trends = await this.analyticsService.getConversationTrends(daysNum);

      return {
        success: true,
        data: trends,
      };
    } catch (error: any) {
      this.logger.error(`Error getting conversation trends: ${error.message}`);
      return {
        success: false,
        error: 'Failed to get conversation trends',
      };
    }
  }

  /**
   * Get contact metrics
   * GET /admin/analytics/contacts/metrics
   */
  @Get('contacts/metrics')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getContactMetrics() {
    try {
      const metrics = await this.analyticsService.getContactMetrics();

      return {
        success: true,
        data: metrics,
      };
    } catch (error: any) {
      this.logger.error(`Error getting contact metrics: ${error.message}`);
      return {
        success: false,
        error: 'Failed to get contact metrics',
      };
    }
  }

  /**
   * Get AI performance metrics
   * GET /admin/analytics/ai/performance
   */
  @Get('ai/performance')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getAIPerformanceMetrics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    try {
      const timeRange =
        startDate && endDate
          ? {
              startDate: new Date(startDate),
              endDate: new Date(endDate),
            }
          : undefined;

      const metrics = await this.analyticsService.getAIPerformanceMetrics(timeRange);

      return {
        success: true,
        data: metrics,
      };
    } catch (error: any) {
      this.logger.error(`Error getting AI performance metrics: ${error.message}`);
      return {
        success: false,
        error: 'Failed to get AI performance metrics',
      };
    }
  }

  /**
   * Get response time metrics
   * GET /admin/analytics/response-times
   */
  @Get('response-times')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getResponseTimeMetrics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    try {
      const timeRange =
        startDate && endDate
          ? {
              startDate: new Date(startDate),
              endDate: new Date(endDate),
            }
          : undefined;

      const metrics = await this.analyticsService.getResponseTimeMetrics(timeRange);

      return {
        success: true,
        data: metrics,
      };
    } catch (error: any) {
      this.logger.error(`Error getting response time metrics: ${error.message}`);
      return {
        success: false,
        error: 'Failed to get response time metrics',
      };
    }
  }

  /**
   * Get channel performance
   * GET /admin/analytics/channels/performance
   */
  @Get('channels/performance')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getChannelPerformance(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    try {
      const timeRange =
        startDate && endDate
          ? {
              startDate: new Date(startDate),
              endDate: new Date(endDate),
            }
          : undefined;

      const performance = await this.analyticsService.getChannelPerformance(timeRange);

      return {
        success: true,
        data: performance,
      };
    } catch (error: any) {
      this.logger.error(`Error getting channel performance: ${error.message}`);
      return {
        success: false,
        error: 'Failed to get channel performance',
      };
    }
  }

  /**
   * Get time series data for charts
   * GET /admin/analytics/timeseries
   */
  @Get('timeseries')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getTimeSeriesData(
    @Query('metric') metric: 'conversations' | 'messages' | 'contacts',
    @Query('days') days?: string,
  ) {
    try {
      if (!metric) {
        return {
          success: false,
          error: 'Metric parameter is required (conversations, messages, or contacts)',
        };
      }

      const daysNum = days ? parseInt(days) : 7;
      const data = await this.analyticsService.getTimeSeriesData(metric, daysNum);

      return {
        success: true,
        data,
      };
    } catch (error: any) {
      this.logger.error(`Error getting time series data: ${error.message}`);
      return {
        success: false,
        error: 'Failed to get time series data',
      };
    }
  }
}
