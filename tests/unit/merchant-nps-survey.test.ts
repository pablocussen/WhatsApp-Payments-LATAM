const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantNPSSurveyService } from '../../src/services/merchant-nps-survey.service';

describe('MerchantNPSSurveyService', () => {
  let s: MerchantNPSSurveyService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantNPSSurveyService(); mockRedisGet.mockResolvedValue(null); });

  it('categorizes promoter', async () => {
    const r = await s.submitResponse({ merchantId: 'm1', customerId: 'c1', score: 10 });
    expect(r.category).toBe('PROMOTER');
  });

  it('categorizes passive', async () => {
    const r = await s.submitResponse({ merchantId: 'm1', customerId: 'c1', score: 7 });
    expect(r.category).toBe('PASSIVE');
  });

  it('categorizes detractor', async () => {
    const r = await s.submitResponse({ merchantId: 'm1', customerId: 'c1', score: 5 });
    expect(r.category).toBe('DETRACTOR');
  });

  it('rejects out of range score', async () => {
    await expect(s.submitResponse({ merchantId: 'm1', customerId: 'c1', score: 11 })).rejects.toThrow('0 y 10');
    await expect(s.submitResponse({ merchantId: 'm1', customerId: 'c1', score: -1 })).rejects.toThrow('0 y 10');
  });

  it('rejects non-integer score', async () => {
    await expect(s.submitResponse({ merchantId: 'm1', customerId: 'c1', score: 7.5 })).rejects.toThrow('entero');
  });

  it('rejects long comment', async () => {
    await expect(s.submitResponse({ merchantId: 'm1', customerId: 'c1', score: 10, comment: 'x'.repeat(501) })).rejects.toThrow('500');
  });

  it('computes NPS score correctly', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { category: 'PROMOTER', score: 10, createdAt: new Date().toISOString() },
      { category: 'PROMOTER', score: 9, createdAt: new Date().toISOString() },
      { category: 'PROMOTER', score: 10, createdAt: new Date().toISOString() },
      { category: 'PROMOTER', score: 10, createdAt: new Date().toISOString() },
      { category: 'PROMOTER', score: 9, createdAt: new Date().toISOString() },
      { category: 'PROMOTER', score: 10, createdAt: new Date().toISOString() },
      { category: 'PASSIVE', score: 8, createdAt: new Date().toISOString() },
      { category: 'PASSIVE', score: 7, createdAt: new Date().toISOString() },
      { category: 'DETRACTOR', score: 5, createdAt: new Date().toISOString() },
      { category: 'DETRACTOR', score: 3, createdAt: new Date().toISOString() },
    ]));
    const stats = await s.getStats('m1');
    expect(stats.totalResponses).toBe(10);
    expect(stats.promoters).toBe(6);
    expect(stats.detractors).toBe(2);
    expect(stats.npsScore).toBe(40);
    expect(stats.averageScore).toBe(8.1);
  });

  it('returns zero stats on empty', async () => {
    const stats = await s.getStats('m1');
    expect(stats.npsScore).toBe(0);
    expect(stats.totalResponses).toBe(0);
  });

  it('filters stats by sinceDays', async () => {
    const old = new Date(Date.now() - 60 * 86400000).toISOString();
    const recent = new Date().toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { category: 'DETRACTOR', score: 3, createdAt: old },
      { category: 'PROMOTER', score: 10, createdAt: recent },
    ]));
    const stats = await s.getStats('m1', 30);
    expect(stats.totalResponses).toBe(1);
    expect(stats.npsScore).toBe(100);
  });

  it('returns detractor comments sorted recent first', async () => {
    const older = new Date(Date.now() - 86400000).toISOString();
    const newer = new Date().toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { category: 'DETRACTOR', comment: 'malo', createdAt: older },
      { category: 'DETRACTOR', comment: 'pesimo', createdAt: newer },
      { category: 'PROMOTER', comment: 'excelente', createdAt: newer },
      { category: 'DETRACTOR', comment: '', createdAt: newer },
    ]));
    const comments = await s.getDetractorComments('m1');
    expect(comments).toHaveLength(2);
    expect(comments[0].comment).toBe('pesimo');
  });

  it('formats stats with rating', () => {
    const f = s.formatStats({ totalResponses: 100, promoters: 80, passives: 10, detractors: 10, npsScore: 70, averageScore: 9.2 });
    expect(f).toContain('Excelente');
    expect(f).toContain('NPS: 70');
  });
});
