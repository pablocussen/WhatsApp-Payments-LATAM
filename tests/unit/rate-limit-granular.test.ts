/**
 * Granular rate limiting — per-action rate limits with Redis.
 */

const mockMultiIncr = jest.fn().mockReturnThis();
const mockMultiExpire = jest.fn().mockReturnThis();
const mockMultiExec = jest.fn().mockResolvedValue([1, true]);

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    multi: jest.fn().mockReturnValue({
      incr: mockMultiIncr,
      expire: mockMultiExpire,
      exec: mockMultiExec,
    }),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { rateLimitAction, RATE_LIMITS } from '../../src/middleware/auth.middleware';
import { Request, Response } from 'express';

function mockReq(ip = '127.0.0.1'): Request {
  return { ip } as unknown as Request;
}

function mockRes(): Response {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
  };
  return res as unknown as Response;
}

describe('rateLimitAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMultiExec.mockResolvedValue([1, true]); // count=1, below limit
  });

  // ── Config ───────────────────────────────────────

  it('has rate limits for all critical actions', () => {
    const requiredActions = [
      'auth:register', 'auth:login', 'payment:create', 'payment:refund',
      'topup:create', 'waitlist:join', 'kyc:upload', 'dispute:create',
      'qr:generate', 'split:create', 'transfer:create', 'request:create',
      'link:create', 'admin:read', 'admin:write', 'public:read',
    ];

    for (const action of requiredActions) {
      expect(RATE_LIMITS[action]).toBeDefined();
      expect(RATE_LIMITS[action].maxRequests).toBeGreaterThan(0);
      expect(RATE_LIMITS[action].windowSeconds).toBeGreaterThan(0);
    }
  });

  it('auth:register is most restrictive (3/hour)', () => {
    expect(RATE_LIMITS['auth:register'].maxRequests).toBe(3);
    expect(RATE_LIMITS['auth:register'].windowSeconds).toBe(3600);
  });

  it('auth:login allows 5/min', () => {
    expect(RATE_LIMITS['auth:login'].maxRequests).toBe(5);
    expect(RATE_LIMITS['auth:login'].windowSeconds).toBe(60);
  });

  it('payment:create allows 10/min', () => {
    expect(RATE_LIMITS['payment:create'].maxRequests).toBe(10);
    expect(RATE_LIMITS['payment:create'].windowSeconds).toBe(60);
  });

  // ── Middleware behavior ────────────────────────────

  it('allows request under limit', async () => {
    mockMultiExec.mockResolvedValue([3, true]); // count=3
    const middleware = rateLimitAction('payment:create');
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 7);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Action', 'payment:create');
  });

  it('blocks request over limit with 429', async () => {
    mockMultiExec.mockResolvedValue([11, true]); // over limit (10)
    const middleware = rateLimitAction('payment:create');
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('Demasiadas solicitudes'),
        action: 'payment:create',
        retryAfterSeconds: 60,
      }),
    );
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 60);
  });

  it('uses composite key with action and IP', async () => {
    const middleware = rateLimitAction('auth:login');
    const req = mockReq('10.0.0.1');
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(mockMultiIncr).toHaveBeenCalledWith('rl:auth:login:10.0.0.1');
    expect(mockMultiExpire).toHaveBeenCalledWith('rl:auth:login:10.0.0.1', 60);
  });

  it('falls through for unknown action', async () => {
    const middleware = rateLimitAction('nonexistent:action');
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('X-RateLimit-Remaining is 0 at exact limit', async () => {
    mockMultiExec.mockResolvedValue([10, true]); // exactly at limit
    const middleware = rateLimitAction('payment:create');
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled(); // still allowed at exact limit
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
  });

  it('different actions have independent counters', async () => {
    const payMw = rateLimitAction('payment:create');
    const loginMw = rateLimitAction('auth:login');
    const req = mockReq('10.0.0.1');

    await payMw(req, mockRes(), jest.fn());
    await loginMw(req, mockRes(), jest.fn());

    // Should use different keys
    expect(mockMultiIncr).toHaveBeenCalledWith('rl:payment:create:10.0.0.1');
    expect(mockMultiIncr).toHaveBeenCalledWith('rl:auth:login:10.0.0.1');
  });
});
