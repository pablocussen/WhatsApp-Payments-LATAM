/**
 * Security headers middleware tests.
 */

import { securityHeaders } from '../../src/middleware/security-headers.middleware';
import { Request, Response } from 'express';

function mockRes() {
  const h: Record<string, string> = {};
  return {
    _headers: h,
    setHeader(k: string, v: string) { h[k] = v; },
    getHeader(k: string) { return h[k]; },
  } as unknown as Response & { _headers: Record<string, string> };
}

describe('securityHeaders', () => {
  it('sets X-Content-Type-Options', () => {
    const res = mockRes();
    securityHeaders({} as Request, res, jest.fn());
    expect(res._headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('sets X-Frame-Options to DENY', () => {
    const res = mockRes();
    securityHeaders({} as Request, res, jest.fn());
    expect(res._headers['X-Frame-Options']).toBe('DENY');
  });

  it('sets X-XSS-Protection', () => {
    const res = mockRes();
    securityHeaders({} as Request, res, jest.fn());
    expect(res._headers['X-XSS-Protection']).toBe('1; mode=block');
  });

  it('sets Permissions-Policy', () => {
    const res = mockRes();
    securityHeaders({} as Request, res, jest.fn());
    const policy = res._headers['Permissions-Policy'];
    expect(policy).toContain('camera=()');
    expect(policy).toContain('microphone=()');
    expect(policy).toContain('geolocation=()');
  });

  it('sets Cache-Control to no-store', () => {
    const res = mockRes();
    securityHeaders({} as Request, res, jest.fn());
    expect(res._headers['Cache-Control']).toContain('no-store');
    expect(res._headers['Pragma']).toBe('no-cache');
  });

  it('does not override existing Cache-Control', () => {
    const res = mockRes();
    res._headers['Cache-Control'] = 'public, max-age=3600';
    // Mock getHeader to return existing value
    (res as any).getHeader = (k: string) => res._headers[k];
    securityHeaders({} as Request, res, jest.fn());
    expect(res._headers['Cache-Control']).toBe('public, max-age=3600');
  });

  it('calls next()', () => {
    const next = jest.fn();
    securityHeaders({} as Request, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});
