/**
 * ADAPTERS LAYER — User-management service.
 *
 * CRUD over the User table. Password hashing handled by `AuthService.hash
 * Password()` so we don't drift from the auth-side bcrypt cost. Marcos
 * uses this from the admin panel to add/remove employees as the team
 * grows; SQL access is no longer required.
 *
 * Active flag is preferred over hard-delete: it preserves the user_id on
 * historical conversations / leads / orders so audit trails stay intact.
 * Hard-delete is still exposed for cleanup of mistakenly-created accounts
 * (no historical references yet).
 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient, UserRole } from '@prisma/client';
import { AuthService } from '../auth/auth.service';

export interface UserCreateInput {
  email: string;
  username: string;
  name: string;
  role: UserRole;
  password: string;
  active?: boolean;
}
export interface UserUpdateInput {
  email?: string;
  username?: string;
  name?: string;
  role?: UserRole;
  active?: boolean;
  /** Optional new password — when present we rehash. */
  password?: string;
}

export class UserConflictError extends Error {
  constructor(public readonly field: 'email' | 'username') {
    super(`unique constraint failed on ${field}`);
    this.name = 'UserConflictError';
  }
}

@Injectable()
export class UserManagementService {
  private readonly logger = new Logger(UserManagementService.name);
  private readonly prisma = new PrismaClient();

  constructor(private readonly auth: AuthService) {}

  async list(opts?: { activeOnly?: boolean }) {
    return this.prisma.user.findMany({
      where: opts?.activeOnly ? { active: true } : undefined,
      select: {
        id: true, email: true, username: true, name: true, role: true,
        active: true, createdAt: true, updatedAt: true,
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  async getById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true, email: true, username: true, name: true, role: true,
        active: true, createdAt: true, updatedAt: true,
      },
    });
  }

  async create(input: UserCreateInput) {
    if (!input.email?.trim()) throw new Error('email is required');
    if (!input.username?.trim()) throw new Error('username is required');
    if (!input.name?.trim()) throw new Error('name is required');
    if (!Object.values(UserRole).includes(input.role)) throw new Error('role is invalid');
    if (!input.password || input.password.length < 6) {
      throw new Error('password must be at least 6 characters');
    }

    const password = await this.auth.hashPassword(input.password);
    try {
      const created = await this.prisma.user.create({
        data: {
          email: input.email.trim().toLowerCase(),
          username: input.username.trim().toLowerCase(),
          name: input.name.trim(),
          role: input.role,
          active: input.active !== false,
          password,
        },
        select: {
          id: true, email: true, username: true, name: true, role: true,
          active: true, createdAt: true, updatedAt: true,
        },
      });
      return created;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const field = err?.meta?.target?.includes('email') ? 'email' : 'username';
        throw new UserConflictError(field);
      }
      throw err;
    }
  }

  async update(id: string, input: UserUpdateInput) {
    const data: Prisma.UserUpdateInput = {};
    if (input.email != null)    data.email = input.email.trim().toLowerCase();
    if (input.username != null) data.username = input.username.trim().toLowerCase();
    if (input.name != null)     data.name = input.name.trim();
    if (input.role != null) {
      if (!Object.values(UserRole).includes(input.role)) throw new Error('role is invalid');
      data.role = input.role;
    }
    if (input.active != null)   data.active = input.active;
    if (input.password) {
      if (input.password.length < 6) throw new Error('password must be at least 6 characters');
      data.password = await this.auth.hashPassword(input.password);
    }

    try {
      return await this.prisma.user.update({
        where: { id },
        data,
        select: {
          id: true, email: true, username: true, name: true, role: true,
          active: true, createdAt: true, updatedAt: true,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const field = err?.meta?.target?.includes('email') ? 'email' : 'username';
        throw new UserConflictError(field);
      }
      if (err?.code === 'P2025') return null;
      throw err;
    }
  }

  /** Soft delete: flip active=false. Historical references stay intact. */
  async deactivate(id: string) {
    return this.update(id, { active: false });
  }

  /**
   * Hard delete. Refuses if the user has any historical references
   * (leads, conversations, internal notes). Marcos should use
   * deactivate() in normal flows.
   */
  async hardDelete(id: string): Promise<{ ok: boolean; reason?: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        _count: { select: { leads: true, conversations: true, internalNotes: true } },
      },
    });
    if (!user) return { ok: false, reason: 'not found' };
    const hasRefs = (user._count.leads + user._count.conversations + user._count.internalNotes) > 0;
    if (hasRefs) return { ok: false, reason: 'user has historical references — deactivate instead' };
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }
}
