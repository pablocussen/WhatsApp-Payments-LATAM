import { Request, Response, NextFunction } from 'express';
import { apiKeys, type ApiKey, type ApiPermission } from '../services/api-key.service';
import { createLogger } from '../config/logger';

const log = createLogger('apikey-auth');

/**
 * Extended request with merchant API key context.
 */
export interface MerchantApiRequest extends Request {
  apiKey?: ApiKey;
  merchantId?: string;
}

/**
 * Middleware that authenticates requests using merchant API keys.
 * Expects header: `X-Api-Key: wp_live_...`
 *
 * Optionally requires specific permissions.
 */
export function requireApiKey(...requiredPermissions: ApiPermission[]) {
  return async (req: MerchantApiRequest, res: Response, next: NextFunction) => {
    const rawKey = req.headers['x-api-key'] as string | undefined;

    if (!rawKey) {
      return res.status(401).json({ error: 'API key requerida. Envía header X-Api-Key.' });
    }

    if (!rawKey.startsWith('wp_live_')) {
      return res.status(401).json({ error: 'Formato de API key inválido.' });
    }

    const key = await apiKeys.validateKey(rawKey);

    if (!key) {
      log.warn('Invalid API key attempt', { prefix: rawKey.slice(0, 16), ip: req.ip });
      return res.status(401).json({ error: 'API key inválida o revocada.' });
    }

    // Check required permissions
    for (const perm of requiredPermissions) {
      if (!apiKeys.hasPermission(key, perm)) {
        return res.status(403).json({
          error: `Permiso insuficiente. Requiere: ${perm}`,
          required: perm,
          granted: key.permissions,
        });
      }
    }

    // Attach to request
    req.apiKey = key;
    req.merchantId = key.merchantId;

    return next();
  };
}
