/**
 * Idempotency middleware — prevents double-processing of payments.
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

import { idempotency } from '../../src/middleware/idempotency.middleware';
import { Request, Response } from 'express';

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function mockRes() {
  const res: Record<string, unknown> = {
    _status: 200,
    _body: null as unknown,
    _headers: {} as Record<string, string>,
    statusCode: 200,
    status(code: number) { res._status = code; res.statusCode = code; return res; },
    json(body: unknown) { res._body = body; return res; },
    setHeader(key: string, val: string) { (res._headers as Record<string, string>)[key] = val; },
  };
  return res as unknown as Response & { _status: number; _body: unknown; _headers: Record<string, string> };
}

describe('idempotency middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
  });

  it('passes through when no Idempotency-Key header', async () => {
    const mw = idempotency();
    const next = jest.fn();
    await mw(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(mockRedisGet).not.toHaveBeenCalled();
  });

  it('checks Redis for existing key', async () => {
    const mw = idempotency();
    const next = jest.fn();
    await mw(mockReq({ 'idempotency-key': 'test-key-12345' }), mockRes(), next);
    expect(mockRedisGet).toHaveBeenCalledWith('idem:test-key-12345');
    expect(next).toHaveBeenCalled();
  });

  it('returns cached response on duplicate key', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      statusCode: 201,
      body: { success: true, reference: '#WP-2026-CACHED' },
    }));

    const mw = idempotency();
    const res = mockRes();
    const next = jest.fn();

    await mw(mockReq({ 'idempotency-key': 'duplicate-key123' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(201);
    expect((res._body as { reference: string }).reference).toBe('#WP-2026-CACHED');
    expect(res._headers['X-Idempotency-Replayed']).toBe('true');
  });

  it('caches response after first processing', async () => {
    const mw = idempotency();
    const res = mockRes();
    const next = jest.fn();

    await mw(mockReq({ 'idempotency-key': 'new-key-12345678' }), res, next);

    expect(next).toHaveBeenCalled();

    // Simulate the route handler calling res.json
    res.statusCode = 201;
    res.json({ success: true, transactionId: 'tx-new' });

    // Should have cached the response
    expect(mockRedisSet).toHaveBeenCalledWith(
      'idem:new-key-12345678',
      expect.stringContaining('tx-new'),
      { EX: 24 * 60 * 60 },
    );
  });

  it('rejects key shorter than 10 chars', async () => {
    const mw = idempotency();
    const res = mockRes();
    const next = jest.fn();

    await mw(mockReq({ 'idempotency-key': 'short' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toContain('10');
  });

  it('rejects key longer than 64 chars', async () => {
    const mw = idempotency();
    const res = mockRes();
    const next = jest.fn();

    await mw(mockReq({ 'idempotency-key': 'a'.repeat(65) }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
  });

  it('fails open when Redis errors', async () => {
    mockRedisGet.mockRejectedValue(new Error('Redis down'));

    const mw = idempotency();
    const next = jest.fn();

    await mw(mockReq({ 'idempotency-key': 'key-redis-error' }), mockRes(), next);

    expect(next).toHaveBeenCalled();
  });
});
