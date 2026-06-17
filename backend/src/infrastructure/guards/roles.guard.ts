/**
 * INFRASTRUCTURE LAYER - Role-Based Authorization Guard
 * Protects routes requiring specific roles
 */

import { Injectable, CanActivate, ExecutionContext, ForbiddenException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../domain/entities/auth.entity';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true; // No roles required, allow access
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Marcos 2026-06-17: ENCARGADO is a supervisor role that
    // INHERITS from both ATENCION and LOGISTICA at the guard level.
    // Anywhere an endpoint grants ATENCION or LOGISTICA, ENCARGADO
    // is admitted automatically — avoids hand-editing ~150 @Roles
    // decorators across the codebase. Endpoints that should NOT be
    // available to ENCARGADO (sales metrics, audit, integraciones,
    // settings, users) DON'T list ATENCION or LOGISTICA in their
    // roles, so this inheritance is safely scoped to the
    // supervisor surface Marcos asked for.
    const effectiveRoles = new Set<UserRole>(requiredRoles);
    if (effectiveRoles.has(UserRole.ATENCION) || effectiveRoles.has(UserRole.LOGISTICA)) {
      effectiveRoles.add(UserRole.ENCARGADO);
    }

    const hasRole = effectiveRoles.has(user.role);

    if (!hasRole) {
      throw new ForbiddenException(`Requires one of: ${Array.from(effectiveRoles).join(', ')}`);
    }

    return true;
  }
}
