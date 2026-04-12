import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('quick-action');
const QA_PREFIX = 'qaction:';
const QA_TTL = 365 * 24 * 60 * 60;

export type ActionType = 'PAY_CONTACT' | 'PAY_BILL' | 'TOPUP' | 'TRANSFER' | 'REQUEST';

export interface QuickAction {
  id: string;
  userId: string;
  name: string;
  icon: string;
  type: ActionType;
  recipientPhone: string | null;
  amount: number | null;
  description: string | null;
  position: number;
  usageCount: number;
  createdAt: string;
}

export class UserQuickActionService {
  async createAction(input: {
    userId: string; name: string; icon: string; type: ActionType;
    recipientPhone?: string; amount?: number; description?: string;
  }): Promise<QuickAction> {
    if (!input.name || input.name.length > 30) throw new Error('Nombre entre 1 y 30 caracteres.');

    const actions = await this.getActions(input.userId);
    if (actions.length >= 8) throw new Error('Maximo 8 acciones rapidas.');

    const action: QuickAction = {
      id: 'qa_' + Date.now().toString(36),
      userId: input.userId,
      name: input.name,
      icon: input.icon,
      type: input.type,
      recipientPhone: input.recipientPhone ?? null,
      amount: input.amount ?? null,
      description: input.description ?? null,
      position: actions.length + 1,
      usageCount: 0,
      createdAt: new Date().toISOString(),
    };
    actions.push(action);
    await this.save(input.userId, actions);
    return action;
  }

  async useAction(userId: string, actionId: string): Promise<QuickAction | null> {
    const actions = await this.getActions(userId);
    const action = actions.find(a => a.id === actionId);
    if (!action) return null;
    action.usageCount++;
    await this.save(userId, actions);
    return action;
  }

  async getActions(userId: string): Promise<QuickAction[]> {
    try { const redis = getRedis(); const raw = await redis.get(QA_PREFIX + userId); return raw ? JSON.parse(raw) as QuickAction[] : []; }
    catch { return []; }
  }

  async getMostUsed(userId: string, limit = 4): Promise<QuickAction[]> {
    const actions = await this.getActions(userId);
    return [...actions].sort((a, b) => b.usageCount - a.usageCount).slice(0, limit);
  }

  async reorder(userId: string, actionIds: string[]): Promise<boolean> {
    const actions = await this.getActions(userId);
    if (actionIds.length !== actions.length) return false;
    actions.forEach(a => {
      const newPos = actionIds.indexOf(a.id);
      if (newPos >= 0) a.position = newPos + 1;
    });
    actions.sort((a, b) => a.position - b.position);
    await this.save(userId, actions);
    return true;
  }

  async deleteAction(userId: string, actionId: string): Promise<boolean> {
    const actions = await this.getActions(userId);
    const filtered = actions.filter(a => a.id !== actionId);
    if (filtered.length === actions.length) return false;
    filtered.forEach((a, i) => a.position = i + 1);
    await this.save(userId, filtered);
    return true;
  }

  private async save(userId: string, actions: QuickAction[]): Promise<void> {
    try { const redis = getRedis(); await redis.set(QA_PREFIX + userId, JSON.stringify(actions), { EX: QA_TTL }); }
    catch (err) { log.warn('Failed to save actions', { error: (err as Error).message }); }
  }
}

export const userQuickAction = new UserQuickActionService();
