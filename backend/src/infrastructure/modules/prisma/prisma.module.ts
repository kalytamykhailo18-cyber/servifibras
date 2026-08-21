/**
 * INFRASTRUCTURE LAYER — Prisma global module.
 *
 * Marcos 2026-08-21: expone `PrismaService` como singleton global
 * para que cualquier módulo lo inyecte sin importar el módulo. Es la
 * capa de compartir un único PrismaClient entre todos los services,
 * en lugar del patrón previo `new PrismaClient()` por-service que
 * multiplicaba pools.
 */

import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../../../adapters/repositories/prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
