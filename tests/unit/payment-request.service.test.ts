/**
 * PaymentRequestService unit tests
 * Tests: createRequest, payRequest, declineRequest, cancelRequest, getSentRequests, getReceivedRequests
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: jest.fn(),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { paymentRequest, type PaymentRequest } from '../../src/services/payment-request.service';

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
});

const sample: PaymentRequest = {
  id: 'preq_test001',
  requesterId: 'user-1',
  requesterName: 'Pablo',
  requesterPhone: '56912345678',
  targetPhone: '56987654321',
  targetName: 'María',
  amount: 15000,
  description: 'Almuerzo',
  status: 'pending',
  transactionRef: null,
  expiresAt: new Date(Date.now() + 72 * 3600000).toISOString(),
  createdAt: new Date().toISOString(),
  respondedAt: null,
};

describe('PaymentRequestService', () => {
  describe('createRequest', () => {
    it('creates request with preq_ id, status pending, expiresAt in future', async () => {
      const result = await paymentRequest.createRequest({
        requesterId: 'user-1',
        requesterName: 'Pablo',
        requesterPhone: '56912345678',
        targetPhone: '56987654321',
        targetName: 'María',
        amount: 15000,
        description: 'Almuerzo',
      });

      expect(result.id).toMatch(/^preq_/);
      expect(result.status).toBe('pending');
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(result.amount).toBe(15000);
      expect(result.transactionRef).toBeNull();
      expect(mockRedisSet).toHaveBeenCalled();
    });

    it('throws for amount < 100', async () => {
      await expect(
        paymentRequest.createRequest({
          requesterId: 'user-1',
          requesterName: 'Pablo',
          requesterPhone: '56912345678',
          targetPhone: '56987654321',
          amount: 50,
          description: 'Café',
        }),
      ).rejects.toThrow();
    });

    it('throws for self-request (same phone)', async () => {
      await expect(
        paymentRequest.createRequest({
          requesterId: 'user-1',
          requesterName: 'Pablo',
          requesterPhone: '56912345678',
          targetPhone: '56912345678',
          amount: 5000,
          description: 'Self',
        }),
      ).rejects.toThrow('ti mismo');
    });
  });

  describe('payRequest', () => {
    it('marks as paid with transactionRef and respondedAt', async () => {
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(sample));

      const result = await paymentRequest.payRequest('preq_test001', 'TX_REF_001');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('paid');
      expect(result!.transactionRef).toBe('TX_REF_001');
      expect(result!.respondedAt).not.toBeNull();
      expect(mockRedisSet).toHaveBeenCalled();
    });

    it('throws for non-pending status', async () => {
      const paid: PaymentRequest = { ...sample, status: 'paid', respondedAt: new Date().toISOString() };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(paid));

      await expect(
        paymentRequest.payRequest('preq_test001', 'TX_DUP'),
      ).rejects.toThrow('pendiente');
    });

    it('throws for expired request', async () => {
      const expired: PaymentRequest = {
        ...sample,
        expiresAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour in the past
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(expired));

      await expect(
        paymentRequest.payRequest('preq_test001', 'TX_LATE'),
      ).rejects.toThrow('expirada');
    });
  });

  describe('declineRequest', () => {
    it('marks as declined', async () => {
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(sample));

      const result = await paymentRequest.declineRequest('preq_test001');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('declined');
      expect(result!.respondedAt).not.toBeNull();
    });

    it('returns null for non-pending', async () => {
      const declined: PaymentRequest = { ...sample, status: 'declined', respondedAt: new Date().toISOString() };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(declined));

      const result = await paymentRequest.declineRequest('preq_test001');

      expect(result).toBeNull();
    });
  });

  describe('cancelRequest', () => {
    it('cancels by requester', async () => {
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(sample));

      const result = await paymentRequest.cancelRequest('preq_test001', 'user-1');

      expect(result).toBe(true);
      const setCall = mockRedisSet.mock.calls[0];
      const saved: PaymentRequest = JSON.parse(setCall[1]);
      expect(saved.status).toBe('cancelled');
    });

    it('returns false for non-requester', async () => {
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(sample));

      const result = await paymentRequest.cancelRequest('preq_test001', 'user-999');

      expect(result).toBe(false);
    });
  });

  describe('getSentRequests', () => {
    it('returns list of sent requests', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'payreq:sent:user-1') {
          return Promise.resolve(JSON.stringify(['preq_test001']));
        }
        if (key === 'payreq:preq_test001') {
          return Promise.resolve(JSON.stringify(sample));
        }
        return Promise.resolve(null);
      });

      const results = await paymentRequest.getSentRequests('user-1');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('preq_test001');
    });
  });

  describe('getReceivedRequests', () => {
    it('returns list by phone', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'payreq:recv:56987654321') {
          return Promise.resolve(JSON.stringify(['preq_test001']));
        }
        if (key === 'payreq:preq_test001') {
          return Promise.resolve(JSON.stringify(sample));
        }
        return Promise.resolve(null);
      });

      const results = await paymentRequest.getReceivedRequests('56987654321');

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(1);
      expect(results[0].targetPhone).toBe('56987654321');
    });
  });
});
