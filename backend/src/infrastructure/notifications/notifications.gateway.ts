/**
 * INFRASTRUCTURE LAYER - Real-time Notifications Gateway
 *
 * Authenticates Socket.io connections with the same JWT used by the REST API
 * and routes them into per-user rooms (`user:<userId>`). Backend code emits
 * notification events through `NotificationsService` — never directly through
 * `server.emit()` — so we keep one place that knows how rooms are named.
 *
 * Configuration is read from `.env`:
 *   - CORS_ORIGINS — same comma-separated list used for HTTP CORS
 */

import { Logger, OnModuleInit } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../../adapters/auth/auth.service';

const ROOM_PREFIX = 'user:';

function parseCorsOrigins(): string[] {
  return (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

@WebSocketGateway({
  cors: {
    origin: parseCorsOrigins(),
    credentials: true,
  },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly authService: AuthService) {}

  onModuleInit() {
    this.logger.log(`✅ Notifications gateway ready (CORS: ${parseCorsOrigins().join(', ')})`);
  }

  async handleConnection(client: Socket) {
    // Token can be passed via socket.io-client `auth.token` (preferred) or
    // an `Authorization: Bearer <token>` header for legacy clients.
    const token =
      (client.handshake.auth as any)?.token ||
      (client.handshake.headers.authorization || '').replace(/^Bearer\s+/i, '');

    if (!token) {
      this.logger.warn(`socket ${client.id} rejected: no token`);
      client.emit('auth:error', { message: 'Missing token' });
      client.disconnect(true);
      return;
    }

    const user = await this.authService.validateToken(token);
    if (!user) {
      this.logger.warn(`socket ${client.id} rejected: invalid token`);
      client.emit('auth:error', { message: 'Invalid or expired token' });
      client.disconnect(true);
      return;
    }

    (client.data as any).user = user;
    await client.join(roomFor(user.id));
    // Also join a per-role room so role-targeted broadcasts (e.g. ADMIN
    // alerts on quality-scoring severity) hit every connected admin
    // session at once without us tracking individual user ids.
    if (user.role) {
      await client.join(roleRoom(user.role));
    }
    this.logger.log(`socket ${client.id} joined ${roomFor(user.id)} (${user.email})`);
    client.emit('auth:ok', { userId: user.id, role: user.role });
  }

  handleDisconnect(client: Socket) {
    const user = (client.data as any)?.user;
    this.logger.log(`socket ${client.id} disconnected${user ? ` (${user.email})` : ''}`);
  }

  /**
   * Emit an event to a specific user's room. Returns false if the gateway
   * server isn't yet initialised (e.g. during boot) — callers can ignore the
   * boolean since events lost during boot don't matter.
   */
  emitToUser(userId: string, event: string, payload: unknown): boolean {
    if (!this.server) return false;
    this.server.to(roomFor(userId)).emit(event, payload);
    return true;
  }

  /**
   * Broadcast an event to every connected client. Use for global signals like
   * dashboard metric ticks.
   */
  broadcast(event: string, payload: unknown): boolean {
    if (!this.server) return false;
    this.server.emit(event, payload);
    return true;
  }

  /** Emit an event to every session whose authenticated user has the given role. */
  emitToRole(role: string, event: string, payload: unknown): boolean {
    if (!this.server) return false;
    this.server.to(roleRoom(role)).emit(event, payload);
    return true;
  }
}

function roomFor(userId: string): string {
  return `${ROOM_PREFIX}${userId}`;
}

function roleRoom(role: string): string {
  return `role:${String(role).toUpperCase()}`;
}
