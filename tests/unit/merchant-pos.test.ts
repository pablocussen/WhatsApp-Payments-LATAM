const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantPOSService } from '../../src/services/merchant-pos.service';

describe('MerchantPOSService', () => {
  let s: MerchantPOSService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantPOSService(); mockRedisGet.mockResolvedValue(null); });

  it('creates terminal', async () => { const t = await s.createTerminal('m1', 'Caja 1', 'Entrada'); expect(t.id).toMatch(/^pos_/); expect(t.active).toBe(true); });
  it('rejects over 10', async () => { mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ id: `pos_${i}` })))); await expect(s.createTerminal('m1', 'X', 'Y')).rejects.toThrow('10'); });
  it('records transaction', async () => { mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'pos_1', active: true, totalTransactions: 5, totalVolume: 50000 }])); expect(await s.recordTransaction('m1', 'pos_1', 10000)).toBe(true); const saved = JSON.parse(mockRedisSet.mock.calls[0][1]); expect(saved[0].totalTransactions).toBe(6); });
  it('rejects inactive terminal', async () => { mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'pos_1', active: false }])); expect(await s.recordTransaction('m1', 'pos_1', 5000)).toBe(false); });
  it('deactivates terminal', async () => { mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'pos_1', active: true }])); expect(await s.deactivateTerminal('m1', 'pos_1')).toBe(true); });
  it('formats summary', () => { const f = s.getTerminalSummary({ id: 'pos_1', merchantId: 'm1', name: 'Caja 1', location: 'Entrada', active: true, totalTransactions: 50, totalVolume: 500000, lastTransactionAt: null, createdAt: '' }); expect(f).toContain('Caja 1'); expect(f).toContain('$500.000'); });
});
