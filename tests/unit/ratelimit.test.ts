/**
 * Unit tests for the Redis-backed rate limiting middleware.
 * The database module is mocked so no real Redis connection is required.
 */

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn(),
}));

import { rateLimit } from '../../src/middleware/auth.middleware';
import { getRedis } from '../../src/config/database';

const mockGetRedis = getRedis as jest.Mock;

// ─── Helpers ─────────────────────────────────────────────

function makeRedis(count: number) {
  return {
    multi: jest.fn().mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([count, 1]),
    }),
  };
}

function makeReq(ip?: string) {
  return { ip } as any;
}

function makeRes() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as any;
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

// ─── Tests ───────────────────────────────────────────────

describe('Rate Limiting Middleware', () => {
  beforeEach(() => {
    mockGetRedis.mockReset();
  });

  it('allows requests that are under the limit', async () => {
    mockGetRedis.mockReturnValue(makeRedis(1));
    const next = jest.fn();
    await rateLimit(10, 60_000)(makeReq('1.2.3.4'), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('allows exactly the max number of requests', async () => {
    mockGetRedis.mockReturnValue(makeRedis(10));
    const next = jest.fn();
    await rateLimit(10, 60_000)(makeReq('1.2.3.4'), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('blocks requests exceeding the limit with HTTP 429', async () => {
    mockGetRedis.mockReturnValue(makeRedis(11));
    const res = makeRes();
    const next = jest.fn();
    await rateLimit(10, 60_000)(makeReq('1.2.3.4'), res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    expect(next).not.toHaveBeenCalled();
  });

  it('fails open (allows request) when getRedis throws', async () => {
    mockGetRedis.mockImplementation(() => {
      throw new Error('connection refused');
    });
    const next = jest.fn();
    await rateLimit(10, 60_000)(makeReq('1.2.3.4'), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('fails open when Redis exec rejects', async () => {
    const badRedis = {
      multi: jest.fn().mockReturnValue({
        incr: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
      }),
    };
    mockGetRedis.mockReturnValue(badRedis);
    const next = jest.fn();
    await rateLimit(10, 60_000)(makeReq('1.2.3.4'), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('uses "unknown" when req.ip is missing', async () => {
    mockGetRedis.mockReturnValue(makeRedis(1));
    const next = jest.fn();
    // req without ip field
    await rateLimit(10, 60_000)({} as any, makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('uses a 1-minute window by default (60s)', async () => {
    // Verify the key is built with the IP
    let capturedMulti: jest.Mock | null = null;
    const redisSpy = {
      multi: jest.fn().mockImplementation(() => {
        capturedMulti = redisSpy.multi;
        return {
          incr: jest.fn().mockReturnThis(),
          expire: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([1, 1]),
        };
      }),
    };
    mockGetRedis.mockReturnValue(redisSpy);
    const next = jest.fn();
    await rateLimit(5, 60_000)(makeReq('9.9.9.9'), makeRes(), next);
    expect(redisSpy.multi).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
