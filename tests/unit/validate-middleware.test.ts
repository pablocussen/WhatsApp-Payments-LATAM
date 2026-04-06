/**
 * Validation middleware + common schemas tests.
 */

import { z } from 'zod';
import { validate, validateQuery, schemas } from '../../src/middleware/validate.middleware';
import { Request, Response } from 'express';

function mockReq(body: unknown = {}, query: unknown = {}): Request {
  return { body, query } as Request;
}

function mockRes() {
  const res: Record<string, unknown> = {
    _status: 200,
    _body: null as unknown,
    status(code: number) { res._status = code; return res; },
    json(body: unknown) { res._body = body; return res; },
  };
  return res as unknown as Response & { _status: number; _body: unknown };
}

describe('validate middleware', () => {
  const schema = z.object({
    name: z.string().min(1),
    amount: z.number().int().min(100),
  });

  it('passes valid body and calls next', () => {
    const mw = validate(schema);
    const req = mockReq({ name: 'Test', amount: 5000 });
    const next = jest.fn();
    mw(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.body.name).toBe('Test');
  });

  it('rejects invalid body with 400', () => {
    const mw = validate(schema);
    const res = mockRes();
    const next = jest.fn();
    mw(mockReq({ name: '', amount: 50 }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toContain('inválidos');
  });

  it('includes field errors in response', () => {
    const mw = validate(schema);
    const res = mockRes();
    mw(mockReq({}), res, jest.fn());
    const body = res._body as { details: { fieldErrors: Record<string, string[]> } };
    expect(body.details.fieldErrors).toBeDefined();
  });
});

describe('validateQuery middleware', () => {
  const schema = z.object({
    page: z.coerce.number().int().min(1).default(1),
  });

  it('passes valid query', () => {
    const mw = validateQuery(schema);
    const req = mockReq({}, { page: '3' });
    const next = jest.fn();
    mw(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects invalid query with 400', () => {
    const mw = validateQuery(schema);
    const res = mockRes();
    mw(mockReq({}, { page: 'abc' }), res, jest.fn());
    expect(res._status).toBe(400);
  });
});

describe('common schemas', () => {
  it('phone validates Chilean numbers', () => {
    expect(schemas.phone.safeParse('+56912345678').success).toBe(true);
    expect(schemas.phone.safeParse('56912345678').success).toBe(true);
    expect(schemas.phone.safeParse('12345').success).toBe(false);
  });

  it('clpAmount validates range', () => {
    expect(schemas.clpAmount.safeParse(5000).success).toBe(true);
    expect(schemas.clpAmount.safeParse(50).success).toBe(false);
    expect(schemas.clpAmount.safeParse(3_000_000).success).toBe(false);
  });

  it('pin validates 6 digits', () => {
    expect(schemas.pin.safeParse('123456').success).toBe(true);
    expect(schemas.pin.safeParse('12345').success).toBe(false);
    expect(schemas.pin.safeParse('abcdef').success).toBe(false);
  });

  it('payment schema validates required fields', () => {
    const valid = {
      receiverId: 'user-2',
      amount: 5000,
      paymentMethod: 'WALLET',
    };
    expect(schemas.payment.safeParse(valid).success).toBe(true);
    expect(schemas.payment.safeParse({}).success).toBe(false);
  });

  it('batchPayment validates items array', () => {
    const valid = {
      items: [
        { receiverId: 'u1', receiverName: 'A', amount: 1000 },
        { receiverId: 'u2', receiverName: 'B', amount: 2000 },
      ],
    };
    expect(schemas.batchPayment.safeParse(valid).success).toBe(true);
    expect(schemas.batchPayment.safeParse({ items: [] }).success).toBe(false);
  });

  it('splitPayment validates method enum', () => {
    const valid = {
      creatorName: 'Pablo',
      description: 'Asado',
      totalAmount: 30000,
      splitMethod: 'equal',
      participants: [{ phone: '56911111111', name: 'Juan' }],
    };
    expect(schemas.splitPayment.safeParse(valid).success).toBe(true);
    expect(schemas.splitPayment.safeParse({ ...valid, splitMethod: 'invalid' }).success).toBe(false);
  });

  it('scheduledTransfer validates date format', () => {
    const valid = {
      receiverPhone: '56912345678',
      receiverName: 'Mama',
      amount: 50000,
      description: 'Mesada',
      frequency: 'monthly',
      scheduledDate: '2026-04-15',
    };
    expect(schemas.scheduledTransfer.safeParse(valid).success).toBe(true);
    expect(schemas.scheduledTransfer.safeParse({ ...valid, scheduledDate: 'invalid' }).success).toBe(false);
  });

  it('pagination has sensible defaults', () => {
    const result = schemas.pagination.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it('pagination clamps pageSize', () => {
    const result = schemas.pagination.safeParse({ pageSize: 500 });
    expect(result.success).toBe(false);
  });
});
