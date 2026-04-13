const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserQRPayLinkService } from '../../src/services/user-qr-paylink.service';

describe('UserQRPayLinkService', () => {
  let s: UserQRPayLinkService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserQRPayLinkService(); mockRedisGet.mockResolvedValue(null); });

  it('creates QR with defaults', async () => {
    const q = await s.create({ userId: 'u1', description: 'Cafe' });
    expect(q.status).toBe('ACTIVE');
    expect(q.maxUses).toBe(1);
    expect(q.qrUrl).toContain('/pay/');
  });

  it('rejects zero amount', async () => {
    await expect(s.create({ userId: 'u1', description: 'x', amount: 0 })).rejects.toThrow('positivo');
  });

  it('rejects max uses out of range', async () => {
    await expect(s.create({ userId: 'u1', description: 'x', maxUses: 2000 })).rejects.toThrow('1 y 1000');
  });

  it('rejects over 20 active', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: 'q' + i, status: 'ACTIVE' }))));
    await expect(s.create({ userId: 'u1', description: 'x' })).rejects.toThrow('20');
  });

  it('redeems single-use QR', async () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'q1', status: 'ACTIVE', expiresAt: future, maxUses: 1, currentUses: 0,
    }]));
    const q = await s.redeem('u1', 'q1');
    expect(q?.status).toBe('USED');
  });

  it('keeps multi-use active after partial redeem', async () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'q1', status: 'ACTIVE', expiresAt: future, maxUses: 5, currentUses: 2,
    }]));
    const q = await s.redeem('u1', 'q1');
    expect(q?.status).toBe('ACTIVE');
    expect(q?.currentUses).toBe(3);
  });

  it('rejects expired redeem', async () => {
    const past = new Date(Date.now() - 3600000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'q1', status: 'ACTIVE', expiresAt: past, maxUses: 1, currentUses: 0,
    }]));
    await expect(s.redeem('u1', 'q1')).rejects.toThrow('expirado');
  });

  it('rejects redeem on used', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'q1', status: 'USED' }]));
    await expect(s.redeem('u1', 'q1')).rejects.toThrow('used');
  });

  it('cancels active QR', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'q1', status: 'ACTIVE' }]));
    const q = await s.cancel('u1', 'q1');
    expect(q?.status).toBe('CANCELLED');
  });

  it('rejects cancel on non-active', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'q1', status: 'USED' }]));
    await expect(s.cancel('u1', 'q1')).rejects.toThrow('activo');
  });

  it('expires old QRs in bulk', async () => {
    const past = new Date(Date.now() - 3600000).toISOString();
    const future = new Date(Date.now() + 3600000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'ACTIVE', expiresAt: past },
      { status: 'ACTIVE', expiresAt: future },
      { status: 'ACTIVE', expiresAt: past },
    ]));
    expect(await s.expireOld('u1')).toBe(2);
  });

  it('returns only active', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'ACTIVE' }, { status: 'USED' }, { status: 'ACTIVE' },
    ]));
    expect((await s.getActive('u1')).length).toBe(2);
  });
});
