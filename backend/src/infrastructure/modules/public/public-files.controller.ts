/**
 * INFRASTRUCTURE LAYER — Public file-share endpoint.
 *
 * Anonymous, rate-limit-only download of a stored file via an HMAC-signed
 * token. Used when sending a PDF (presupuesto / transcript) to a customer
 * over a channel that doesn't natively support document attachments — the
 * outbound text body carries `<base>/p/file/<token>` and the customer can
 * pull the file without logging in.
 *
 * The token bakes in path + filename + expiry; this controller is a pure
 * pass-through after verification. Defense-in-depth: `UploadStorageService.
 * resolveSafe` re-validates the path against UPLOADS_DIR.
 */

import {
  Controller,
  Get,
  HttpStatus,
  Logger,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import { FileShareService } from '../../../adapters/files/file-share.service';
import { UploadStorageService } from '../../../adapters/uploads/upload-storage.service';

@Controller('p/file')
export class PublicFilesController {
  private readonly logger = new Logger(PublicFilesController.name);

  constructor(
    private readonly fileShare: FileShareService,
    private readonly uploads: UploadStorageService,
  ) {}

  /**
   * GET /p/file/:token — verify, resolve, stream. 404 on every failure mode
   * (bad token, expired, missing file) so we don't leak signal about valid
   * vs. invalid token shapes to scrapers.
   */
  @Get(':token')
  async download(@Param('token') token: string, @Res() res: Response) {
    const verified = this.fileShare.verify(token);
    if (!verified) {
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, error: 'not found' });
    }
    const file = this.uploads.resolveSafe(verified.relativeKey);
    if (!file) {
      this.logger.warn(`Token verified but file missing: ${verified.relativeKey}`);
      return res.status(HttpStatus.NOT_FOUND).json({ success: false, error: 'not found' });
    }
    const safeName = verified.displayName.replace(/[\r\n"\\]/g, '_');
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    fs.createReadStream(file.absolute).pipe(res);
  }
}
