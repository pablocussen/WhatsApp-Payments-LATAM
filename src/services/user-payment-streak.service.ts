import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('payment-streak');
const PS_PREFIX = 'paystreak:';
const PS_TTL = 365 * 24 * 60 * 60;

export interface PaymentStreak {
  userId: string;
  currentStreak: number;
  longestStreak: number;
  lastPaymentDate: string | null;
  totalDays: number;
  achievements: string[];
  updatedAt: string;
}

export class UserPaymentStreakService {
  async recordPayment(userId: string): Promise<PaymentStreak> {
    const streak = await this.getStreak(userId);
    const today = new Date().toISOString().slice(0, 10);

    if (streak.lastPaymentDate === today) return streak;

    if (streak.lastPaymentDate) {
      const last = new Date(streak.lastPaymentDate);
      const todayDate = new Date(today);
      const diffDays = Math.floor((todayDate.getTime() - last.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays === 1) {
        streak.currentStreak++;
      } else {
        streak.currentStreak = 1;
      }
    } else {
      streak.currentStreak = 1;
    }

    streak.lastPaymentDate = today;
    streak.totalDays++;
    if (streak.currentStreak > streak.longestStreak) {
      streak.longestStreak = streak.currentStreak;
    }

    const newAchievements = this.checkAchievements(streak);
    for (const a of newAchievements) {
      if (!streak.achievements.includes(a)) streak.achievements.push(a);
    }

    streak.updatedAt = new Date().toISOString();
    try { const redis = getRedis(); await redis.set(PS_PREFIX + userId, JSON.stringify(streak), { EX: PS_TTL }); }
    catch (err) { log.warn('Failed to save streak', { error: (err as Error).message }); }
    return streak;
  }

  async getStreak(userId: string): Promise<PaymentStreak> {
    try {
      const redis = getRedis();
      const raw = await redis.get(PS_PREFIX + userId);
      if (raw) return JSON.parse(raw) as PaymentStreak;
    } catch { /* defaults */ }
    return {
      userId, currentStreak: 0, longestStreak: 0,
      lastPaymentDate: null, totalDays: 0, achievements: [],
      updatedAt: new Date().toISOString(),
    };
  }

  checkAchievements(streak: PaymentStreak): string[] {
    const achievements: string[] = [];
    if (streak.currentStreak >= 7) achievements.push('SEMANA_PERFECTA');
    if (streak.currentStreak >= 30) achievements.push('MES_PERFECTO');
    if (streak.currentStreak >= 100) achievements.push('CENTURION');
    if (streak.totalDays >= 50) achievements.push('USUARIO_FRECUENTE');
    if (streak.longestStreak >= 365) achievements.push('AÑO_DORADO');
    return achievements;
  }
}

export const userPaymentStreak = new UserPaymentStreakService();
