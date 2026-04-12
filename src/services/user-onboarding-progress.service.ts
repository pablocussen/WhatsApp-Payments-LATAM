import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('onboarding-progress');
const OP_PREFIX = 'onbprog:';
const OP_TTL = 365 * 24 * 60 * 60;

export type OnboardingStep = 'WELCOME' | 'RUT_VERIFY' | 'PIN_CREATE' | 'KYC_BASIC' | 'FIRST_TOPUP' | 'FIRST_PAYMENT' | 'COMPLETED';

export interface OnboardingProgress {
  userId: string;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  startedAt: string;
  completedAt: string | null;
  lastActiveAt: string;
}

const STEP_ORDER: OnboardingStep[] = ['WELCOME', 'RUT_VERIFY', 'PIN_CREATE', 'KYC_BASIC', 'FIRST_TOPUP', 'FIRST_PAYMENT', 'COMPLETED'];

export class UserOnboardingProgressService {
  async getProgress(userId: string): Promise<OnboardingProgress> {
    try {
      const redis = getRedis();
      const raw = await redis.get(OP_PREFIX + userId);
      if (raw) return JSON.parse(raw) as OnboardingProgress;
    } catch { /* default */ }
    return {
      userId, currentStep: 'WELCOME', completedSteps: [],
      startedAt: new Date().toISOString(),
      completedAt: null,
      lastActiveAt: new Date().toISOString(),
    };
  }

  async completeStep(userId: string, step: OnboardingStep): Promise<OnboardingProgress> {
    const progress = await this.getProgress(userId);
    if (!progress.completedSteps.includes(step)) {
      progress.completedSteps.push(step);
    }
    const idx = STEP_ORDER.indexOf(step);
    if (idx < STEP_ORDER.length - 1) {
      progress.currentStep = STEP_ORDER[idx + 1];
    } else {
      progress.currentStep = 'COMPLETED';
      progress.completedAt = new Date().toISOString();
    }
    progress.lastActiveAt = new Date().toISOString();
    try { const redis = getRedis(); await redis.set(OP_PREFIX + userId, JSON.stringify(progress), { EX: OP_TTL }); }
    catch (err) { log.warn('Failed to save progress', { error: (err as Error).message }); }
    log.info('Onboarding step completed', { userId, step });
    return progress;
  }

  getCompletionPercentage(progress: OnboardingProgress): number {
    const total = STEP_ORDER.length - 1; // exclude COMPLETED
    return Math.round((progress.completedSteps.filter(s => s !== 'COMPLETED').length / total) * 100);
  }

  isComplete(progress: OnboardingProgress): boolean {
    return progress.currentStep === 'COMPLETED';
  }
}

export const userOnboardingProgress = new UserOnboardingProgressService();
