import { Global, Module, Provider } from '@nestjs/common';
import { KeywordMayoristaDetector } from '../../../adapters/lead-detection/keyword-mayorista-detector';
import { LeadDetectionConfigService } from '../../../adapters/lead-detection/lead-detection-config.service';
import { LeadAutoAssignmentService } from '../../../adapters/lead-detection/lead-auto-assignment.service';
import { KeywordHumanHandoffDetector } from '../../../adapters/lead-detection/keyword-human-handoff-detector';
import { HumanHandoffService } from '../../../adapters/lead-detection/human-handoff.service';
import { HandoffReconcileCron } from '../../../adapters/lead-detection/handoff-reconcile.cron';
import { KeywordCustomerTypeDetector } from '../../../adapters/lead-detection/keyword-customer-type-detector';
import { ContactDimensionsService } from '../../../adapters/lead-detection/contact-dimensions.service';
import { KeywordComplexityClassifier } from '../../../adapters/lead-detection/keyword-complexity-classifier';
import { ClaudeComplexityClassifier } from '../../../adapters/lead-detection/claude-complexity-classifier';
import { ClaudeCustomerTypeDetector } from '../../../adapters/lead-detection/claude-customer-type-detector';
import { ClaudeMayoristaDetector } from '../../../adapters/lead-detection/claude-mayorista-detector';
import { ClaudeHumanHandoffDetector } from '../../../adapters/lead-detection/claude-human-handoff-detector';
import { NotificationsModule } from '../../notifications/notifications.module';
import { AIModule } from '../ai/ai.module';
import { ClaudeService } from '../../../adapters/ai/claude.service';
import { CUSTOMER_TYPE_DETECTOR } from '../../../use-cases/lead-detection/customer-type-detector.interface';
import { MAYORISTA_DETECTOR } from '../../../use-cases/lead-detection/mayorista-detector.interface';
import { HUMAN_HANDOFF_DETECTOR } from '../../../use-cases/lead-detection/human-handoff-detector.interface';

import { COMPLEXITY_CLASSIFIER } from '../../../use-cases/lead-detection/complexity-classifier.interface';

/**
 * Pick the active complexity classifier at boot. Default is keyword for
 * deterministic dev runs; flip COMPLEXITY_CLASSIFIER_BACKEND=llm in `.env`
 * once Marcos's API key is in place.
 *
 * Even with backend=llm, the Claude adapter falls back internally to the
 * keyword classifier when the API isn't configured — so misconfiguration
 * never breaks the pipeline.
 */
const complexityClassifierProvider: Provider = {
  provide: COMPLEXITY_CLASSIFIER,
  useFactory: (claude: ClaudeService, keyword: KeywordComplexityClassifier) => {
    const backend = (process.env.COMPLEXITY_CLASSIFIER_BACKEND ?? 'keyword').toLowerCase();
    if (backend === 'llm') {
      return new ClaudeComplexityClassifier(claude, keyword);
    }
    return keyword;
  },
  inject: [ClaudeService, KeywordComplexityClassifier],
};

const customerTypeDetectorProvider: Provider = {
  provide: CUSTOMER_TYPE_DETECTOR,
  useFactory: (claude: ClaudeService, keyword: KeywordCustomerTypeDetector) => {
    const backend = (process.env.CUSTOMER_TYPE_DETECTOR_BACKEND ?? 'keyword').toLowerCase();
    if (backend === 'llm') {
      return new ClaudeCustomerTypeDetector(claude, keyword);
    }
    return keyword;
  },
  inject: [ClaudeService, KeywordCustomerTypeDetector],
};

const mayoristaDetectorProvider: Provider = {
  provide: MAYORISTA_DETECTOR,
  useFactory: (claude: ClaudeService, keyword: KeywordMayoristaDetector) => {
    const backend = (process.env.MAYORISTA_DETECTOR_BACKEND ?? 'keyword').toLowerCase();
    if (backend === 'llm') {
      return new ClaudeMayoristaDetector(claude, keyword);
    }
    return keyword;
  },
  inject: [ClaudeService, KeywordMayoristaDetector],
};

const handoffDetectorProvider: Provider = {
  provide: HUMAN_HANDOFF_DETECTOR,
  useFactory: (claude: ClaudeService, keyword: KeywordHumanHandoffDetector) => {
    const backend = (process.env.HANDOFF_DETECTOR_BACKEND ?? 'keyword').toLowerCase();
    if (backend === 'llm') {
      return new ClaudeHumanHandoffDetector(claude, keyword);
    }
    return keyword;
  },
  inject: [ClaudeService, KeywordHumanHandoffDetector],
};

@Global()
@Module({
  imports: [NotificationsModule, AIModule],
  providers: [
    LeadDetectionConfigService,
    KeywordMayoristaDetector,
    LeadAutoAssignmentService,
    KeywordHumanHandoffDetector,
    HumanHandoffService,
    KeywordCustomerTypeDetector,
    ContactDimensionsService,
    KeywordComplexityClassifier,
    complexityClassifierProvider,
    customerTypeDetectorProvider,
    mayoristaDetectorProvider,
    handoffDetectorProvider,
    HandoffReconcileCron,
  ],
  exports: [
    LeadDetectionConfigService,
    KeywordMayoristaDetector,
    LeadAutoAssignmentService,
    KeywordHumanHandoffDetector,
    HumanHandoffService,
    KeywordCustomerTypeDetector,
    ContactDimensionsService,
    KeywordComplexityClassifier,
    COMPLEXITY_CLASSIFIER,
    CUSTOMER_TYPE_DETECTOR,
    MAYORISTA_DETECTOR,
    HUMAN_HANDOFF_DETECTOR,
  ],
})
export class LeadDetectionModule {}
