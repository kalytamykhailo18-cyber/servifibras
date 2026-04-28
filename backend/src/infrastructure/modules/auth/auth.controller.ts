/**
 * INFRASTRUCTURE LAYER - Auth Controller
 * Handles authentication endpoints
 */

import { Controller, Post, Get, Body, UseGuards, Request, Logger } from '@nestjs/common';
import { AuthService } from '../../../adapters/auth/auth.service';
import { AuthGuard } from '../../guards/auth.guard';
import { LoginCredentials } from '../../../domain/entities/auth.entity';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  /**
   * Login endpoint
   * POST /auth/login
   */
  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    const credentials = new LoginCredentials(body.email, body.password);

    const result = await this.authService.login(credentials);

    if (result.success) {
      return {
        token: result.token.accessToken,
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
      return {
        success: false,
        error: result.error,
      };
    }
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
