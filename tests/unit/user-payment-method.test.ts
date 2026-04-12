const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserPaymentMethodService } from '../../src/services/user-payment-method.service';

describe('UserPaymentMethodService', () => {
  let s: UserPaymentMethodService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserPaymentMethodService(); mockRedisGet.mockResolvedValue(null); });

  it('adds first method as default', async () => {
    const m = await s.addMethod({ userId: 'u1', type: 'WALLET', alias: 'Mi billetera' });
    expect(m.id).toMatch(/^pm_/);
    expect(m.isDefault).toBe(true);
  });
  it('second method not default', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'pm_1', isDefault: true }]));
    const m = await s.addMethod({ userId: 'u1', type: 'BANK_ACCOUNT', alias: 'BCI', bankName: 'BCI', last4: '1234' });
    expect(m.isDefault).toBe(false);
  });
  it('rejects over 5', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ id: 'pm_' + i }))));
    await expect(s.addMethod({ userId: 'u1', type: 'WALLET', alias: 'X' })).rejects.toThrow('5');
  });
  it('rejects long alias', async () => {
    await expect(s.addMethod({ userId: 'u1', type: 'WALLET', alias: 'x'.repeat(51) })).rejects.toThrow('50');
  });
  it('returns default', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'pm_1', isDefault: false, active: true },
      { id: 'pm_2', isDefault: true, active: true },
    ]));
    const d = await s.getDefault('u1');
    expect(d?.id).toBe('pm_2');
  });
  it('sets new default', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'pm_1', isDefault: true },
      { id: 'pm_2', isDefault: false },
    ]));
    expect(await s.setDefault('u1', 'pm_2')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].isDefault).toBe(false);
    expect(saved[1].isDefault).toBe(true);
  });
  it('removes and reassigns default', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'pm_1', isDefault: true },
      { id: 'pm_2', isDefault: false },
    ]));
    expect(await s.removeMethod('u1', 'pm_1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].isDefault).toBe(true);
  });
});
