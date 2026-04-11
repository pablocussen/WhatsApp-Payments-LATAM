/**
 * MerchantTeamService — gestión de equipo multi-usuario.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { MerchantTeamService } from '../../src/services/merchant-team.service';

describe('MerchantTeamService', () => {
  let service: MerchantTeamService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MerchantTeamService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('adds team member', async () => {
    const m = await service.addMember({
      merchantId: 'm1', userId: 'u1', name: 'Juan', phone: '+569', role: 'CASHIER',
    });
    expect(m.id).toMatch(/^tm_/);
    expect(m.role).toBe('CASHIER');
    expect(m.permissions).toEqual(['payments', 'refunds', 'customers']);
    expect(m.active).toBe(true);
  });

  it('rejects adding OWNER', async () => {
    await expect(service.addMember({
      merchantId: 'm1', userId: 'u1', name: 'X', phone: '+569', role: 'OWNER',
    })).rejects.toThrow('owner');
  });

  it('rejects duplicate user', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ userId: 'u1' }]));
    await expect(service.addMember({
      merchantId: 'm1', userId: 'u1', name: 'X', phone: '+569', role: 'VIEWER',
    })).rejects.toThrow('ya es miembro');
  });

  it('rejects over 20 members', async () => {
    const team = Array.from({ length: 20 }, (_, i) => ({ userId: `u${i}` }));
    mockRedisGet.mockResolvedValue(JSON.stringify(team));
    await expect(service.addMember({
      merchantId: 'm1', userId: 'new', name: 'X', phone: '+569', role: 'VIEWER',
    })).rejects.toThrow('20');
  });

  it('changes role', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'tm_1', role: 'CASHIER', permissions: ['payments'] },
    ]));
    const m = await service.changeRole('m1', 'tm_1', 'ADMIN');
    expect(m?.role).toBe('ADMIN');
    expect(m?.permissions).toContain('reports');
    expect(m?.permissions).toContain('team');
  });

  it('rejects changing to OWNER', async () => {
    await expect(service.changeRole('m1', 'tm_1', 'OWNER')).rejects.toThrow('owner');
  });

  it('removes member', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'tm_1', role: 'CASHIER' }, { id: 'tm_2', role: 'VIEWER' },
    ]));
    expect(await service.removeMember('m1', 'tm_1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved).toHaveLength(1);
  });

  it('rejects removing OWNER', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'tm_1', role: 'OWNER' }]));
    await expect(service.removeMember('m1', 'tm_1')).rejects.toThrow('owner');
  });

  it('deactivates member', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'tm_1', active: true }]));
    expect(await service.deactivateMember('m1', 'tm_1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].active).toBe(false);
  });

  it('checks permissions — ADMIN has payments', () => {
    expect(service.hasPermission({
      id: 'tm_1', merchantId: 'm1', userId: 'u1', name: '', phone: '',
      role: 'ADMIN', permissions: ['payments', 'refunds', 'reports', 'customers', 'products', 'team', 'settings'],
      active: true, addedAt: '', lastActiveAt: null,
    }, 'payments')).toBe(true);
  });

  it('checks permissions — VIEWER cannot do payments', () => {
    expect(service.hasPermission({
      id: 'tm_1', merchantId: 'm1', userId: 'u1', name: '', phone: '',
      role: 'VIEWER', permissions: ['reports'],
      active: true, addedAt: '', lastActiveAt: null,
    }, 'payments')).toBe(false);
  });

  it('inactive member has no permissions', () => {
    expect(service.hasPermission({
      id: 'tm_1', merchantId: 'm1', userId: 'u1', name: '', phone: '',
      role: 'ADMIN', permissions: ['*'],
      active: false, addedAt: '', lastActiveAt: null,
    }, 'payments')).toBe(false);
  });

  it('OWNER has wildcard permissions', () => {
    expect(service.hasPermission({
      id: 'tm_1', merchantId: 'm1', userId: 'u1', name: '', phone: '',
      role: 'OWNER', permissions: ['*'],
      active: true, addedAt: '', lastActiveAt: null,
    }, 'anything')).toBe(true);
  });

  it('counts active members', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { active: true }, { active: false }, { active: true },
    ]));
    expect(await service.getActiveCount('m1')).toBe(2);
  });
});
