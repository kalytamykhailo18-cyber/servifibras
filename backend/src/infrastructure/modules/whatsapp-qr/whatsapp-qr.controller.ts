/**
 * Marcos 2026-06-30: panel admin del canal WhatsApp QR. Tres
 * endpoints — status (poll desde el frontend), qr (PNG dataURL para
 * que el operador escanee), disconnect (wipea sesión + reinicia
 * para vincular otro número).
 *
 * Gateado a ADMIN: el QR vincula una cuenta WhatsApp completa al
 * servidor — solo Marcos / Yanina deberían tener esa palanca.
 */

import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { WhatsappQrService } from '../../../adapters/whatsapp-qr/whatsapp-qr.service';

@Controller('admin/whatsapp-qr')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class WhatsappQrController {
  constructor(private readonly svc: WhatsappQrService) {}

  @Get('status')
  async status() {
    return { success: true, data: this.svc.getStatus() };
  }

  /**
   * Devuelve { qrDataUrl: string | null }. null = no hay QR pendiente
   * (ya conectado, o el módulo está disabled). El frontend hace polling
   * cada ~3s mientras status='waiting_qr'.
   */
  @Get('qr')
  async qr() {
    return { success: true, data: { qrDataUrl: this.svc.getQrDataUrl() } };
  }

  /** Reinicia el socket. Útil si el módulo arrancó con error o
   *  Marcos cambió WHATSAPP_QR_ENABLED en .env. */
  @Post('start')
  async start() {
    return { success: true, data: await this.svc.start() };
  }

  /**
   * Desconecta. Por default mantiene la sesión persistida (próximo
   * start() vuelve a conectar la misma cuenta sin re-escanear).
   * { wipeSession: true } limpia el dir — fuerza QR fresco al próximo
   * start() para vincular otro número.
   */
  @Post('disconnect')
  async disconnect(@Body() body: { wipeSession?: boolean }) {
    return { success: true, data: await this.svc.disconnect({ wipeSession: !!body?.wipeSession }) };
  }
}
