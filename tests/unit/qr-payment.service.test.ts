/**
 * Tests for qr-payment.service.ts
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisDel = jest.fn().mockResolvedValue(1);

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { qrPayment, type QrCode } from '../../src/services/qr-payment.service';

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue('OK');
  mockRedisDel.mockResolvedValue(1);
});

describe('generateQr', () => {
  it('creates a static QR code', async () => {
    const qr = await qrPayment.generateQr({
      createdBy: 'user-1',
      type: 'static',
      amount: 5000,
      description: 'Café',
    });
    expect(qr.id).toMatch(/^qr_/);
    expect(qr.reference).toHaveLength(8);
    expect(qr.type).toBe('static');
    expect(qr.amount).toBe(5000);
    expect(qr.status).toBe('active');
    expect(qr.expiresAt).toBeNull();
  });

  it('creates a dynamic QR with expiry', async () => {
    const qr = await qrPayment.generateQr({
      createdBy: 'user-1',
      type: 'dynamic',
      amount: 10000,
      expiresInMinutes: 15,
    });
    expect(qr.type).toBe('dynamic');
    expect(qr.expiresAt).not.toBeNull();
    const exp = new Date(qr.expiresAt!);
    expect(exp.getTime()).toBeGreaterThan(Date.now());
  });

  it('creates QR without amount (payer chooses)', async () => {
    const qr = await qrPayment.generateQr({ createdBy: 'user-1', type: 'static' });
    expect(qr.amount).toBeNull();
  });

  it('throws for amount < 100', async () => {
    await expect(qrPayment.generateQr({
      createdBy: 'user-1', type: 'static', amount: 50,
    })).rejects.toThrow('Monto mínimo');
  });

  it('throws for amount > 50M', async () => {
    await expect(qrPayment.generateQr({
      createdBy: 'user-1', type: 'static', amount: 60_000_000,
    })).rejects.toThrow('Monto máximo');
  });
});

describe('resolveQr', () => {
  it('returns QR by reference', async () => {
    const sampleQr: QrCode = {
      id: 'qr_test1', type: 'static', merchantId: null, createdBy: 'user-1',
      amount: 5000, description: null, reference: 'ABC12345', status: 'active',
      scannedBy: null, transactionRef: null, expiresAt: null,
      createdAt: new Date().toISOString(), usedAt: null,
    };
    mockRedisGet.mockImplementation((key: string) => {
      if (key.includes('ref:')) return Promise.resolve('qr_test1');
      if (key.includes('qr:qr_test1')) return Promise.resolve(JSON.stringify(sampleQr));
      return Promise.resolve(null);
    });

    const result = await qrPayment.resolveQr('ABC12345');
    expect(result).not.toBeNull();
    expect(result!.amount).toBe(5000);
  });

  it('returns null for unknown reference', async () => {
    const result = await qrPayment.resolveQr('UNKNOWN');
    expect(result).toBeNull();
  });

  it('marks expired QR', async () => {
    const expired: QrCode = {
      id: 'qr_exp', type: 'dynamic', merchantId: null, createdBy: 'user-1',
      amount: 1000, description: null, reference: 'EXP11111', status: 'active',
      scannedBy: null, transactionRef: null,
      expiresAt: new Date(Date.now() - 60000).toISOString(),
      createdAt: new Date().toISOString(), usedAt: null,
    };
    mockRedisGet.mockImplementation((key: string) => {
      if (key.includes('ref:')) return Promise.resolve('qr_exp');
      if (key.includes('qr:qr_exp')) return Promise.resolve(JSON.stringify(expired));
      return Promise.resolve(null);
    });

    const result = await qrPayment.resolveQr('EXP11111');
    expect(result!.status).toBe('expired');
  });
});

describe('markUsed', () => {
  const activeQr: QrCode = {
    id: 'qr_active', type: 'dynamic', merchantId: null, createdBy: 'user-1',
    amount: 5000, description: null, reference: 'ACT11111', status: 'active',
    scannedBy: null, transactionRef: null, expiresAt: null,
    createdAt: new Date().toISOString(), usedAt: null,
  };

  it('marks dynamic QR as used', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(activeQr));
    const result = await qrPayment.markUsed('qr_active', 'user-2', '#WP-REF');
    expect(result!.status).toBe('used');
    expect(result!.scannedBy).toBe('user-2');
    expect(result!.transactionRef).toBe('#WP-REF');
  });

  it('throws for self-scan', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(activeQr));
    await expect(qrPayment.markUsed('qr_active', 'user-1', '#WP-REF'))
      .rejects.toThrow('propio');
  });

  it('throws for non-active QR', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ ...activeQr, status: 'used' }));
    await expect(qrPayment.markUsed('qr_active', 'user-2', '#WP-REF'))
      .rejects.toThrow('activo');
  });
});

describe('cancelQr', () => {
  it('cancels own QR', async () => {
    const qr: QrCode = {
      id: 'qr_cancel', type: 'static', merchantId: null, createdBy: 'user-1',
      amount: null, description: null, reference: 'CAN11111', status: 'active',
      scannedBy: null, transactionRef: null, expiresAt: null,
      createdAt: new Date().toISOString(), usedAt: null,
    };
    mockRedisGet.mockResolvedValue(JSON.stringify(qr));
    const result = await qrPayment.cancelQr('qr_cancel', 'user-1');
    expect(result).toBe(true);
  });

  it('returns false for non-owner', async () => {
    const qr: QrCode = {
      id: 'qr_other', type: 'static', merchantId: null, createdBy: 'user-1',
      amount: null, description: null, reference: 'OTH11111', status: 'active',
      scannedBy: null, transactionRef: null, expiresAt: null,
      createdAt: new Date().toISOString(), usedAt: null,
    };
    mockRedisGet.mockResolvedValue(JSON.stringify(qr));
    const result = await qrPayment.cancelQr('qr_other', 'user-2');
    expect(result).toBe(false);
  });
});

describe('getQrPayload', () => {
  it('generates scan URL', () => {
    const url = qrPayment.getQrPayload('ABC12345', 'https://whatpay.cl');
    expect(url).toBe('https://whatpay.cl/pay/ABC12345');
  });
});
