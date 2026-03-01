/**
 * Minimal HTTP test client using Node.js built-ins only.
 * Replacement for supertest when npm install is unavailable.
 *
 * Usage:
 *   const client = await startTestServer(app);
 *   const res = await client.post('/login', { body: { waId: '...' } });
 *   expect(res.status).toBe(200);
 *   await client.close();
 */

import http from 'http';
import type { AddressInfo } from 'net';
import type express from 'express';

export interface TestResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export interface TestClient {
  get(path: string, opts?: RequestOptions): Promise<TestResponse>;
  post(path: string, opts?: RequestOptions): Promise<TestResponse>;
  delete(path: string, opts?: RequestOptions): Promise<TestResponse>;
  close(): Promise<void>;
}

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
}

async function makeRequest(
  port: number,
  method: string,
  path: string,
  opts: RequestOptions = {},
): Promise<TestResponse> {
  const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : '';
  const extraHeaders = opts.headers ?? {};

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
          ...extraHeaders,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk: Buffer) => (raw += chunk.toString()));
        res.on('end', () => {
          const headers: Record<string, string> = {};
          Object.entries(res.headers).forEach(([k, v]) => {
            headers[k] = Array.isArray(v) ? v[0] : (v ?? '');
          });
          let body: unknown;
          try {
            body = JSON.parse(raw);
          } catch {
            body = raw;
          }
          resolve({ status: res.statusCode ?? 0, body, headers });
        });
      },
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

export function startTestServer(app: express.Application): Promise<TestClient> {
  return new Promise((resolve) => {
    const server = http.createServer(app as Parameters<typeof http.createServer>[0]);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;

      const client: TestClient = {
        get: (path, opts) => makeRequest(port, 'GET', path, opts),
        post: (path, opts) => makeRequest(port, 'POST', path, opts),
        delete: (path, opts) => makeRequest(port, 'DELETE', path, opts),
        close: () => new Promise((res) => server.close(() => res())),
      };

      resolve(client);
    });
  });
}
