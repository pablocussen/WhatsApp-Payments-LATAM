const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserTipJarService } from '../../src/services/user-tip-jar.service';

describe('UserTipJarService', () => {
  let s: UserTipJarService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserTipJarService(); mockRedisGet.mockResolvedValue(null); });

  it('creates tip jar', async () => {
    const j = await s.createJar({ userId: 'u1', slug: 'pablo-music', displayName: 'Pablo', message: 'Gracias por escuchar!' });
    expect(j.slug).toBe('pablo-music');
    expect(j.suggestedAmounts).toEqual([1000, 2000, 5000, 10000]);
    expect(j.active).toBe(true);
  });

  it('rejects invalid slug', async () => {
    await expect(s.createJar({ userId: 'u1', slug: 'Pablo Music!', displayName: 'X', message: 'X' })).rejects.toThrow('alfanumerico');
  });

  it('rejects duplicate slug', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ slug: 'taken' }));
    await expect(s.createJar({ userId: 'u1', slug: 'taken', displayName: 'X', message: 'X' })).rejects.toThrow('ya en uso');
  });

  it('sends tip', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ slug: 'p', active: true, totalReceived: 10000, tipCount: 3, topTip: 5000 }));
    const r = await s.sendTip('p', 2000);
    expect(r.success).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.totalReceived).toBe(12000);
    expect(saved.tipCount).toBe(4);
  });

  it('updates top tip', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ slug: 'p', active: true, totalReceived: 10000, tipCount: 1, topTip: 5000 }));
    await s.sendTip('p', 20000);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.topTip).toBe(20000);
  });

  it('rejects tip below 500', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ slug: 'p', active: true }));
    const r = await s.sendTip('p', 100);
    expect(r.success).toBe(false);
    expect(r.error).toContain('500');
  });

  it('rejects tip on inactive jar', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ slug: 'p', active: false }));
    expect((await s.sendTip('p', 1000)).success).toBe(false);
  });

  it('generates URL', () => {
    expect(s.getJarUrl('pablo-music')).toBe('https://whatpay.cl/tip/pablo-music');
  });

  it('formats summary with average', () => {
    const f = s.formatJarSummary({ displayName: 'Pablo', totalReceived: 30000, tipCount: 10, topTip: 5000 } as any);
    expect(f).toContain('Pablo');
    expect(f).toContain('$30.000');
    expect(f).toContain('$3.000');
  });
});
