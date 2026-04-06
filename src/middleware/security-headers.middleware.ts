import { Request, Response, NextFunction } from 'express';

/**
 * Additional security headers beyond Helmet defaults.
 * Adds headers recommended by OWASP and financial regulators.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  // Prevent browsers from MIME-sniffing the response body
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Enable browser XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Prevent information leakage through Referer header
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Disable browser features we don't use (privacy + security)
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );

  // Cache control for API responses — no caching of sensitive data
  if (!res.getHeader('Cache-Control')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
  }

  next();
}
