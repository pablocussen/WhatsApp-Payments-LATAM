/**
 * Unit tests for jwt.middleware.ts.
 * Covers generateToken, verifyToken, requireAuth, and requireKycLevel.
 */

jest.mock('../../src/config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
    JWT_EXPIRATION: '30m',
  },
}));

import jwt from 'jsonwebtoken';
import type { Response, NextFunction } from 'express';
import {
  generateToken,
  verifyToken,
  requireAuth,
  requireKycLevel,
} from '../../src/middleware/jwt.middleware';
import type { AuthenticatedRequest } from '../../src/middleware/jwt.middleware';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';

// ─── Test Helpers ────────────────────────────────────────

const mockRes = () => {
  const res = {} as Record<string, jest.Mock>;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as unknown as Response;
};

// ─── Token Operations ────────────────────────────────────

describe('generateToken + verifyToken', () => {
  const payload = { userId: 'user-123', waId: '56912345678', kycLevel: 'BASIC' };

  it('generateToken creates a valid 3-part JWT', () => {
    const token = generateToken(payload);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('verifyToken returns the original payload fields', () => {
    const token = generateToken(payload);
    const decoded = verifyToken(token);
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.waId).toBe(payload.waId);
    expect(decoded.kycLevel).toBe(payload.kycLevel);
  });

  it('verifyToken throws on a tampered/invalid token', () => {
    expect(() => verifyToken('invalid.token.string')).toThrow();
  });

  it('verifyToken throws TokenExpiredError on expired token', () => {
    const expired = jwt.sign(payload, JWT_SECRET, {
      expiresIn: -1,
      issuer: 'whatpay',
      audience: 'whatpay-api',
    });
    expect(() => verifyToken(expired)).toThrow(jwt.TokenExpiredError);
  });
});

// ─── requireAuth ─────────────────────────────────────────

describe('requireAuth middleware', () => {
  const next = jest.fn() as unknown as NextFunction;

  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when Authorization header is absent', () => {
    const req = { headers: {} } as AuthenticatedRequest;
    const res = mockRes();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when header is not Bearer scheme', () => {
    const req = { headers: { authorization: 'Basic abc123' } } as AuthenticatedRequest;
    const res = mockRes();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 with "inválido" for a tampered token', () => {
    const req = {
      headers: { authorization: 'Bearer invalid.tok.here' },
    } as AuthenticatedRequest;
    const res = mockRes();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/inválido/i) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 with "expirada" for an expired token', () => {
    const expired = jwt.sign({ userId: 'u1', waId: 'w1', kycLevel: 'BASIC' }, JWT_SECRET, {
      expiresIn: -1,
      issuer: 'whatpay',
      audience: 'whatpay-api',
    });
    const req = {
      headers: { authorization: `Bearer ${expired}` },
    } as AuthenticatedRequest;
    const res = mockRes();
    requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/expirada/i) }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() and attaches user payload for a valid token', () => {
    const payload = { userId: 'user-123', waId: '56912345678', kycLevel: 'INTERMEDIATE' };
    const token = generateToken(payload);
    const req = {
      headers: { authorization: `Bearer ${token}` },
    } as AuthenticatedRequest;
    const res = mockRes();
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user?.userId).toBe('user-123');
    expect(req.user?.kycLevel).toBe('INTERMEDIATE');
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ─── requireKycLevel ─────────────────────────────────────

describe('requireKycLevel middleware factory', () => {
  const next = jest.fn() as unknown as NextFunction;

  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when req.user is not attached', () => {
    const guard = requireKycLevel('BASIC');
    const req = {} as AuthenticatedRequest;
    const res = mockRes();
    guard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when user level is below the required level', () => {
    const guard = requireKycLevel('INTERMEDIATE');
    const req = {
      user: { userId: 'u1', waId: 'w1', kycLevel: 'BASIC' },
    } as AuthenticatedRequest;
    const res = mockRes();
    guard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ action: 'upgrade_kyc' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when user level exactly meets the requirement', () => {
    const guard = requireKycLevel('INTERMEDIATE');
    const req = {
      user: { userId: 'u1', waId: 'w1', kycLevel: 'INTERMEDIATE' },
    } as AuthenticatedRequest;
    const res = mockRes();
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() when user level exceeds the requirement', () => {
    const guard = requireKycLevel('BASIC');
    const req = {
      user: { userId: 'u1', waId: 'w1', kycLevel: 'FULL' },
    } as AuthenticatedRequest;
    const res = mockRes();
    guard(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('treats unknown kycLevel as 0 (lowest) and blocks INTERMEDIATE guard', () => {
    const guard = requireKycLevel('INTERMEDIATE');
    const req = {
      user: { userId: 'u1', waId: 'w1', kycLevel: 'UNKNOWN_LEVEL' },
    } as AuthenticatedRequest;
    const res = mockRes();
    guard(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
