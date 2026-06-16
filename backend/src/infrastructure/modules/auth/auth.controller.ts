/**
 * INFRASTRUCTURE LAYER - Auth Controller
 * Handles authentication endpoints
 */

import { Controller, Post, Get, Body, UseGuards, Req, Request, Logger } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request as ExpressRequest } from 'express';
import { AuthService } from '../../../adapters/auth/auth.service';
import { AuditLogService } from '../../../adapters/audit/audit-log.service';
import { AuthGuard } from '../../guards/auth.guard';
import { LoginCredentials } from '../../../domain/entities/auth.entity';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Login endpoint
   * POST /auth/login
   *
   * Uses the strict 'login' throttler bucket (10/min/IP by default) to make
   * credential-stuffing painful. The other auth routes (validate token, etc.)
   * inherit the default bucket which is plenty.
   */
  @Throttle({ default: { ttl: 60_000, limit: Number(process.env.THROTTLE_LOGIN_LIMIT) || 10 } })
  @Post('login')
  async login(
    @Body() body: { email: string; password: string },
    @Req() req: ExpressRequest,
  ) {
    const credentials = new LoginCredentials(body.email, body.password);

    const result = await this.authService.login(credentials);
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;
    const userAgent = (req.headers['user-agent'] as string) || null;

    if (result.success) {
      // Issue a fresh access + refresh pair on every login so each session
      // gets its own refresh chain (different `family`).
      const pair = await this.authService.issueTokenPair(result.user);
      await this.audit.log({
        userId: result.user.id,
        userEmail: result.user.email,
        action: 'auth.login.success',
        ip,
        userAgent,
        metadata: { role: result.user.role },
      });
      return {
        // Backwards-compat: keep `token` for older clients still reading it
        token: pair.accessToken,
        accessToken: pair.accessToken,
        accessTokenExpiresIn: pair.accessTokenExpiresIn,
        refreshToken: pair.refreshToken,
        refreshTokenExpiresAt: pair.refreshTokenExpiresAt.toISOString(),
        user: {
          id: result.user.id,
          email: result.user.email,
          username: result.user.username,
          name: result.user.name,
          role: result.user.role,
          active: result.user.active,
        },
      };
    } else {
      await this.audit.log({
        userId: null,
        userEmail: body.email,
        action: 'auth.login.failed',
        ip,
        userAgent,
        metadata: { reason: result.code ?? 'unknown' },
      });
      return {
        success: false,
        // `code` is the stable contract the frontend switches on; `error`
        // carries the user-facing Spanish copy. Frontend should prefer the
        // code path so future copy tweaks don't require a deploy on both
        // sides at once.
        code: result.code,
        error: result.error,
      };
    }
  }

  /**
   * Refresh endpoint — exchange a refresh token for a new access+refresh
   * pair. The presented refresh token is revoked and chained to the new
   * one (rotation). If a revoked refresh token is presented later, the
   * entire family is revoked (theft detection — see AuthService).
   *
   * POST /auth/refresh
   */
  @Throttle({ default: { ttl: 60_000, limit: Number(process.env.THROTTLE_LOGIN_LIMIT) || 10 } })
  @Post('refresh')
  async refresh(
    @Body() body: { refreshToken: string },
    @Req() req: ExpressRequest,
  ) {
    if (!body?.refreshToken) {
      return { success: false, error: 'refreshToken is required' };
    }
    const pair = await this.authService.rotateRefreshToken(body.refreshToken);
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;
    const userAgent = (req.headers['user-agent'] as string) || null;

    if (!pair) {
      await this.audit.log({
        action: 'auth.refresh.failed',
        ip,
        userAgent,
        metadata: { reason: 'invalid_or_revoked' },
      });
      return { success: false, error: 'Invalid refresh token' };
    }
    await this.audit.log({
      action: 'auth.refresh.success',
      ip,
      userAgent,
    });
    return {
      accessToken: pair.accessToken,
      accessTokenExpiresIn: pair.accessTokenExpiresIn,
      refreshToken: pair.refreshToken,
      refreshTokenExpiresAt: pair.refreshTokenExpiresAt.toISOString(),
    };
  }

  /**
   * Logout — revoke the presented refresh token and its entire family. The
   * access JWT remains valid until it expires; once we shorten its TTL in
   * the next iteration this becomes a complete logout in <accessTtl> time.
   *
   * POST /auth/logout
   */
  @Post('logout')
  async logout(
    @Body() body: { refreshToken?: string },
    @Req() req: ExpressRequest,
  ) {
    if (body?.refreshToken) {
      await this.authService.logout(body.refreshToken);
    }
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;
    const userAgent = (req.headers['user-agent'] as string) || null;
    await this.audit.log({
      action: 'auth.logout',
      ip,
      userAgent,
    });
    return { success: true };
  }

  /**
   * Get current user profile
   * GET /auth/profile
   * Requires authentication
   */
  @Get('profile')
  @UseGuards(AuthGuard)
  async getProfile(@Request() req: any) {
    const user = req.user;

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      role: user.role,
      active: user.active,
      permissions: {
        canManageUsers: user.canManageUsers(),
        canManageKnowledge: user.canManageKnowledge(),
        canViewConversations: user.canViewConversations(),
        canTakeOverConversation: user.canTakeOverConversation(),
      },
    };
  }

  /**
   * Get current user (alias for /auth/profile)
   * GET /auth/me
   * Requires authentication
   */
  @Get('me')
  @UseGuards(AuthGuard)
  async getCurrentUser(@Request() req: any) {
    const user = req.user;

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      role: user.role,
      active: user.active,
    };
  }

  /**
   * Validate token
   * GET /auth/validate
   */
  @Get('validate')
  @UseGuards(AuthGuard)
  async validate() {
    return { valid: true };
  }

  /**
   * Health check
   * GET /auth/health
   */
  @Get('health')
  async health() {
    return { status: 'ok', service: 'auth' };
  }
}
