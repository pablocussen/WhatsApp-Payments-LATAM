/**
 * Unit tests for errorHandler middleware (src/middleware/error.middleware.ts).
 * Covers AppError hierarchy, InsufficientFundsError, ZodError, and unknown errors.
 */

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

// Prevent database connection: mock wallet.service so InsufficientFundsError
// is available without triggering Prisma initialization
jest.mock('../../src/services/wallet.service', () => {
  class InsufficientFundsError extends Error {
    currentBalance: number;
    requestedAmount: number;
    constructor(current: number, requested: number) {
      super(`Saldo insuficiente.`);
      this.name = 'InsufficientFundsError';
      this.currentBalance = current;
      this.requestedAmount = requested;
    }
  }
  return { InsufficientFundsError };
});

import type { Request, Response, NextFunction } from 'express';
import {
  errorHandler,
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
} from '../../src/middleware/error.middleware';
import { InsufficientFundsError } from '../../src/services/wallet.service';
import { z } from 'zod';

// ─── Test Helpers ────────────────────────────────────────

const mockReq = (path = '/api/v1/test') => ({ path, method: 'GET' }) as unknown as Request;

const mockRes = () => {
  const res = {} as Record<string, jest.Mock>;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as unknown as Response;
};

const noop = jest.fn() as unknown as NextFunction;

// ─── AppError Hierarchy ──────────────────────────────────

describe('errorHandler — AppError hierarchy', () => {
  it('handles generic AppError with custom statusCode and code', () => {
    const err = new AppError('Custom message', 422, 'CUSTOM_CODE');
    const res = mockRes();
    errorHandler(err, mockReq(), res, noop);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ error: 'Custom message', code: 'CUSTOM_CODE' });
  });

  it('handles NotFoundError → 404 NOT_FOUND', () => {
    const err = new NotFoundError('Usuario');
    const res = mockRes();
    errorHandler(err, mockReq(), res, noop);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('handles ValidationError → 400 VALIDATION_ERROR', () => {
    const err = new ValidationError('Campo requerido.');
    const res = mockRes();
    errorHandler(err, mockReq(), res, noop);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });

  it('handles UnauthorizedError → 401 UNAUTHORIZED', () => {
    const err = new UnauthorizedError();
    const res = mockRes();
    errorHandler(err, mockReq(), res, noop);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });

  it('handles ForbiddenError → 403 FORBIDDEN', () => {
    const err = new ForbiddenError();
    const res = mockRes();
    errorHandler(err, mockReq(), res, noop);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('handles ConflictError → 409 CONFLICT', () => {
    const err = new ConflictError('Recurso ya existe.');
    const res = mockRes();
    errorHandler(err, mockReq(), res, noop);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONFLICT' }));
  });

  it('handles RateLimitError → 429 RATE_LIMIT', () => {
    const err = new RateLimitError();
    const res = mockRes();
    errorHandler(err, mockReq(), res, noop);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'RATE_LIMIT' }));
  });
});

// ─── InsufficientFundsError ──────────────────────────────

describe('errorHandler — InsufficientFundsError', () => {
  it('returns 400 with balance details', () => {
    const err = new InsufficientFundsError(5_000, 10_000);
    const res = mockRes();
    errorHandler(err as unknown as Error, mockReq(), res, noop);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: expect.stringContaining('insuficiente'),
      code: 'INSUFFICIENT_FUNDS',
      currentBalance: 5_000,
      requestedAmount: 10_000,
    });
  });
});

// ─── ZodError ────────────────────────────────────────────

describe('errorHandler — ZodError', () => {
  it('returns 400 with validation details array', () => {
    const schema = z.object({ amount: z.number().min(100), name: z.string() });
    const result = schema.safeParse({ amount: 'not-a-number', name: 42 });
    expect(result.success).toBe(false);
    const zodErr = (result as { success: false; error: import('zod').ZodError }).error;

    const res = mockRes();
    errorHandler(zodErr as unknown as Error, mockReq(), res, noop);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.error).toBe('Datos inválidos.');
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details.length).toBeGreaterThan(0);
  });
});

// ─── Unknown errors → 500 ────────────────────────────────

describe('errorHandler — unknown errors (500)', () => {
  it('returns 500 INTERNAL_ERROR for unhandled exceptions', () => {
    const err = new Error('Unexpected DB failure');
    const res = mockRes();
    errorHandler(err, mockReq(), res, noop);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: expect.stringMatching(/interno/i),
      code: 'INTERNAL_ERROR',
    });
  });
});
