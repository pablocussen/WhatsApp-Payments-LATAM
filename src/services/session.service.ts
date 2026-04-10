import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('session');

const SESSION_PREFIX = 'sess:';
const SESSION_LIST_PREFIX = 'sesslist:';
const SESSION_TTL = 30 * 24 * 60 * 60; // 30 days
const MAX_SESSIONS = 5;

export interface UserSession {
  id: string;
  userId: string;
  deviceType: 'WHATSAPP' | 'WEB' | 'API';
  deviceInfo: string;
  ipAddress: string;
  createdAt: string;
  lastActiveAt: string;
  active: boolean;
}

export class SessionService {
  /**
   * Create a new session.
   */
  async createSession(input: {
    userId: string;
    deviceType: 'WHATSAPP' | 'WEB' | 'API';
    deviceInfo: string;
    ipAddress: string;
  }): Promise<UserSession> {
    const session: UserSession = {
      id: `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      userId: input.userId,
      deviceType: input.deviceType,
      deviceInfo: input.deviceInfo,
      ipAddress: input.ipAddress,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      active: true,
    };

    // Enforce max sessions — remove oldest if exceeded
    const sessions = await this.getUserSessions(input.userId);
    const activeSessions = sessions.filter(s => s.active);
    if (activeSessions.length >= MAX_SESSIONS) {
      const oldest = activeSessions.sort((a, b) => new Date(a.lastActiveAt).getTime() - new Date(b.lastActiveAt).getTime())[0];
      if (oldest) await this.revokeSession(input.userId, oldest.id);
    }

    try {
      const redis = getRedis();
      const multi = redis.multi();
      multi.set(`${SESSION_PREFIX}${session.id}`, JSON.stringify(session), { EX: SESSION_TTL });
      multi.lPush(`${SESSION_LIST_PREFIX}${input.userId}`, session.id);
      await multi.exec();
    } catch (err) {
      log.warn('Failed to create session', { userId: input.userId, error: (err as Error).message });
    }

    log.info('Session created', { sessionId: session.id, userId: input.userId, device: input.deviceType });
    return session;
  }

  /**
   * Get a session by ID.
   */
  async getSession(sessionId: string): Promise<UserSession | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${SESSION_PREFIX}${sessionId}`);
      return raw ? JSON.parse(raw) as UserSession : null;
    } catch {
      return null;
    }
  }

  /**
   * Get all sessions for a user.
   */
  async getUserSessions(userId: string): Promise<UserSession[]> {
    try {
      const redis = getRedis();
      const ids = await redis.lRange(`${SESSION_LIST_PREFIX}${userId}`, 0, -1);
      if (!ids.length) return [];

      const sessions: UserSession[] = [];
      for (const id of ids) {
        const raw = await redis.get(`${SESSION_PREFIX}${id}`);
        if (raw) sessions.push(JSON.parse(raw));
      }
      return sessions;
    } catch {
      return [];
    }
  }

  /**
   * Update last active timestamp.
   */
  async touchSession(sessionId: string): Promise<boolean> {
    const session = await this.getSession(sessionId);
    if (!session || !session.active) return false;

    session.lastActiveAt = new Date().toISOString();
    try {
      const redis = getRedis();
      await redis.set(`${SESSION_PREFIX}${sessionId}`, JSON.stringify(session), { EX: SESSION_TTL });
    } catch {
      return false;
    }
    return true;
  }

  /**
   * Revoke a specific session.
   */
  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    const session = await this.getSession(sessionId);
    if (!session) return false;
    if (session.userId !== userId) return false;

    session.active = false;
    try {
      const redis = getRedis();
      await redis.set(`${SESSION_PREFIX}${sessionId}`, JSON.stringify(session), { EX: 60 * 60 }); // keep 1h after revoke
    } catch {
      return false;
    }

    log.info('Session revoked', { sessionId, userId });
    return true;
  }

  /**
   * Revoke all sessions for a user (logout everywhere).
   */
  async revokeAllSessions(userId: string): Promise<number> {
    const sessions = await this.getUserSessions(userId);
    let revoked = 0;
    for (const session of sessions) {
      if (session.active) {
        await this.revokeSession(userId, session.id);
        revoked++;
      }
    }

    log.info('All sessions revoked', { userId, count: revoked });
    return revoked;
  }

  /**
   * Count active sessions.
   */
  async countActiveSessions(userId: string): Promise<number> {
    const sessions = await this.getUserSessions(userId);
    return sessions.filter(s => s.active).length;
  }
}

export const sessions = new SessionService();
