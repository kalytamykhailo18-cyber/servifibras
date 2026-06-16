/**
 * INFRASTRUCTURE LAYER — Admin Uploads Controller
 *
 * Auth-gated download of previously-uploaded attachments. Lives under
 * `/admin/uploads/*` so the URLs we persist on Message rows resolve here.
 */

import {
  Controller,
  Get,
  HttpStatus,
  Logger,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import { AuthGuard } from '../../guards/auth.guard';
import { RolesGuard, Roles } from '../../guards/roles.guard';
import { UserRole } from '../../../domain/entities/auth.entity';
import { UploadStorageService } from '../../../adapters/uploads/upload-storage.service';

@Controller('admin/uploads')
@UseGuards(AuthGuard, RolesGuard)
export class UploadsController {
  private readonly logger = new Logger(UploadsController.name);

  constructor(private readonly uploads: UploadStorageService) {}

  /**
   * GET /admin/uploads/:y/:m/:name → streams the attachment back with the
   * correct MIME type. Path parameters mirror the storage layout
   * (yyyy/mm/uuid.ext) so we don't have to maintain a key→path index.
   */
  @Get(':y/:m/:name')
  @Roles(UserRole.ADMIN, UserRole.ATENCION, UserRole.VENTAS, UserRole.LOGISTICA)
  async download(
    @Param('y') y: string,
    @Param('m') m: string,
    @Param('name') name: string,
    @Res() res: Response,
  ) {
    const key = `${y}/${m}/${name}`;
    const file = this.uploads.resolveSafe(key);
    if (!file) {
      return res
        .status(HttpStatus.NOT_FOUND)
        .json({ success: false, error: 'not found' });
    }
    res.setHeader('Content-Type', file.mime);
    // Inline disposition so images/PDFs render in-tab rather than triggering
    // a download — operators usually want to glance at attachments.
    res.setHeader('Content-Disposition', `inline; filename="${name}"`);
    fs.createReadStream(file.absolute).pipe(res);
  }
}
