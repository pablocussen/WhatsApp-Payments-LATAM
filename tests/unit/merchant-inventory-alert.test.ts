const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantInventoryAlertService } from '../../src/services/merchant-inventory-alert.service';

describe('MerchantInventoryAlertService', () => {
  let s: MerchantInventoryAlertService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantInventoryAlertService(); mockRedisGet.mockResolvedValue(null); });

  it('sets alert', async () => { const a = await s.setAlert('m1', 'p1', 'Cafe', 5); expect(a.id).toMatch(/^ia_/); expect(a.threshold).toBe(5); expect(a.triggered).toBe(false); });
  it('rejects threshold 0', async () => { await expect(s.setAlert('m1', 'p1', 'X', 0)).rejects.toThrow('al menos 1'); });
  it('triggers when stock low', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'ia_1', threshold: 5, triggered: false }));
    const r = await s.checkStock('m1', 'p1', 3);
    expect(r.shouldAlert).toBe(true); expect(r.alert?.triggered).toBe(true);
  });
  it('does not re-trigger', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'ia_1', threshold: 5, triggered: true }));
    const r = await s.checkStock('m1', 'p1', 2);
    expect(r.shouldAlert).toBe(false);
  });
  it('does not trigger above threshold', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'ia_1', threshold: 5, triggered: false }));
    const r = await s.checkStock('m1', 'p1', 10);
    expect(r.shouldAlert).toBe(false);
  });
  it('resets alert', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'ia_1', triggered: true, notifiedAt: '2026-04-10' }));
    expect(await s.resetAlert('m1', 'p1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.triggered).toBe(false);
  });
  it('returns null for no alert', async () => { expect(await s.getAlert('m1', 'p1')).toBeNull(); });
});
