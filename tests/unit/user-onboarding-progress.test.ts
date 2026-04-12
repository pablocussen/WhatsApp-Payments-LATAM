const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserOnboardingProgressService } from '../../src/services/user-onboarding-progress.service';

describe('UserOnboardingProgressService', () => {
  let s: UserOnboardingProgressService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserOnboardingProgressService(); mockRedisGet.mockResolvedValue(null); });

  it('returns default for new user', async () => {
    const p = await s.getProgress('u1');
    expect(p.currentStep).toBe('WELCOME');
    expect(p.completedSteps).toEqual([]);
  });

  it('advances through steps', async () => {
    const p = await s.completeStep('u1', 'WELCOME');
    expect(p.completedSteps).toContain('WELCOME');
    expect(p.currentStep).toBe('RUT_VERIFY');
  });

  it('completes all steps', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      userId: 'u1', currentStep: 'FIRST_PAYMENT',
      completedSteps: ['WELCOME', 'RUT_VERIFY', 'PIN_CREATE', 'KYC_BASIC', 'FIRST_TOPUP'],
      startedAt: '', lastActiveAt: '',
    }));
    const p = await s.completeStep('u1', 'FIRST_PAYMENT');
    expect(p.currentStep).toBe('COMPLETED');
    expect(p.completedAt).toBeDefined();
  });

  it('calculates percentage', () => {
    expect(s.getCompletionPercentage({ completedSteps: ['WELCOME', 'RUT_VERIFY', 'PIN_CREATE'] } as any)).toBe(50);
    expect(s.getCompletionPercentage({ completedSteps: [] } as any)).toBe(0);
  });

  it('detects completion', () => {
    expect(s.isComplete({ currentStep: 'COMPLETED' } as any)).toBe(true);
    expect(s.isComplete({ currentStep: 'WELCOME' } as any)).toBe(false);
  });

  it('does not duplicate completed steps', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      userId: 'u1', currentStep: 'WELCOME',
      completedSteps: ['WELCOME'], startedAt: '', lastActiveAt: '',
    }));
    const p = await s.completeStep('u1', 'WELCOME');
    expect(p.completedSteps.filter(s => s === 'WELCOME')).toHaveLength(1);
  });
});
