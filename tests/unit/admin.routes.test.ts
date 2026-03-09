/**
 * Route-level tests for admin.routes.ts.
 * Covers: requireAdminKey middleware, GET /users, GET /users/:id,
 *         POST /users/:id/ban, POST /users/:id/unban, POST /users/:id/kyc,
 *         GET /transactions, GET /stats.
 */

const mockPrisma = {
  user: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  transaction: {
    findMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
  },
  paymentLink: { count: jest.fn() },
  auditEvent: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn(), count: jest.fn() },
};

jest.mock('../../src/config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    ADMIN_API_KEY: 'test-admin-key-that-is-at-least-32-chars',
  },
}));

jest.mock('../../src/config/database', () => ({
  prisma: mockPrisma,
}));

import express from 'express';
import router from '../../src/api/admin.routes';
import { startTestServer, type TestClient } from './http-test-client';

const app = express().use(express.json()).use(router);

const adminHeaders = () => ({
  headers: { 'x-admin-key': 'test-admin-key-that-is-at-least-32-chars' },
});

let client: TestClient;
beforeAll(async () => {
  client = await startTestServer(app);
});
afterAll(async () => {
  await client.close();
});

// ─── Auth Middleware ─────────────────────────────────────

describe('requireAdminKey', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when no X-Admin-Key header', async () => {
    const res = await client.get('/users');
    expect(res.status).toBe(401);
  });

  it('returns 401 when key is wrong', async () => {
    const res = await client.get('/users', { headers: { 'x-admin-key': 'wrong' } });
    expect(res.status).toBe(401);
  });
});

// ─── GET /users ─────────────────────────────────────────

describe('GET /users', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns paginated user list', async () => {
    const users = [{ id: 'u1', waId: '56911111111', name: 'Juan', kycLevel: 'BASIC', isActive: true }];
    mockPrisma.user.findMany.mockResolvedValue(users);
    mockPrisma.user.count.mockResolvedValue(1);

    const res = await client.get('/users', adminHeaders());
    expect(res.status).toBe(200);
    expect((res.body as { users: unknown[]; total: number }).total).toBe(1);
  });

  it('respects page and pageSize query params', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.user.count.mockResolvedValue(0);

    const res = await client.get('/users?page=2&pageSize=10', adminHeaders());
    expect(res.status).toBe(200);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
  });
});

// ─── GET /users/:id ─────────────────────────────────────

describe('GET /users/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 404 when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await client.get('/users/nonexistent', adminHeaders());
    expect(res.status).toBe(404);
  });

  it('returns user detail with wallet', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      waId: '56911111111',
      name: 'Juan',
      wallet: { balance: 50000, currency: 'CLP' },
    });
    const res = await client.get('/users/u1', adminHeaders());
    expect(res.status).toBe(200);
  });
});

// ─── POST /users/:id/ban ────────────────────────────────

describe('POST /users/:id/ban', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 404 when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await client.post('/users/nonexistent/ban', adminHeaders());
    expect(res.status).toBe(404);
  });

  it('bans user and returns 200', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    mockPrisma.user.update.mockResolvedValue({});
    const res = await client.post('/users/u1/ban', adminHeaders());
    expect(res.status).toBe(200);
    expect((res.body as { message: string }).message).toContain('banned');
  });
});

// ─── POST /users/:id/unban ──────────────────────────────

describe('POST /users/:id/unban', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 404 when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await client.post('/users/nonexistent/unban', adminHeaders());
    expect(res.status).toBe(404);
  });

  it('unbans user, resets pinAttempts, and returns 200', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    mockPrisma.user.update.mockResolvedValue({});
    const res = await client.post('/users/u1/unban', adminHeaders());
    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { isActive: true, pinAttempts: 0, lockedUntil: null },
      }),
    );
  });
});

// ─── POST /users/:id/kyc ───────────────────────────────

