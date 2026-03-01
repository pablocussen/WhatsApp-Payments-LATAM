/**
 * Route-level tests for merchant.routes.ts.
 * Covers: GET /dashboard, GET /transactions, GET /settlement.
 * All endpoints require authentication + INTERMEDIATE KYC level.
 */

// ─── Mock variables ────────────────────────────────────────────────────────────

const mockGetDashboard = jest.fn();
const mockGetTransactions = jest.fn();
const mockGenerateSettlementReport = jest.fn();

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('../../src/config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
    JWT_EXPIRATION: '30m',
    APP_BASE_URL: 'http://localhost:3000',
  },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({ ping: jest.fn() }),
  prisma: {},
}));

jest.mock('../../src/services/merchant.service', () => ({
  MerchantService: jest.fn().mockImplementation(() => ({
    getDashboard: mockGetDashboard,
    getTransactions: mockGetTransactions,
    generateSettlementReport: mockGenerateSettlementReport,
  })),
}));

import express from 'express';
import router from '../../src/api/merchant.routes';
import { generateToken } from '../../src/middleware/jwt.middleware';
import { startTestServer, type TestClient } from './http-test-client';

const app = express().use(express.json()).use(router);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const tokenWithKyc = (kycLevel: string) =>
  generateToken({ userId: 'merchant-uuid-001', waId: '56912345678', kycLevel });

const withKyc = (kycLevel: string) => ({
  headers: { Authorization: `Bearer ${tokenWithKyc(kycLevel)}` },
});

// ─── Server lifecycle ─────────────────────────────────────────────────────────

let client: TestClient;
beforeAll(async () => {
  client = await startTestServer(app);
});
afterAll(async () => {
  await client.close();
});

// ─── GET /dashboard ───────────────────────────────────────────────────────────

describe('GET /dashboard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    const res = await client.get('/dashboard');
    expect(res.status).toBe(401);
  });

  it('returns 403 when KYC level is BASIC (below INTERMEDIATE)', async () => {
    const res = await client.get('/dashboard', withKyc('BASIC'));
    expect(res.status).toBe(403);
    expect((res.body as { action: string }).action).toBe('upgrade_kyc');
  });

  it('returns 200 when KYC level is INTERMEDIATE', async () => {
    mockGetDashboard.mockResolvedValue({ totalSales: 50000, transactionCount: 5 });
    const res = await client.get('/dashboard', withKyc('INTERMEDIATE'));
    expect(res.status).toBe(200);
    expect((res.body as { totalSales: number }).totalSales).toBe(50000);
  });

  it('returns 200 when KYC level is FULL', async () => {
    mockGetDashboard.mockResolvedValue({ totalSales: 100000, transactionCount: 10 });
    const res = await client.get('/dashboard', withKyc('FULL'));
    expect(res.status).toBe(200);
  });
});

// ─── GET /transactions ────────────────────────────────────────────────────────

describe('GET /transactions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    const res = await client.get('/transactions');
    expect(res.status).toBe(401);
  });

  it('returns 403 when KYC level is BASIC', async () => {
    const res = await client.get('/transactions', withKyc('BASIC'));
    expect(res.status).toBe(403);
  });

  it('returns 200 with default pagination (page=1, pageSize=20)', async () => {
    mockGetTransactions.mockResolvedValue({ transactions: [], total: 0 });
    const res = await client.get('/transactions', withKyc('INTERMEDIATE'));
    expect(res.status).toBe(200);
    expect(mockGetTransactions).toHaveBeenCalledWith('merchant-uuid-001', 1, 20);
  });

  it('accepts custom page and pageSize query parameters', async () => {
    mockGetTransactions.mockResolvedValue({ transactions: [{ id: 'tx-1' }], total: 1 });
    const res = await client.get('/transactions?page=2&pageSize=10', withKyc('INTERMEDIATE'));
    expect(res.status).toBe(200);
    expect(mockGetTransactions).toHaveBeenCalledWith('merchant-uuid-001', 2, 10);
  });

  it('returns 400 when pagination parameters are invalid (pageSize > 100)', async () => {
    const res = await client.get('/transactions?pageSize=200', withKyc('INTERMEDIATE'));
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/paginación/i);
  });
});

// ─── GET /settlement ──────────────────────────────────────────────────────────

describe('GET /settlement', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    const res = await client.get('/settlement');
    expect(res.status).toBe(401);
  });

  it('returns 403 when KYC level is BASIC', async () => {
    const res = await client.get('/settlement', withKyc('BASIC'));
    expect(res.status).toBe(403);
  });

  it('returns 200 with default date range (current month)', async () => {
    mockGenerateSettlementReport.mockResolvedValue({ total: 150000, transactions: [] });
    const res = await client.get('/settlement', withKyc('INTERMEDIATE'));
    expect(res.status).toBe(200);
    expect(mockGenerateSettlementReport).toHaveBeenCalledWith(
      'merchant-uuid-001',
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('accepts custom start and end dates', async () => {
    mockGenerateSettlementReport.mockResolvedValue({ total: 75000, transactions: [] });
    const res = await client.get(
      '/settlement?start=2026-01-01T00:00:00Z&end=2026-01-31T23:59:59Z',
      withKyc('FULL'),
    );
    expect(res.status).toBe(200);
    expect(mockGenerateSettlementReport).toHaveBeenCalledWith(
      'merchant-uuid-001',
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('returns 400 when date format is invalid', async () => {
    const res = await client.get(
      '/settlement?start=not-a-date&end=also-not-a-date',
      withKyc('INTERMEDIATE'),
    );
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/ISO 8601/i);
  });
});
