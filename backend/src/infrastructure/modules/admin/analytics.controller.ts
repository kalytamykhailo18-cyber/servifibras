/**
 * INFRASTRUCTURE LAYER - Admin Analytics Controller
 * Provides analytics and metrics endpoints for the dashboard
 */

import {
  Controller,
  Get,
  Post,
  Query,
  Request,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { AnalyticsService } from '../../../adapters/admin/analytics.service';
import { RoleMetricsService } from '../../../adapters/admin/role-metrics.service';
import { TeamPerformanceService } from '../../../adapters/admin/team-performance.service';
import { VentasUnificadasService, VentasRange, VentasSource } from '../../../adapters/admin/ventas-unificadas.service';
import { VentasUnificadasDriveService } from '../../../adapters/admin/ventas-unificadas-drive.service';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';

@Controller('admin/analytics')
@UseGuards(AuthGuard, RolesGuard)
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly roleMetrics: RoleMetricsService,
    private readonly ventasUnificadas: VentasUnificadasService,
    private readonly ventasDrive: VentasUnificadasDriveService,
    private readonly teamPerformance: TeamPerformanceService,
  ) {}

  /**
   * Marcos 2026-06-18: per-user team-performance leaderboard. One row
   * per active operator with manual-sales totals + response-time
   * averages over the window. Filter `from` / `to` are ISO instants.
   * Admin-only (compares the team — non-admin can't see peers).
   */
  @Get('team-performance')
  @Roles(UserRole.ADMIN, UserRole.ENCARGADO)
  async teamPerformanceRoute(
    @Query('from') fromIso: string | undefined,
    @Query('to') toIso: string | undefined,
  ) {
    const to = toIso || new Date().toISOString();
    const from = fromIso || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const data = await this.teamPerformance.team({ fromIso: from, toIso: to });
    return { success: true, data };
  }

  /**
   * Per-role dashboard cuts (Marcos's redesign).
   * Each route is gated to the role that should see it; ADMIN sees all.
   */
  @Get('role/atencion')
  @Roles(UserRole.ADMIN, UserRole.ATENCION)
  async getAtencionMetrics() {
    return { success: true, data: await this.roleMetrics.getAtencionMetrics() };
  }

  @Get('role/ventas')
  @Roles(UserRole.ADMIN, UserRole.VENTAS)
  async getVentasMetrics() {
    return { success: true, data: await this.roleMetrics.getVentasMetrics() };
  }

  @Get('role/logistica')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async getLogisticaMetrics() {
    return { success: true, data: await this.roleMetrics.getLogisticaMetrics() };
  }

  @Get('role/admin')
  @Roles(UserRole.ADMIN)
  async getAdminMetrics() {
    return { success: true, data: await this.roleMetrics.getAdminMetrics() };
  }

  /**
   * Get dashboard summary with key metrics
   * GET /admin/analytics/dashboard
   */
  @Get('dashboard')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async getDashboardSummary(@Request() req: any) {
    try {
      const summary = await this.analyticsService.getDashboardSummary({
        userId: req.user.id,
        role: req.user.role,
      });

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
    @Request() req: any,
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

      const metrics = await this.analyticsService.getConversationMetrics(timeRange, {
        userId: req.user.id,
        role: req.user.role,
      });

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

  /**
   * Bloque B item 4 — Marcos 2026-06-06: ventas unificadas.
   * GET /admin/analytics/ventas-unificadas?range=today|week|month
   *
   * Rolls up sales across ML cuenta 1, ML cuenta 2, TiendaNube and
   * CRM-manual into a single dashboard payload so Marcos sees his
   * full business volume in one view. Cached per-range for ~5 min
   * (ML_VENTAS_UNIFICADAS_CACHE_MS) to keep ML API traffic bounded.
   */
  /**
   * Marcos 2026-06-12: dispatch history grouped by mensajería.
   * Frontend passes ISO instants for from/to. Default range is "this
   * week" when neither is supplied. Range presets (semana, quincena,
   * mes) are resolved client-side; the server takes whatever bounds
   * it gets.
   */
  @Get('dispatch-stats')
  @Roles(UserRole.ADMIN, UserRole.LOGISTICA)
  async getDispatchStats(
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
  ) {
    const now = Date.now();
    const fromIso = fromRaw?.trim() || new Date(now - 7 * 24 * 3600 * 1000).toISOString();
    const toIso = toRaw?.trim() || new Date(now).toISOString();
    try {
      const data = await this.analyticsService.getDispatchStats({ fromIso, toIso });
      return { success: true, data };
    } catch (err: any) {
      this.logger.error(`Error getting dispatch stats: ${err.message}`);
      return { success: false, error: 'Failed to get dispatch stats' };
    }
  }

  @Get('ventas-unificadas')
  @Roles(UserRole.ADMIN, UserRole.VENTAS)
  async getVentasUnificadas(@Query('range') rangeRaw?: string) {
    const range: VentasRange =
      rangeRaw === 'week' || rangeRaw === 'month' ? rangeRaw : 'today';
    try {
      const data = await this.ventasUnificadas.get(range);
      return { success: true, data };
    } catch (error: any) {
      this.logger.error(`Error getting ventas unificadas: ${error.message}`);
      return { success: false, error: 'Failed to get ventas unificadas' };
    }
  }

  /**
   * Bloque B item 5 — click-detail drilldown. From a per-source cell
   * on the ventas-unificadas card, click → modal with the underlying
   * order list for that source + period.
   *
   * GET /admin/analytics/ventas-unificadas/detail?range=today|week|month
   *                                              &source=ML_CUENTA_1|ML_CUENTA_2|TIENDANUBE|MANUAL
   *                                              &limit=50
   */
  @Get('ventas-unificadas/detail')
  @Roles(UserRole.ADMIN, UserRole.VENTAS)
  async getVentasUnificadasDetail(
    @Query('range') rangeRaw?: string,
    @Query('source') sourceRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const range: VentasRange =
      rangeRaw === 'week' || rangeRaw === 'month' ? rangeRaw : 'today';
    const validSources: VentasSource[] = ['ML_CUENTA_1', 'ML_CUENTA_2', 'TIENDANUBE', 'MANUAL'];
    if (!sourceRaw || !validSources.includes(sourceRaw as VentasSource)) {
      return { success: false, error: 'source must be ML_CUENTA_1, ML_CUENTA_2, TIENDANUBE or MANUAL' };
    }
    const limitNum = limitRaw ? Number(limitRaw) : undefined;
    try {
      const data = await this.ventasUnificadas.drilldown({
        range,
        source: sourceRaw as VentasSource,
        limit: Number.isFinite(limitNum) ? limitNum : undefined,
      });
      return { success: true, data };
    } catch (error: any) {
      this.logger.error(`Error getting ventas unificadas detail: ${error.message}`);
      return { success: false, error: 'Failed to get ventas unificadas detail' };
    }
  }

  /**
   * Bloque B (signed Phase 2): export the unified-sales snapshot to
   * the shared Google Drive folder Marcos configured. Body / query:
   *   POST /admin/analytics/ventas-unificadas/upload-drive?range=today|week|month
   *
   * Returns the share link the UI surfaces in the success toast.
   * Reasons it can come back !success:
   *   - "no-drive-config": GOOGLE_SERVICE_ACCOUNT_JSON +
   *     GOOGLE_DRIVE_VENTAS_FOLDER_ID not set yet (first install).
   *   - "drive-error": Drive API rejected the upload (permission /
   *     quota / network). Message carries the underlying reason.
   */
  @Post('ventas-unificadas/upload-drive')
  @Roles(UserRole.ADMIN, UserRole.VENTAS)
  async uploadVentasUnificadasToDrive(@Query('range') rangeRaw?: string) {
    const range: VentasRange =
      rangeRaw === 'week' || rangeRaw === 'month' ? rangeRaw : 'today';
    try {
      const result = await this.ventasDrive.uploadSnapshot(range);
      this.logger.log(
        `Drive upload by analytics endpoint: range=${range} file=${result.fileName} mocked=${result.mocked}`,
      );
      return { success: true, data: result };
    } catch (error: any) {
      const msg = error?.message ?? String(error);
      const isConfig = /not configured|GOOGLE_SERVICE_ACCOUNT_JSON|GOOGLE_DRIVE_VENTAS_FOLDER_ID/i.test(msg);
      this.logger.error(`Drive upload failed: ${msg}`);
      return {
        success: false,
        reason: isConfig ? 'no-drive-config' : 'drive-error',
        error: msg,
      };
    }
  }

  /**
   * Bloque B item 1 — ML cuenta split.
   * GET /admin/analytics/ml-account-split?since=ISO&until=ISO
   */
  @Get('ml-account-split')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS)
  async getMlAccountSplit(
    @Query('since') since?: string,
    @Query('until') until?: string,
  ) {
    try {
      const sinceDate = since ? new Date(since) : null;
      const untilDate = until ? new Date(until) : null;
      const data = await this.analyticsService.getMercadoLibreAccountSplit({
        startDate: sinceDate && !isNaN(sinceDate.getTime()) ? sinceDate : (null as any),
        endDate: untilDate && !isNaN(untilDate.getTime()) ? untilDate : (null as any),
      });
      return { success: true, data };
    } catch (error: any) {
      this.logger.error(`Error getting ML account split: ${error.message}`);
      return { success: false, error: 'Failed to get ML account split' };
    }
  }
}