describe('POST /users/:id/kyc', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 400 for invalid KYC level', async () => {
    const res = await client.post('/users/u1/kyc', { ...adminHeaders(), body: { level: 'INVALID' } });
    expect(res.status).toBe(400);
  });

  it('returns 404 when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await client.post('/users/u1/kyc', { ...adminHeaders(), body: { level: 'FULL' } });
    expect(res.status).toBe(404);
  });

  it('updates KYC level and returns 200', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1' });
    mockPrisma.user.update.mockResolvedValue({});
    const res = await client.post('/users/u1/kyc', { ...adminHeaders(), body: { level: 'FULL' } });
    expect(res.status).toBe(200);
    expect((res.body as { message: string }).message).toContain('FULL');
  });
});

// ─── GET /transactions ──────────────────────────────────

describe('GET /transactions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns paginated transactions', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([]);
    mockPrisma.transaction.count.mockResolvedValue(0);

    const res = await client.get('/transactions', adminHeaders());
    expect(res.status).toBe(200);
    expect((res.body as { total: number }).total).toBe(0);
  });

  it('filters by status when provided', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([]);
    mockPrisma.transaction.count.mockResolvedValue(0);

    await client.get('/transactions?status=REVERSED', adminHeaders());
    expect(mockPrisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'REVERSED' } }),
    );
  });
});

// ─── GET /stats ─────────────────────────────────────────

describe('GET /stats', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns platform stats', async () => {
    mockPrisma.user.count.mockResolvedValue(100);
    mockPrisma.transaction.count.mockResolvedValue(500);
    mockPrisma.transaction.aggregate.mockResolvedValue({ _sum: { amount: BigInt(5_000_000) } });
    mockPrisma.paymentLink.count.mockResolvedValue(10);

    const res = await client.get('/stats', adminHeaders());
    expect(res.status).toBe(200);

    const body = res.body as { users: number; transactions: number; totalVolume: number };
    expect(body.users).toBe(100);
    expect(body.transactions).toBe(500);
    expect(body.totalVolume).toBe(5_000_000);
  });

  it('returns 0 volume when no transactions', async () => {
    mockPrisma.user.count.mockResolvedValue(0);
    mockPrisma.transaction.count.mockResolvedValue(0);
    mockPrisma.transaction.aggregate.mockResolvedValue({ _sum: { amount: null } });
    mockPrisma.paymentLink.count.mockResolvedValue(0);

    const res = await client.get('/stats', adminHeaders());
    expect((res.body as { totalVolume: number }).totalVolume).toBe(0);
  });
});

// ─── GET /audit ─────────────────────────────────────────

describe('GET /audit', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns paginated audit events', async () => {
    const events = [
      {
        id: 'evt-1',
        eventType: 'PAYMENT_COMPLETED',
        actorType: 'USER',
        actorId: 'u1',
        targetUserId: 'u1',
        amount: BigInt(5000),
        metadata: null,
        status: 'SUCCESS',
        errorMessage: null,
        transactionId: null,
        createdAt: new Date(),
      },
    ];
    mockPrisma.auditEvent.findMany.mockResolvedValue(events);
    mockPrisma.auditEvent.count.mockResolvedValue(1);

    const res = await client.get('/audit', adminHeaders());
    expect(res.status).toBe(200);

    const body = res.body as { events: unknown[]; total: number };
    expect(body.total).toBe(1);
    expect(body.events).toHaveLength(1);
  });

  it('filters by userId and eventType', async () => {
    mockPrisma.auditEvent.findMany.mockResolvedValue([]);
    mockPrisma.auditEvent.count.mockResolvedValue(0);

    const res = await client.get('/audit?userId=u1&eventType=PAYMENT_COMPLETED', adminHeaders());
    expect(res.status).toBe(200);
    expect(mockPrisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { targetUserId: 'u1', eventType: 'PAYMENT_COMPLETED' },
      }),
    );
  });
});
