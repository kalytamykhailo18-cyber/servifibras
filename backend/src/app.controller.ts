import { Controller, Get, HttpException, HttpStatus, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { HealthService } from './adapters/health/health.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly health: HealthService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Health endpoint with deep checks.
   *
   * GET /health             — full check (DB, dólar blue cache freshness,
   *                           Claude config). Returns 503 if any required
   *                           component is `down`. `degraded` and
   *                           `unconfigured` still return 200 so monitors
   *                           don't page on expected states (e.g. Claude
   *                           key not yet provided).
   * GET /health?shallow=1   — liveness-style fast 200 used by load
   *                           balancers / systemd. No DB hit.
   */
  @Get('health')
  async getHealth(@Query('shallow') shallow?: string) {
    if (shallow) {
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'servifibras-backend',
      };
    }
    const report = await this.health.check();
    if (report.status === 'down') {
      // Surface the report body even on 503 so monitoring tools can show
      // which component is down without a second request.
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
