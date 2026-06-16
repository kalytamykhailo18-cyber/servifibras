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

    // Bloque C — security gap #10 (Marcos 2026-06-06): idle session
    // expiry. Checked AFTER the JWT cryptographic validity so a
    // bogus token still gets the same 401 it always did, and the
    // structured `idle_expired` response is reserved for the
    // legit-token-but-idle-too-long case. The frontend switches on
    // `code` to drop straight to the login screen with a "vencida
    // por inactividad" toast instead of trying to refresh.
    const idle = await this.authService.touchActivity(user.id);
    if (idle === 'idle_expired') {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'idle_expired',
        message:
          'Sesión vencida por inactividad. Iniciá sesión de nuevo para continuar.',
      });
    }

    // Attach user to request for use in controllers
    request.user = user;

    return true;
  }
}
