import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/environment';
import { createLogger } from '../config/logger';

const log = createLogger('jwt-auth');

// ─── Types ──────────────────────────────────────────────

export interface JwtPayload {
  userId: string;
  waId: string;
  kycLevel: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

// ─── Token Operations ───────────────────────────────────

export function generateToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRATION as string | number,
    issuer: 'whatpay',
    audience: 'whatpay-api',
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET, {
    issuer: 'whatpay',
    audience: 'whatpay-api',
  }) as JwtPayload;
}

// ─── Auth Middleware ─────────────────────────────────────

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token de autenticación requerido.' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Sesión expirada. Autentícate de nuevo.' });
      return;
    }
    log.warn('Invalid token attempt', { error: (err as Error).message });
    res.status(401).json({ error: 'Token inválido.' });
  }
}

// ─── KYC Level Guard ────────────────────────────────────

export function requireKycLevel(minLevel: 'BASIC' | 'INTERMEDIATE' | 'FULL') {
  const levels = { BASIC: 0, INTERMEDIATE: 1, FULL: 2 };

  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado.' });
      return;
    }

    const userLevel = levels[req.user.kycLevel as keyof typeof levels] ?? 0;
    const requiredLevel = levels[minLevel];

    if (userLevel < requiredLevel) {
      res.status(403).json({
        error: `Necesitas nivel KYC "${minLevel}" para esta operación. Tu nivel actual: "${req.user.kycLevel}".`,
        action: 'upgrade_kyc',
      });
      return;
    }

    next();
  };
}
