import { requestId } from '../../src/middleware/request-id.middleware';
import { Request, Response, NextFunction } from 'express';

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers, ip: '127.0.0.1' } as unknown as Request;
}

function makeRes(): Response & { _headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    _headers: headers,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  } as unknown as Response & { _headers: Record<string, string> };
}

describe('requestId middleware', () => {
  it('generates an id when none is present and attaches it to req and res', () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    requestId(req, res, next);

    expect(req.headers['x-request-id']).toMatch(/^[0-9a-f]{16}$/);
    expect(res._headers['X-Request-Id']).toBe(req.headers['x-request-id']);
    expect(next).toHaveBeenCalled();
  });

  it('passes through a client-supplied X-Request-Id unchanged', () => {
    const req = makeReq({ 'x-request-id': 'client-supplied-id' });
    const res = makeRes();
    const next = jest.fn() as NextFunction;

    requestId(req, res, next);

    expect(req.headers['x-request-id']).toBe('client-supplied-id');
    expect(res._headers['X-Request-Id']).toBe('client-supplied-id');
    expect(next).toHaveBeenCalled();
  });

  it('generates a unique id for each request', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const req = makeReq();
      const res = makeRes();
      requestId(req, res, jest.fn() as NextFunction);
      ids.add(req.headers['x-request-id'] as string);
    }
    expect(ids.size).toBe(20);
  });
});
