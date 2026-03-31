import type { Request, Response, NextFunction } from 'express';
import { platformStatus } from '../services/platform-status.service';

/**
 * Middleware that records request metrics (method, status, latency).
 * Fire-and-forget — never blocks or fails the request.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const latency = Date.now() - start;
    platformStatus.recordRequest(req.method, res.statusCode, latency).catch(() => {});
  });

  next();
}
