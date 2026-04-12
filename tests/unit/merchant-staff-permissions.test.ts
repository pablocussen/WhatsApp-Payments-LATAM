const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantStaffPermissionsService } from '../../src/services/merchant-staff-permissions.service';

describe('MerchantStaffPermissionsService', () => {
  let s: MerchantStaffPermissionsService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantStaffPermissionsService(); mockRedisGet.mockResolvedValue(null); });

  it('grants permissions', async () => {
    const p = await s.grantPermissions({ userId: 'u1', merchantId: 'm1', permissions: ['VIEW_TRANSACTIONS', 'PROCESS_PAYMENTS'], grantedBy: 'owner' });
    expect(p.permissions).toHaveLength(2);
    expect(p.expiresAt).toBeNull();
  });

  it('rejects invalid permission', async () => {
    await expect(s.grantPermissions({ userId: 'u1', merchantId: 'm1', permissions: ['FAKE' as any], grantedBy: 'owner' }))
      .rejects.toThrow('invalido');
  });

  it('deduplicates permissions', async () => {
    const p = await s.grantPermissions({ userId: 'u1', merchantId: 'm1', permissions: ['VIEW_REPORTS', 'VIEW_REPORTS'], grantedBy: 'owner' });
    expect(p.permissions).toHaveLength(1);
  });

  it('sets expiration', async () => {
    const p = await s.grantPermissions({ userId: 'u1', merchantId: 'm1', permissions: ['VIEW_DASHBOARD'], grantedBy: 'owner', expiresInDays: 30 });
    expect(p.expiresAt).toBeDefined();
  });

  it('checks permission', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ permissions: ['VIEW_REPORTS', 'VIEW_DASHBOARD'], expiresAt: null }));
    expect(await s.hasPermission('m1', 'u1', 'VIEW_REPORTS')).toBe(true);
    mockRedisGet.mockResolvedValue(JSON.stringify({ permissions: ['VIEW_REPORTS'], expiresAt: null }));
    expect(await s.hasPermission('m1', 'u1', 'MANAGE_TEAM')).toBe(false);
  });

  it('rejects expired permissions', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ permissions: ['VIEW_REPORTS'], expiresAt: '2020-01-01' }));
    expect(await s.hasPermission('m1', 'u1', 'VIEW_REPORTS')).toBe(false);
  });

  it('returns false for no permissions', async () => {
    expect(await s.hasPermission('m1', 'u1', 'VIEW_REPORTS')).toBe(false);
  });

  it('revokes specific permission', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ permissions: ['VIEW_REPORTS', 'ACCESS_API'] }));
    expect(await s.revokePermission('m1', 'u1', 'ACCESS_API')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.permissions).toEqual(['VIEW_REPORTS']);
  });

  it('revokes all', async () => {
    expect(await s.revokeAll('m1', 'u1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.permissions).toEqual([]);
  });

  it('returns all available permissions', () => {
    expect(s.getAllPermissions()).toHaveLength(10);
  });
});
