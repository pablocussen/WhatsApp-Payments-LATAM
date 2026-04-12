import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('account-delegate');
const AD_PREFIX = 'acdeleg:';
const AD_TTL = 180 * 24 * 60 * 60;

export type DelegatePermission = 'VIEW_BALANCE' | 'SEND_PAYMENT' | 'RECEIVE_PAYMENT' | 'VIEW_HISTORY';

export interface AccountDelegate {
  id: string;
  ownerId: string;
  delegateId: string;
  delegateName: string;
  permissions: DelegatePermission[];
  dailyLimit: number;
  active: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export class UserAccountDelegateService {
  async addDelegate(input: {
    ownerId: string; delegateId: string; delegateName: string;
    permissions: DelegatePermission[]; dailyLimit: number; expiresInDays?: number;
  }): Promise<AccountDelegate> {
    if (input.permissions.length === 0) throw new Error('Debe tener al menos un permiso.');
    if (input.dailyLimit < 0) throw new Error('Limite diario no puede ser negativo.');

    const delegates = await this.getDelegates(input.ownerId);
    if (delegates.length >= 3) throw new Error('Maximo 3 delegados.');

    const delegate: AccountDelegate = {
      id: 'del_' + Date.now().toString(36),
      ownerId: input.ownerId,
      delegateId: input.delegateId,
      delegateName: input.delegateName,
      permissions: input.permissions,
      dailyLimit: input.dailyLimit,
      active: true,
      expiresAt: input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
        : null,
      createdAt: new Date().toISOString(),
    };
    delegates.push(delegate);
    await this.save(input.ownerId, delegates);
    return delegate;
  }

  async hasPermission(ownerId: string, delegateId: string, permission: DelegatePermission): Promise<boolean> {
    const delegates = await this.getDelegates(ownerId);
    const d = delegates.find(x => x.delegateId === delegateId && x.active);
    if (!d) return false;
    if (d.expiresAt && new Date() > new Date(d.expiresAt)) return false;
    return d.permissions.includes(permission);
  }

  async getDelegates(ownerId: string): Promise<AccountDelegate[]> {
    try { const redis = getRedis(); const raw = await redis.get(AD_PREFIX + ownerId); return raw ? JSON.parse(raw) as AccountDelegate[] : []; }
    catch { return []; }
  }

  async revokeDelegate(ownerId: string, delegateId: string): Promise<boolean> {
    const delegates = await this.getDelegates(ownerId);
    const d = delegates.find(x => x.id === delegateId);
    if (!d) return false;
    d.active = false;
    await this.save(ownerId, delegates);
    return true;
  }

  formatDelegateSummary(d: AccountDelegate): string {
    const expires = d.expiresAt ? ' (expira ' + d.expiresAt.slice(0, 10) + ')' : '';
    return d.delegateName + ': ' + d.permissions.length + ' permisos, limite ' + formatCLP(d.dailyLimit) + expires;
  }

  private async save(ownerId: string, delegates: AccountDelegate[]): Promise<void> {
    try { const redis = getRedis(); await redis.set(AD_PREFIX + ownerId, JSON.stringify(delegates), { EX: AD_TTL }); }
    catch (err) { log.warn('Failed to save delegates', { error: (err as Error).message }); }
  }
}

export const userAccountDelegate = new UserAccountDelegateService();
