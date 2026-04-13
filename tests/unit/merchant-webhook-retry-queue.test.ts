const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantWebhookRetryQueueService } from '../../src/services/merchant-webhook-retry-queue.service';

describe('MerchantWebhookRetryQueueService', () => {
  let s: MerchantWebhookRetryQueueService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantWebhookRetryQueueService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    merchantId: 'm1',
    webhookUrl: 'https://example.com/hook',
    eventType: 'payment.completed',
    payload: { amount: 10000 },
  };

  it('enqueues job', async () => {
    const j = await s.enqueue(base);
    expect(j.status).toBe('PENDING');
    expect(j.maxAttempts).toBe(5);
  });

  it('rejects non-HTTPS url', async () => {
    await expect(s.enqueue({ ...base, webhookUrl: 'http://example.com' })).rejects.toThrow('HTTPS');
  });

  it('rejects invalid max attempts', async () => {
    await expect(s.enqueue({ ...base, maxAttempts: 20 })).rejects.toThrow('1 y 10');
  });

  it('marks success on SUCCESS', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'j1', attempts: 0, maxAttempts: 5, status: 'PENDING',
    }]));
    const j = await s.markAttempt('m1', 'j1', 'SUCCESS');
    expect(j?.status).toBe('SUCCEEDED');
    expect(j?.completedAt).toBeDefined();
  });

  it('schedules retry on failure with backoff', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'j1', attempts: 1, maxAttempts: 5, status: 'RETRYING',
    }]));
    const before = Date.now();
    const j = await s.markAttempt('m1', 'j1', 'FAILURE', 'timeout');
    expect(j?.status).toBe('RETRYING');
    expect(j?.attempts).toBe(2);
    expect(j?.lastError).toBe('timeout');
    const retryMs = new Date(j!.nextRetryAt).getTime();
    expect(retryMs - before).toBeGreaterThanOrEqual(3 * 60000);
  });

  it('abandons after max attempts', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'j1', attempts: 4, maxAttempts: 5, status: 'RETRYING',
    }]));
    const j = await s.markAttempt('m1', 'j1', 'FAILURE', 'dead');
    expect(j?.status).toBe('ABANDONED');
  });

  it('rejects attempt on finalized job', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'j1', status: 'SUCCEEDED',
    }]));
    await expect(s.markAttempt('m1', 'j1', 'SUCCESS')).rejects.toThrow('finalizado');
  });

  it('returns due jobs', async () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const future = new Date(Date.now() + 60000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'j1', status: 'PENDING', nextRetryAt: past },
      { id: 'j2', status: 'RETRYING', nextRetryAt: past },
      { id: 'j3', status: 'PENDING', nextRetryAt: future },
      { id: 'j4', status: 'SUCCEEDED', nextRetryAt: past },
    ]));
    const due = await s.getDueJobs('m1');
    expect(due).toHaveLength(2);
  });

  it('manually abandons job', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'j1', status: 'PENDING' }]));
    const j = await s.abandon('m1', 'j1');
    expect(j?.status).toBe('ABANDONED');
  });

  it('rejects abandon on succeeded', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'j1', status: 'SUCCEEDED' }]));
    await expect(s.abandon('m1', 'j1')).rejects.toThrow('exitoso');
  });

  it('computes stats with success rate', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'SUCCEEDED' }, { status: 'SUCCEEDED' }, { status: 'SUCCEEDED' },
      { status: 'ABANDONED' }, { status: 'PENDING' }, { status: 'RETRYING' },
    ]));
    const stats = await s.getStats('m1');
    expect(stats.succeeded).toBe(3);
    expect(stats.abandoned).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.retrying).toBe(1);
    expect(stats.successRate).toBe(75);
  });

  it('cleans up old finished jobs', async () => {
    const old = new Date(Date.now() - 48 * 3600000).toISOString();
    const recent = new Date().toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'SUCCEEDED', completedAt: old },
      { status: 'ABANDONED', completedAt: old },
      { status: 'SUCCEEDED', completedAt: recent },
      { status: 'PENDING' },
    ]));
    expect(await s.cleanupOld('m1', 24)).toBe(2);
  });
});
