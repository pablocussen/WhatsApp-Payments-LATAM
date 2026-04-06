/**
 * API version middleware tests.
 */

import { apiVersionHeaders, checkApiVersion, API_VERSION } from '../../src/middleware/api-version.middleware';
import { Request, Response } from 'express';

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function mockRes() {
  const h: Record<string, string> = {};
  return {
    _headers: h,
    setHeader(k: string, v: string) { h[k] = v; },
  } as unknown as Response & { _headers: Record<string, string> };
}

describe('apiVersionHeaders', () => {
  it('sets X-API-Version header', () => {
    const res = mockRes();
    const next = jest.fn();
    apiVersionHeaders(mockReq(), res, next);
    expect(res._headers['X-API-Version']).toBe(API_VERSION);
    expect(next).toHaveBeenCalled();
  });

  it('sets X-Min-Supported-Version header', () => {
    const res = mockRes();
    apiVersionHeaders(mockReq(), res, jest.fn());
    expect(res._headers['X-Min-Supported-Version']).toBeDefined();
  });

  it('sets X-Powered-By to WhatPay', () => {
    const res = mockRes();
    apiVersionHeaders(mockReq(), res, jest.fn());
    expect(res._headers['X-Powered-By']).toBe('WhatPay');
  });
});

describe('checkApiVersion', () => {
  it('passes through when no version header', () => {
    const res = mockRes();
    const next = jest.fn();
    checkApiVersion(mockReq(), res, next);
    expect(next).toHaveBeenCalled();
    expect(res._headers['X-API-Version-Warning']).toBeUndefined();
  });

  it('passes through for matching version', () => {
    const res = mockRes();
    const next = jest.fn();
    checkApiVersion(mockReq({ 'x-api-version': '1.0.0' }), res, next);
    expect(next).toHaveBeenCalled();
    expect(res._headers['X-API-Version-Warning']).toBeUndefined();
  });

  it('adds warning for higher major version', () => {
    const res = mockRes();
    const next = jest.fn();
    checkApiVersion(mockReq({ 'x-api-version': '2.0.0' }), res, next);
    expect(next).toHaveBeenCalled();
    expect(res._headers['X-API-Version-Warning']).toContain('v2.0.0');
  });

  it('no warning for lower version', () => {
    const res = mockRes();
    const next = jest.fn();
    checkApiVersion(mockReq({ 'x-api-version': '0.9.0' }), res, next);
    expect(next).toHaveBeenCalled();
    expect(res._headers['X-API-Version-Warning']).toBeUndefined();
  });
});

describe('API_VERSION', () => {
  it('is a valid semver string', () => {
    expect(API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
