const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserDeviceManagerService } from '../../src/services/user-device-manager.service';

describe('UserDeviceManagerService', () => {
  let s: UserDeviceManagerService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserDeviceManagerService(); mockRedisGet.mockResolvedValue(null); });

  it('adds device', async () => { const d = await s.addDevice({ userId: 'u1', name: 'iPhone', type: 'PHONE', os: 'iOS', browser: 'Safari', ipAddress: '1.2.3.4' }); expect(d.id).toMatch(/^dev_/); expect(d.trusted).toBe(false); });
  it('returns empty for new user', async () => { expect(await s.getDevices('u1')).toEqual([]); });
  it('trusts device', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'dev_1', trusted: false }]));
    expect(await s.trustDevice('u1', 'dev_1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].trusted).toBe(true);
  });
  it('removes device', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'dev_1' }, { id: 'dev_2' }]));
    expect(await s.removeDevice('u1', 'dev_1')).toBe(true);
  });
  it('removes all devices', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'dev_1' }, { id: 'dev_2' }]));
    expect(await s.removeAllDevices('u1')).toBe(2);
  });
  it('returns false for non-existent trust', async () => { expect(await s.trustDevice('u1', 'nope')).toBe(false); });
});
