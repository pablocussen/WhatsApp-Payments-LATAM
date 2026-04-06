import { Request, Response, NextFunction } from 'express';

const API_VERSION = '1.0.0';
const MIN_SUPPORTED_VERSION = '1.0.0';

/**
 * Adds API version headers to all responses.
 * Helps clients track which API version they're talking to.
 */
export function apiVersionHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-API-Version', API_VERSION);
  res.setHeader('X-Min-Supported-Version', MIN_SUPPORTED_VERSION);
  res.setHeader('X-Powered-By', 'WhatPay');
  next();
}

/**
 * Middleware that checks client's requested API version.
 * If client sends `X-API-Version: 2.0.0` but we only support 1.x, warn them.
 */
export function checkApiVersion(req: Request, res: Response, next: NextFunction): void {
  const clientVersion = req.headers['x-api-version'] as string | undefined;

  if (clientVersion) {
    const [major] = clientVersion.split('.').map(Number);
    const [supportedMajor] = API_VERSION.split('.').map(Number);

    if (major > supportedMajor) {
      res.setHeader('X-API-Version-Warning', `Requested v${clientVersion}, serving v${API_VERSION}`);
    }
  }

  next();
}

export { API_VERSION };
