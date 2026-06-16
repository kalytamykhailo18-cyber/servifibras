/**
 * INFRASTRUCTURE LAYER — Public file-share module.
 *
 * Holds the unauthenticated `/p/file/:token` route. Kept in its own module
 * (separate from AdminModule) so it can't accidentally inherit the global
 * AuthGuard wiring AdminModule applies per-controller.
 */

import { Module } from '@nestjs/common';
import { FileShareService } from '../../../adapters/files/file-share.service';
import { UploadStorageService } from '../../../adapters/uploads/upload-storage.service';
import { PublicFilesController } from './public-files.controller';

@Module({
  controllers: [PublicFilesController],
  providers: [FileShareService, UploadStorageService],
  exports: [FileShareService],
})
export class PublicFilesModule {}
