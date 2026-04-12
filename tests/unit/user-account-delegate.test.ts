const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserAccountDelegateService } from '../../src/services/user-account-delegate.service';

describe('UserAccountDelegateService', () => {
  let s: UserAccountDelegateService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserAccountDelegateService(); mockRedisGet.mockResolvedValue(null); });

  it('adds delegate', async () => {
    const d = await s.addDelegate({
      ownerId: 'u1', delegateId: 'u2', delegateName: 'Maria',
      permissions: ['VIEW_BALANCE', 'VIEW_HISTORY'], dailyLimit: 10000,
    });
    expect(d.id).toMatch(/^del_/);
    expect(d.permissions).toHaveLength(2);
  });

  it('rejects empty permissions', async () => {
    await expect(s.addDelegate({
      ownerId: 'u1', delegateId: 'u2', delegateName: 'X',
      permissions: [], dailyLimit: 0,
    })).rejects.toThrow('al menos un permiso');
  });

  it('rejects negative limit', async () => {
    await expect(s.addDelegate({
      ownerId: 'u1', delegateId: 'u2', delegateName: 'X',
      permissions: ['VIEW_BALANCE'], dailyLimit: -1,
    })).rejects.toThrow('negativo');
  });

  it('rejects over 3 delegates', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }]));
    await expect(s.addDelegate({
      ownerId: 'u1', delegateId: 'u4', delegateName: 'X',
      permissions: ['VIEW_BALANCE'], dailyLimit: 0,
    })).rejects.toThrow('3');
  });

  it('checks valid permission', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      delegateId: 'u2', active: true, permissions: ['VIEW_BALANCE'], expiresAt: null,
    }]));
    expect(await s.hasPermission('u1', 'u2', 'VIEW_BALANCE')).toBe(true);
    expect(await s.hasPermission('u1', 'u2', 'SEND_PAYMENT')).toBe(false);
  });

  it('rejects expired delegate', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      delegateId: 'u2', active: true, permissions: ['VIEW_BALANCE'], expiresAt: '2020-01-01',
    }]));
    expect(await s.hasPermission('u1', 'u2', 'VIEW_BALANCE')).toBe(false);
  });

  it('rejects inactive delegate', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      delegateId: 'u2', active: false, permissions: ['VIEW_BALANCE'], expiresAt: null,
    }]));
    expect(await s.hasPermission('u1', 'u2', 'VIEW_BALANCE')).toBe(false);
  });

  it('revokes delegate', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', active: true }]));
    expect(await s.revokeDelegate('u1', 'd1')).toBe(true);
  });

  it('formats summary', () => {
    const f = s.formatDelegateSummary({
      delegateName: 'Maria', permissions: ['VIEW_BALANCE', 'VIEW_HISTORY'],
      dailyLimit: 50000, expiresAt: null,
    } as any);
    expect(f).toContain('Maria');
    expect(f).toContain('2 permisos');
    expect(f).toContain('$50.000');
  });
});
