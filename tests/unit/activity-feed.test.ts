/**
 * ActivityFeedService — user activity timeline.
 */

const mockRedisLPush = jest.fn().mockResolvedValue(1);
const mockRedisLTrim = jest.fn().mockResolvedValue('OK');
const mockRedisLRange = jest.fn().mockResolvedValue([]);
const mockRedisLLen = jest.fn().mockResolvedValue(0);
const mockRedisExpire = jest.fn().mockResolvedValue(true);

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    lPush: (...args: unknown[]) => mockRedisLPush(...args),
    lTrim: (...args: unknown[]) => mockRedisLTrim(...args),
    lRange: (...args: unknown[]) => mockRedisLRange(...args),
    lLen: (...args: unknown[]) => mockRedisLLen(...args),
    expire: (...args: unknown[]) => mockRedisExpire(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { ActivityFeedService } from '../../src/services/activity-feed.service';

describe('ActivityFeedService', () => {
  let service: ActivityFeedService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ActivityFeedService();
  });

  it('adds item to feed', async () => {
    const item = await service.addItem({
      userId: 'u1', type: 'PAYMENT_SENT', title: 'Pago enviado',
      detail: '$5.000 a +569', amount: 5000,
    });
    expect(item.id).toMatch(/^act_/);
    expect(item.type).toBe('PAYMENT_SENT');
    expect(item.title).toBe('Pago enviado');
    expect(item.amount).toBe(5000);
    expect(mockRedisLPush).toHaveBeenCalled();
    expect(mockRedisLTrim).toHaveBeenCalledWith(expect.any(String), 0, 99);
  });

  it('adds item with minimal fields', async () => {
    const item = await service.addItem({ userId: 'u1', type: 'LOGIN', title: 'Inicio de sesión' });
    expect(item.detail).toBeNull();
    expect(item.amount).toBeNull();
    expect(item.relatedId).toBeNull();
  });

  it('returns empty feed for new user', async () => {
    const feed = await service.getFeed('u1');
    expect(feed).toEqual([]);
  });

  it('returns parsed feed items', async () => {
    mockRedisLRange.mockResolvedValue([
      JSON.stringify({ id: 'act_1', type: 'LOGIN', title: 'Login' }),
      JSON.stringify({ id: 'act_2', type: 'PAYMENT_SENT', title: 'Pago' }),
    ]);
    const feed = await service.getFeed('u1');
    expect(feed).toHaveLength(2);
    expect(feed[0].id).toBe('act_1');
  });

  it('respects limit and offset', async () => {
    await service.getFeed('u1', 10, 5);
    expect(mockRedisLRange).toHaveBeenCalledWith(expect.any(String), 5, 14);
  });

  it('filters by type', async () => {
    mockRedisLRange.mockResolvedValue([
      JSON.stringify({ id: 'act_1', type: 'LOGIN', title: 'Login' }),
      JSON.stringify({ id: 'act_2', type: 'PAYMENT_SENT', title: 'Pago' }),
      JSON.stringify({ id: 'act_3', type: 'LOGIN', title: 'Login 2' }),
    ]);
    const logins = await service.getFeedByType('u1', 'LOGIN');
    expect(logins).toHaveLength(2);
    expect(logins.every(i => i.type === 'LOGIN')).toBe(true);
  });

  it('returns feed count', async () => {
    mockRedisLLen.mockResolvedValue(15);
    expect(await service.getFeedCount('u1')).toBe(15);
  });

  it('returns correct icons', () => {
    expect(service.getIcon('PAYMENT_SENT')).toBe('💸');
    expect(service.getIcon('PAYMENT_RECEIVED')).toBe('💰');
    expect(service.getIcon('LOGIN')).toBe('🔑');
    expect(service.getIcon('PIN_CHANGED')).toBe('🔒');
    expect(service.getIcon('DISPUTE_OPENED')).toBe('🔴');
  });

  it('formats item for display', () => {
    const formatted = service.formatItem({
      id: 'act_1', userId: 'u1', type: 'PAYMENT_SENT', title: 'Pago enviado',
      detail: '$5.000', amount: 5000, relatedId: null, ipAddress: null,
      timestamp: '2026-04-10T12:00:00.000Z',
    });
    expect(formatted).toContain('💸');
    expect(formatted).toContain('Pago enviado');
    expect(formatted).toContain('$5.000');
  });
});
