/**
 * LinkExpiryService — notify merchants when links are about to expire.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockNotifCreate = jest.fn().mockResolvedValue({ id: 'ntf_test' });

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    lPush: jest.fn(), lTrim: jest.fn(),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../src/services/notification.service', () => ({
  notifications: { create: (...args: unknown[]) => mockNotifCreate(...args) },
}));

import { LinkExpiryService } from '../../src/services/link-expiry.service';

describe('LinkExpiryService', () => {
  let service: LinkExpiryService;

  const makeLink = (hoursFromNow: number) => ({
    id: 'link-1',
    merchantId: 'merchant-1',
    shortCode: 'ABC123',
    amount: 5000,
    description: 'Cafe',
    expiresAt: new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LinkExpiryService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('sends notification when link expires within threshold', async () => {
    const result = await service.checkAndNotify(makeLink(3), 6);
    expect(result).toBe(true);
    expect(mockNotifCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'merchant-1',
        title: expect.stringContaining('vencer'),
      }),
    );
  });

  it('does not notify if link has plenty of time', async () => {
    const result = await service.checkAndNotify(makeLink(24), 6);
    expect(result).toBe(false);
    expect(mockNotifCreate).not.toHaveBeenCalled();
  });

  it('does not notify if link already expired', async () => {
    const result = await service.checkAndNotify(makeLink(-1), 6);
    expect(result).toBe(false);
  });

  it('does not notify twice for same link', async () => {
    mockRedisGet.mockResolvedValue('1'); // already notified
    const result = await service.checkAndNotify(makeLink(3), 6);
    expect(result).toBe(false);
    expect(mockNotifCreate).not.toHaveBeenCalled();
  });

  it('marks link as notified in Redis', async () => {
    await service.checkAndNotify(makeLink(3), 6);
    expect(mockRedisSet).toHaveBeenCalledWith(
      'link-expiry:notified:link-1',
      '1',
      { EX: 48 * 60 * 60 },
    );
  });

  it('includes description in notification body', async () => {
    await service.checkAndNotify(makeLink(2), 6);
    const call = mockNotifCreate.mock.calls[0][0];
    expect(call.body).toContain('Cafe');
    expect(call.body).toContain('ABC123');
  });

  it('handles missing description gracefully', async () => {
    const link = { ...makeLink(2), description: null };
    await service.checkAndNotify(link, 6);
    const call = mockNotifCreate.mock.calls[0][0];
    expect(call.body).toContain('ABC123');
    expect(call.body).not.toContain('null');
  });

  it('uses custom threshold', async () => {
    // 10 hours remaining, threshold 12 → should notify
    const result = await service.checkAndNotify(makeLink(10), 12);
    expect(result).toBe(true);
  });
});
