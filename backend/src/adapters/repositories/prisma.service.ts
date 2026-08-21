/**
 * ADAPTERS LAYER — shared PrismaClient instance.
 *
 * Marcos 2026-08-21: hasta ahora cada service que necesitaba la DB
 * hacía `private readonly prisma = new PrismaClient()`. Con 72
 * services eso son 72 pools independientes; cada pool mantiene sus
 * conexiones abiertas hasta que el proceso termina. En prod (Postgres
 * capped a 100 conexiones) veíamos 97 idle después de 19 horas de
 * uptime, cerca del hard limit.
 *
 * `PrismaService` es un singleton global — se registra una vez en
 * `PrismaModule` (@Global) y todos los services lo inyectan por
 * constructor. Una sola conexión pool para todo el backend.
 *
 * onModuleDestroy libera la pool al shutdown ordenado (systemd stop)
 * — sin esto, restarts sucesivos podrían dejar conexiones colgadas
 * hasta que Postgres las cierre por su idle_in_transaction_session
 * timeout.
 *
 * Migración: los services existentes con `new PrismaClient()` siguen
 * funcionando en paralelo (el cap `connection_limit=1` los mantiene
 * bounded). La migración a inyectar `PrismaService` se hace por
 * service, empezando por los que más hitean la DB.
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.log.log('✅ shared Prisma pool connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.log.log('Prisma pool disconnected');
  }
}
