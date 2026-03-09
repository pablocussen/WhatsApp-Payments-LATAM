/**
 * Tests admin routes when ADMIN_API_KEY is not configured.
 * Separate file to avoid env mock conflicts.
 */

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test', ADMIN_API_KEY: undefined },
}));

jest.mock('../../src/config/database', () => ({
  prisma: { user: { findMany: jest.fn(), count: jest.fn() }, auditEvent: { create: jest.fn().mockResolvedValue({}) } },
}));

import express from 'express';
import router from '../../src/api/admin.routes';
import { startTestServer, type TestClient } from './http-test-client';

const app = express().use(express.json()).use(router);

let client: TestClient;
beforeAll(async () => {
  client = await startTestServer(app);
});
afterAll(async () => {
  await client.close();
});

describe('Admin API without ADMIN_API_KEY', () => {
  it('returns 503 when ADMIN_API_KEY is not set', async () => {
    const res = await client.get('/users');
    expect(res.status).toBe(503);
    expect((res.body as { error: string }).error).toContain('not configured');
  });
});
