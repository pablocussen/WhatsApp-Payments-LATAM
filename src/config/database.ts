import { PrismaClient } from '@prisma/client';
import { createClient, RedisClientType } from 'redis';
import { env } from './environment';

// ─── Prisma (PostgreSQL) ────────────────────────────────

const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
});

export { prisma };

// ─── Redis ──────────────────────────────────────────────

let redis: RedisClientType;

export async function connectRedis(): Promise<RedisClientType> {
  if (redis) return redis;

  redis = createClient({ url: env.REDIS_URL });

  redis.on('error', (err) => console.error('[Redis] Error:', err));
  redis.on('connect', () => console.log('[Redis] Connected'));

  await redis.connect();
  return redis;
}

export function getRedis(): RedisClientType {
  if (!redis) throw new Error('Redis not connected. Call connectRedis() first.');
  return redis;
}

// ─── Session Store (Redis) ──────────────────────────────

const SESSION_TTL = 1800; // 30 minutes

export interface ConversationSession {
  userId: string;
  waId: string;
  state: string; // current conversation state
  data: Record<string, unknown>; // temp data for multi-step flows
  lastActivity: number;
}

export async function getSession(waId: string): Promise<ConversationSession | null> {
  const r = getRedis();
  const raw = await r.get(`session:${waId}`);
  return raw ? JSON.parse(raw) : null;
}

export async function setSession(waId: string, session: ConversationSession): Promise<void> {
  const r = getRedis();
  session.lastActivity = Date.now();
  await r.set(`session:${waId}`, JSON.stringify(session), { EX: SESSION_TTL });
}

export async function deleteSession(waId: string): Promise<void> {
  const r = getRedis();
  await r.del(`session:${waId}`);
}
