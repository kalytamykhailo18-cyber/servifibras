/**
 * INFRASTRUCTURE LAYER - Backup alert webhook
 *
 * Endpoint the nightly /home/servifibras/ops/backup-postgres.sh script
 * POSTs to when a run errors (non-zero exit code or any failure inside
 * the trap). The webhook fans the failure out:
 *   - WhatsApp message to BACKUP_ALERT_PHONE (so Marcos sees it within
 *     minutes regardless of whether he's looking at the panel),
 *   - AccessLog row tagged `backup.failed` so the Audit page surfaces
 *     it alongside every other privileged event.
 *
 * Auth model: this is the one endpoint inside /admin that intentionally
 * skips the JWT guard — backup runs from a systemd-managed shell with
 * no user context. Instead we gate on a shared secret read from .env
 * (BACKUP_ALERT_SECRET), passed as the X-Backup-Secret header. The
 * endpoint is bound to 127.0.0.1 in production (no external surface),
 * so the secret is defence-in-depth rather than the only line.
 *
 * Marcos's brief (2026-05-14): "si el proceso de backup no completa,
 * que me llegue una notificación automática por WhatsApp o mail".
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Logger,
  Post,
} from '@nestjs/common';
import { WhatsAppService } from '../../../adapters/whatsapp/whatsapp.service';
import { AuditLogService } from '../../../adapters/audit/audit-log.service';

interface BackupAlertBody {
  exitCode?: number;
  message?: string;
  host?: string;
  timestamp?: string;
}

@Controller('internal')
export class BackupAlertsController {
  private readonly logger = new Logger(BackupAlertsController.name);

  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly audit: AuditLogService,
  ) {}

  @Post('backup-alert')
  @HttpCode(200)
  async backupAlert(
    @Headers('x-backup-secret') secret: string | undefined,
    @Body() body: BackupAlertBody,
  ) {
    const expected = process.env.BACKUP_ALERT_SECRET || '';
    if (!expected) {
      // Mis-configured server — refuse so a misfire from the wrong host
      // doesn't get treated as a real alert. The backup script logs
      // this loudly in journalctl too.
      this.logger.warn('Backup alert dropped: BACKUP_ALERT_SECRET not set on server');
      throw new BadRequestException('Backup alert not configured');
    }
    if (!secret || secret !== expected) {
      this.logger.warn(`Backup alert rejected: bad secret`);
      throw new ForbiddenException('Invalid backup alert secret');
    }

    const exitCode = typeof body?.exitCode === 'number' ? body.exitCode : -1;
    const message = (body?.message || 'Backup falló (sin detalle)').slice(0, 500);
    const host = (body?.host || 'unknown').slice(0, 80);
    const at = body?.timestamp || new Date().toISOString();

    this.logger.error(`🚨 Backup alert from ${host}: rc=${exitCode} ${message}`);

    // Audit log entry first — that's the durable record. WhatsApp dispatch
    // can fail (token, rate limit, recipient missing) and we don't want a
    // silent failure to swallow the breadcrumb that something went wrong.
    await this.audit.log({
      action: 'backup.failed',
      metadata: { exitCode, message, host, at },
    });

    const phone = (process.env.BACKUP_ALERT_PHONE || '').trim();
    if (phone) {
      const text =
        `⚠️ Backup Servifibras falló\n` +
        `Host: ${host}\n` +
        `Exit code: ${exitCode}\n` +
        `${message}\n` +
        `Hora: ${at}\n` +
        `Revisar: journalctl -u servifibras-backup`;
      try {
        const r = await this.whatsapp.sendTextMessage(phone, text);
        if (!r?.success) {
          this.logger.error(`Backup alert WA dispatch failed: ${r?.error || 'unknown'}`);
        }
      } catch (err: any) {
        this.logger.error(`Backup alert WA threw: ${err?.message || err}`);
      }
    } else {
      this.logger.warn('Backup alert WA skipped: BACKUP_ALERT_PHONE empty');
    }

    return { success: true, received: true };
  }
}
