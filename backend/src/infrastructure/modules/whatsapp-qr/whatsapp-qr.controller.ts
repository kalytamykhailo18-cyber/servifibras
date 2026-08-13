/**
 * Marcos 2026-06-30: panel admin del canal WhatsApp QR. Tres
 * endpoints — status (poll desde el frontend), qr (PNG dataURL para
 * que el operador escanee), disconnect (wipea sesión + reinicia
 * para vincular otro número).
 *
 * Marcos 2026-08-13 (WhatsApp 7:04 AR): "se nos desconectó whatsapp
 * y yo no tengo el dispositivo para iniciar sesión. Le podemos dar
 * acceso al qr a otros usuarios para que puedan conectar?". Ampliado
 * a ENCARGADO — Brenda / Franco pueden escanear el QR cuando Marcos
 * no está físicamente con el teléfono. `disconnect` con
 * wipeSession:true sigue siendo destructivo (des-vincula la cuenta)
 * así que la ruta seguirá cubierta por el mismo Rol; si en algún
 * momento hay que reducir el blast-radius, ese endpoint puede volver
 * a ADMIN-only con un guard por-endpoint.
 */

import { Body, Controller, Get, Headers, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { WhatsappQrService } from '../../../adapters/whatsapp-qr/whatsapp-qr.service';

@Controller('admin/whatsapp-qr')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.ENCARGADO)
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

/**
 * Marcos 2026-07-06: controller separado (sin AuthGuard/RolesGuard)
 * para prueba de envío desde el propio servidor. Gate: shared secret
 * en header X-Test-Token contra WHATSAPP_QR_TEST_TOKEN del .env. Sin
 * token en .env el endpoint devuelve 401. Diseñado para hacer un
 * curl desde localhost y validar el path outbound Baileys sin tocar
 * conversaciones reales.
 */
@Controller('admin/whatsapp-qr')
export class WhatsappQrTestController {
  constructor(private readonly svc: WhatsappQrService) {}

  @Post('test-send')
  async testSend(
    @Body() body: { to: string; text: string },
    @Headers('x-test-token') tokenHeader?: string,
  ) {
    const expected = (process.env.WHATSAPP_QR_TEST_TOKEN ?? '').trim();
    if (!expected) throw new UnauthorizedException('test-send disabled');
    if ((tokenHeader ?? '').trim() !== expected) throw new UnauthorizedException('bad token');
    if (!body?.to || !body?.text) {
      return { success: false, error: 'to and text are required' };
    }
    const r = await this.svc.sendMessage(body.to, body.text);
    return { success: r.success, data: r };
  }
}
