const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserVoiceMemoService } from '../../src/services/user-voice-memo.service';

describe('UserVoiceMemoService', () => {
  let s: UserVoiceMemoService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserVoiceMemoService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    userId: 'u1',
    title: 'Nota pago arriendo',
    audioUrl: 'https://storage.whatpay.cl/audio/123.mp3',
    durationSeconds: 45,
  };

  it('creates voice memo', async () => {
    const m = await s.create(base);
    expect(m.playCount).toBe(0);
    expect(m.id).toMatch(/^voice_/);
  });

  it('rejects zero duration', async () => {
    await expect(s.create({ ...base, durationSeconds: 0 })).rejects.toThrow('positiva');
  });

  it('rejects over 5 minute duration', async () => {
    await expect(s.create({ ...base, durationSeconds: 400 })).rejects.toThrow('5 minutos');
  });

  it('rejects long title', async () => {
    await expect(s.create({ ...base, title: 'x'.repeat(61) })).rejects.toThrow('60');
  });

  it('rejects invalid audio url', async () => {
    await expect(s.create({ ...base, audioUrl: 'not-a-url' })).rejects.toThrow('URL');
  });

  it('rejects over 100 memos', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: 'm' + i }))));
    await expect(s.create(base)).rejects.toThrow('100');
  });

  it('plays memo and increments count', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'm1', playCount: 2 }]));
    const m = await s.play('u1', 'm1');
    expect(m?.playCount).toBe(3);
  });

  it('updates transcription', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'm1' }]));
    const m = await s.updateTranscription('u1', 'm1', 'Hola mundo');
    expect(m?.transcription).toBe('Hola mundo');
  });

  it('rejects long transcription', async () => {
    await expect(s.updateTranscription('u1', 'm1', 'x'.repeat(2001))).rejects.toThrow('2000');
  });

  it('deletes memo', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'm1' }, { id: 'm2' }]));
    expect(await s.delete('u1', 'm1')).toBe(true);
  });

  it('filters by transaction', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'm1', transactionId: 'tx1' },
      { id: 'm2', transactionId: 'tx2' },
      { id: 'm3', transactionId: 'tx1' },
    ]));
    const found = await s.getByTransaction('u1', 'tx1');
    expect(found).toHaveLength(2);
  });

  it('searches transcription case insensitive', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'm1', transcription: 'Pago arriendo de mayo' },
      { id: 'm2', transcription: 'Compras supermercado' },
    ]));
    const found = await s.searchTranscription('u1', 'ARRIENDO');
    expect(found).toHaveLength(1);
  });

  it('computes total duration', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { durationSeconds: 45 },
      { durationSeconds: 30 },
      { durationSeconds: 120 },
    ]));
    expect(await s.getTotalDuration('u1')).toBe(195);
  });
});
