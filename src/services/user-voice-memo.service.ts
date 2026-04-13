import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-voice-memo');
const PREFIX = 'user:voice-memo:';
const TTL = 365 * 24 * 60 * 60;

export interface VoiceMemo {
  id: string;
  userId: string;
  transactionId?: string;
  title: string;
  audioUrl: string;
  durationSeconds: number;
  transcription?: string;
  createdAt: string;
  playCount: number;
}

export class UserVoiceMemoService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async list(userId: string): Promise<VoiceMemo[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  async create(input: {
    userId: string;
    title: string;
    audioUrl: string;
    durationSeconds: number;
    transactionId?: string;
    transcription?: string;
  }): Promise<VoiceMemo> {
    if (input.durationSeconds <= 0) throw new Error('Duracion debe ser positiva');
    if (input.durationSeconds > 300) throw new Error('Maximo 5 minutos por memo');
    if (input.title.length > 60) throw new Error('Titulo excede 60 caracteres');
    if (!/^https?:\/\//.test(input.audioUrl)) throw new Error('URL de audio invalida');
    if (input.transcription && input.transcription.length > 2000) {
      throw new Error('Transcripcion excede 2000 caracteres');
    }
    const list = await this.list(input.userId);
    if (list.length >= 100) throw new Error('Maximo 100 memos');
    const memo: VoiceMemo = {
      id: `voice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      transactionId: input.transactionId,
      title: input.title,
      audioUrl: input.audioUrl,
      durationSeconds: input.durationSeconds,
      transcription: input.transcription,
      createdAt: new Date().toISOString(),
      playCount: 0,
    };
    list.push(memo);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('voice memo created', { id: memo.id });
    return memo;
  }

  async play(userId: string, id: string): Promise<VoiceMemo | null> {
    const list = await this.list(userId);
    const memo = list.find(m => m.id === id);
    if (!memo) return null;
    memo.playCount++;
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return memo;
  }

  async updateTranscription(userId: string, id: string, transcription: string): Promise<VoiceMemo | null> {
    if (transcription.length > 2000) throw new Error('Transcripcion excede 2000 caracteres');
    const list = await this.list(userId);
    const memo = list.find(m => m.id === id);
    if (!memo) return null;
    memo.transcription = transcription;
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return memo;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const list = await this.list(userId);
    const idx = list.findIndex(m => m.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return true;
  }

  async getByTransaction(userId: string, transactionId: string): Promise<VoiceMemo[]> {
    const list = await this.list(userId);
    return list.filter(m => m.transactionId === transactionId);
  }

  async searchTranscription(userId: string, query: string): Promise<VoiceMemo[]> {
    const list = await this.list(userId);
    const q = query.toLowerCase();
    return list.filter(m => m.transcription?.toLowerCase().includes(q));
  }

  async getTotalDuration(userId: string): Promise<number> {
    const list = await this.list(userId);
    return list.reduce((sum, m) => sum + m.durationSeconds, 0);
  }
}

export const userVoiceMemo = new UserVoiceMemoService();
