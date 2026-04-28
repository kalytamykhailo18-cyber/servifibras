/**
 * INFRASTRUCTURE LAYER - JWT Authentication Guard
 * Protects routes requiring authentication
 */

import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../adapters/auth/auth.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('No authorization header');
    }

    const [bearer, token] = authHeader.split(' ');

    if (bearer !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization format');
    }

    const user = await this.authService.validateToken(token);

    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Attach user to request for use in controllers
    request.user = user;

    return true;
  }
}
