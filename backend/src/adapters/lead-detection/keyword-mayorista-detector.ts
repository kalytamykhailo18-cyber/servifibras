/**
 * ADAPTERS LAYER — Keyword & quantity heuristic for mayorista detection.
 *
 * Spanish-tuned. The keyword list and volume threshold come from
 * `LeadDetectionConfigService` (DB-backed Configuration row, admin-
 * editable from /settings without a redeploy). When the row is missing
 * the service falls back to compiled defaults so a fresh install still
 * detects mayoristas correctly.
 */

import { Injectable } from '@nestjs/common';
import {
  IMayoristaDetector,
  MayoristaDetectionResult,
} from '../../use-cases/lead-detection/mayorista-detector.interface';
import {
  DEFAULT_MAYORISTA_KEYWORDS,
  DEFAULT_MAYORISTA_VOLUME_THRESHOLD,
  LeadDetectionConfigService,
  runDetection,
} from './lead-detection-config.service';

@Injectable()
export class KeywordMayoristaDetector implements IMayoristaDetector {
  constructor(private readonly config: LeadDetectionConfigService) {}

  async detect(text: string): Promise<MayoristaDetectionResult> {
    const cfg = await this.config.getMayoristaConfig();
    return runDetection(text, cfg.keywords, cfg.volumeThresholdLitres);
  }

  /**
   * Synchronous variant for unit/E2E tests that don't want to await DB
   * config — uses the compiled defaults plus the env-based threshold,
   * matching the pre-config-service behaviour.
   */
  detectSync(text: string): MayoristaDetectionResult {
    const envThreshold = Number(process.env.MAYORISTA_VOLUME_THRESHOLD);
    const threshold =
      Number.isFinite(envThreshold) && envThreshold > 0
        ? envThreshold
        : DEFAULT_MAYORISTA_VOLUME_THRESHOLD;
    return runDetection(text, DEFAULT_MAYORISTA_KEYWORDS, threshold);
  }
}
