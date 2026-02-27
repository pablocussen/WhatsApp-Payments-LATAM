import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { createLogger } from '../config/logger';
import { env } from '../config/environment';
import { InsufficientFundsError } from '../services/wallet.service';

const log = createLogger('error-handler');

// ─── App Errors ─────────────────────────────────────────

export class AppError extends Error {
  public statusCode: number;
  public code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} no encontrado.`, 404, 'NOT_FOUND');
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'No autorizado.') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Acceso denegado.') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export class RateLimitError extends AppError {
  constructor() {
    super('Demasiadas solicitudes. Intenta en unos minutos.', 429, 'RATE_LIMIT');
  }
}

// ─── Error Handler Middleware ────────────────────────────

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  // Known app errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }

  // Insufficient funds
  if (err instanceof InsufficientFundsError) {
    res.status(400).json({
      error: err.message,
      code: 'INSUFFICIENT_FUNDS',
      currentBalance: err.currentBalance,
      requestedAmount: err.requestedAmount,
    });
    return;
  }

  // Zod validation errors
  if (err instanceof ZodError) {
    const messages = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
    res.status(400).json({
      error: 'Datos inválidos.',
      code: 'VALIDATION_ERROR',
      details: messages,
    });
    return;
  }

  // Unknown errors → 500
  // Stack traces are only logged in development to avoid leaking file paths in production logs
  log.error('Unhandled error', {
    error: err.message,
    ...(env.NODE_ENV !== 'production' && { stack: err.stack }),
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    error: 'Error interno del servidor. Intenta de nuevo.',
    code: 'INTERNAL_ERROR',
  });
}
