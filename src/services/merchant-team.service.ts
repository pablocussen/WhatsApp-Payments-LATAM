import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-team');

const TEAM_PREFIX = 'mteam:';
const TEAM_TTL = 365 * 24 * 60 * 60;
const MAX_MEMBERS = 20;

export type TeamRole = 'OWNER' | 'ADMIN' | 'CASHIER' | 'VIEWER';

export interface TeamMember {
  id: string;
  merchantId: string;
  userId: string;
  name: string;
  phone: string;
  role: TeamRole;
  permissions: string[];
  active: boolean;
  addedAt: string;
  lastActiveAt: string | null;
}

const ROLE_PERMISSIONS: Record<TeamRole, string[]> = {
  OWNER: ['*'],
  ADMIN: ['payments', 'refunds', 'reports', 'customers', 'products', 'team', 'settings'],
  CASHIER: ['payments', 'refunds', 'customers'],
  VIEWER: ['reports'],
};

export class MerchantTeamService {
  async addMember(input: {
    merchantId: string;
    userId: string;
    name: string;
    phone: string;
    role: TeamRole;
  }): Promise<TeamMember> {
    if (input.role === 'OWNER') throw new Error('No se puede agregar otro owner.');

    const team = await this.getTeam(input.merchantId);
    if (team.length >= MAX_MEMBERS) throw new Error(`Máximo ${MAX_MEMBERS} miembros.`);
    if (team.some(m => m.userId === input.userId)) throw new Error('Usuario ya es miembro.');

    const member: TeamMember = {
      id: `tm_${Date.now().toString(36)}`,
      merchantId: input.merchantId,
      userId: input.userId,
      name: input.name,
      phone: input.phone,
      role: input.role,
      permissions: ROLE_PERMISSIONS[input.role],
      active: true,
      addedAt: new Date().toISOString(),
      lastActiveAt: null,
    };

    team.push(member);
    await this.save(input.merchantId, team);

    log.info('Team member added', { merchantId: input.merchantId, userId: input.userId, role: input.role });
    return member;
  }

  async getTeam(merchantId: string): Promise<TeamMember[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${TEAM_PREFIX}${merchantId}`);
      return raw ? JSON.parse(raw) as TeamMember[] : [];
    } catch {
      return [];
    }
  }

  async changeRole(merchantId: string, memberId: string, newRole: TeamRole): Promise<TeamMember | null> {
    if (newRole === 'OWNER') throw new Error('No se puede asignar rol owner.');
    const team = await this.getTeam(merchantId);
    const member = team.find(m => m.id === memberId);
    if (!member) return null;

    member.role = newRole;
    member.permissions = ROLE_PERMISSIONS[newRole];
    await this.save(merchantId, team);
    return member;
  }

  async removeMember(merchantId: string, memberId: string): Promise<boolean> {
    const team = await this.getTeam(merchantId);
    const member = team.find(m => m.id === memberId);
    if (!member) return false;
    if (member.role === 'OWNER') throw new Error('No se puede remover al owner.');

    const filtered = team.filter(m => m.id !== memberId);
    await this.save(merchantId, filtered);
    return true;
  }

  async deactivateMember(merchantId: string, memberId: string): Promise<boolean> {
    const team = await this.getTeam(merchantId);
    const member = team.find(m => m.id === memberId);
    if (!member) return false;
    member.active = false;
    await this.save(merchantId, team);
    return true;
  }

  hasPermission(member: TeamMember, permission: string): boolean {
    if (!member.active) return false;
    if (member.permissions.includes('*')) return true;
    return member.permissions.includes(permission);
  }

  async getActiveCount(merchantId: string): Promise<number> {
    const team = await this.getTeam(merchantId);
    return team.filter(m => m.active).length;
  }

  private async save(merchantId: string, team: TeamMember[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${TEAM_PREFIX}${merchantId}`, JSON.stringify(team), { EX: TEAM_TTL });
    } catch (err) {
      log.warn('Failed to save team', { merchantId, error: (err as Error).message });
    }
  }
}

export const merchantTeam = new MerchantTeamService();
