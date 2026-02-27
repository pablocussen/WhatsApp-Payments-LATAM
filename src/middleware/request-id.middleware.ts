import { Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';

/**
 * Attaches a unique X-Request-Id to every request for distributed tracing.
 * Passes through any client-supplied ID (e.g. from an upstream proxy).
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-request-id'] as string) || randomBytes(8).toString('hex');
  req.headers['x-request-id'] = id;
  res.setHeader('X-Request-Id', id);
  next();
}
