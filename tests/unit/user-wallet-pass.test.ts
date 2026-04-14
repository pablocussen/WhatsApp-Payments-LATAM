const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserWalletPassService } from '../../src/services/user-wallet-pass.service';

describe('UserWalletPassService', () => {
  let s: UserWalletPassService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserWalletPassService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    userId: 'u1',
    type: 'PAYMENT_CARD' as const,
    title: 'WhatPay Card',
    subtitle: 'Pablo Cussen',
  };

  it('creates pass with defaults', async () => {
    const p = await s.create(base);
    expect(p.status).toBe('ACTIVE');
    expect(p.backgroundColor).toBe('#06b6d4');
    expect(p.barcodeFormat).toBe('QR');
    expect(p.barcode).toHaveLength(32);
  });

  it('rejects invalid color', async () => {
    await expect(s.create({ ...base, backgroundColor: 'red' })).rejects.toThrow('#RRGGBB');
  });

  it('rejects long title', async () => {
    await expect(s.create({ ...base, title: 'x'.repeat(51) })).rejects.toThrow('50');
  });

  it('rejects invalid expires date', async () => {
    await expect(s.create({ ...base, expiresAt: 'bad' })).rejects.toThrow('invalida');
  });

  it('rejects over 50 active passes', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 50 }, (_, i) => ({
      id: 'other' + i, status: 'ACTIVE',
    }))));
    await expect(s.create(base)).rejects.toThrow('50');
  });

  it('records download', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'p1', status: 'ACTIVE', downloadCount: 5 }]));
    const p = await s.recordDownload('u1', 'p1');
    expect(p?.downloadCount).toBe(6);
  });

  it('rejects download on revoked', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'p1', status: 'REVOKED' }]));
    await expect(s.recordDownload('u1', 'p1')).rejects.toThrow('no esta activo');
  });

  it('revokes pass', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'p1', status: 'ACTIVE' }]));
    const p = await s.revoke('u1', 'p1');
    expect(p?.status).toBe('REVOKED');
  });

  it('expires old passes in bulk', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'ACTIVE', expiresAt: past },
      { status: 'ACTIVE', expiresAt: future },
      { status: 'ACTIVE', expiresAt: past },
      { status: 'ACTIVE' },
    ]));
    expect(await s.expireOld('u1')).toBe(2);
  });

  it('finds by barcode', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'p1', barcode: 'ABC123' },
      { id: 'p2', barcode: 'XYZ789' },
    ]));
    const p = await s.findByBarcode('u1', 'XYZ789');
    expect(p?.id).toBe('p2');
  });

  it('filters by type only active', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { type: 'PAYMENT_CARD', status: 'ACTIVE' },
      { type: 'MEMBERSHIP', status: 'ACTIVE' },
      { type: 'PAYMENT_CARD', status: 'REVOKED' },
    ]));
    const cards = await s.getByType('u1', 'PAYMENT_CARD');
    expect(cards).toHaveLength(1);
  });

  it('computes stats with byType breakdown', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { type: 'PAYMENT_CARD', status: 'ACTIVE', downloadCount: 10 },
      { type: 'MEMBERSHIP', status: 'ACTIVE', downloadCount: 5 },
      { type: 'COUPON', status: 'EXPIRED', downloadCount: 2 },
      { type: 'PAYMENT_CARD', status: 'REVOKED', downloadCount: 1 },
    ]));
    const stats = await s.getStats('u1');
    expect(stats.active).toBe(2);
    expect(stats.expired).toBe(1);
    expect(stats.revoked).toBe(1);
    expect(stats.totalDownloads).toBe(18);
    expect(stats.byType.PAYMENT_CARD).toBe(1);
    expect(stats.byType.MEMBERSHIP).toBe(1);
  });
});
