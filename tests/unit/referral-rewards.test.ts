/**
 * ReferralRewardsService — referral tracking + rewards.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { ReferralRewardsService } from '../../src/services/referral-rewards.service';

describe('ReferralRewardsService', () => {
  let service: ReferralRewardsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReferralRewardsService();
    mockRedisGet.mockResolvedValue(null);
  });

  // ── generateCode ──────────────────────────────────

  it('generates code from userId', () => {
    expect(service.generateCode('user-abc123')).toBe('WP-ABC123');
  });

  // ── recordReferral ────────────────────────────────

  it('records a referral', async () => {
    const reward = await service.recordReferral('u1', 'u2');
    expect(reward.referrerId).toBe('u1');
    expect(reward.refereeId).toBe('u2');
    expect(reward.referrerReward).toBe(2000);
    expect(reward.refereeReward).toBe(2000);
    expect(reward.status).toBe('PENDING');
  });

  it('rejects self-referral', async () => {
    await expect(service.recordReferral('u1', 'u1')).rejects.toThrow('ti mismo');
  });

  it('rejects duplicate referral', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { referrerId: 'u1', refereeId: 'u2', status: 'PENDING' },
    ]));
    await expect(service.recordReferral('u1', 'u2')).rejects.toThrow('ya fue referido');
  });

  it('rejects over 50 completed referrals', async () => {
    const rewards = Array.from({ length: 50 }, (_, i) => ({
      referrerId: 'u1', refereeId: `ref${i}`, status: 'COMPLETED',
    }));
    mockRedisGet.mockResolvedValue(JSON.stringify(rewards));
    await expect(service.recordReferral('u1', 'u99')).rejects.toThrow('50');
  });

  // ── completeReferral ──────────────────────────────

  it('completes a pending referral', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { referrerId: 'u1', refereeId: 'u2', referrerReward: 2000, refereeReward: 2000, status: 'PENDING', completedAt: null },
    ]));
    const reward = await service.completeReferral('u1', 'u2');
    expect(reward?.status).toBe('COMPLETED');
    expect(reward?.completedAt).toBeDefined();
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].status).toBe('COMPLETED');
  });

  it('returns null for non-existent referral', async () => {
    expect(await service.completeReferral('u1', 'u99')).toBeNull();
  });

  // ── getStats ──────────────────────────────────────

  it('returns zero stats for new user', async () => {
    const stats = await service.getStats('u1');
    expect(stats.totalReferred).toBe(0);
    expect(stats.totalRewarded).toBe(0);
    expect(stats.totalEarned).toBe(0);
  });

  it('calculates stats correctly', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { referrerId: 'u1', refereeId: 'u2', referrerReward: 2000, status: 'COMPLETED' },
      { referrerId: 'u1', refereeId: 'u3', referrerReward: 2000, status: 'COMPLETED' },
      { referrerId: 'u1', refereeId: 'u4', referrerReward: 2000, status: 'PENDING' },
    ]));
    const stats = await service.getStats('u1');
    expect(stats.totalReferred).toBe(3);
    expect(stats.totalRewarded).toBe(2);
    expect(stats.totalEarned).toBe(4000);
    expect(stats.pendingRewards).toBe(1);
  });

  // ── getStatsSummary ───────────────────────────────

  it('formats summary', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { referrerId: 'u1', refereeId: 'u2', referrerReward: 2000, status: 'COMPLETED' },
    ]));
    const summary = await service.getStatsSummary('u1');
    expect(summary).toContain('Referidos: 1');
    expect(summary).toContain('$2.000');
    expect(summary).toContain('WP-');
  });
});
