/**
 * TransactionNotesService — notas en transacciones.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { TransactionNotesService } from '../../src/services/transaction-notes.service';

describe('TransactionNotesService', () => {
  let service: TransactionNotesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TransactionNotesService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('adds a note', async () => {
    const note = await service.addNote('u1', '#WP-123', 'Pago por almuerzo');
    expect(note.id).toMatch(/^note_/);
    expect(note.text).toBe('Pago por almuerzo');
    expect(note.transactionRef).toBe('#WP-123');
  });

  it('rejects empty note', async () => {
    await expect(service.addNote('u1', '#WP-123', '')).rejects.toThrow('caracteres');
  });

  it('rejects note over 200 chars', async () => {
    await expect(service.addNote('u1', '#WP-123', 'x'.repeat(201))).rejects.toThrow('200');
  });

  it('rejects over 5 notes per tx', async () => {
    const existing = Array.from({ length: 5 }, (_, i) => ({ id: `note_${i}`, text: `n${i}` }));
    mockRedisGet.mockResolvedValue(JSON.stringify(existing));
    await expect(service.addNote('u1', '#WP-123', 'extra')).rejects.toThrow('5');
  });

  it('returns empty for no notes', async () => {
    expect(await service.getNotes('u1', '#WP-123')).toEqual([]);
  });

  it('returns stored notes', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'note_1', text: 'Test' }]));
    const notes = await service.getNotes('u1', '#WP-123');
    expect(notes).toHaveLength(1);
  });

  it('deletes a note', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'note_1', text: 'A' }, { id: 'note_2', text: 'B' },
    ]));
    expect(await service.deleteNote('u1', '#WP-123', 'note_1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe('note_2');
  });

  it('returns false for non-existent note delete', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([]));
    expect(await service.deleteNote('u1', '#WP-123', 'nope')).toBe(false);
  });

  it('edits a note', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'note_1', text: 'original' },
    ]));
    const edited = await service.editNote('u1', '#WP-123', 'note_1', 'editado');
    expect(edited?.text).toBe('editado');
  });

  it('returns null for non-existent note edit', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([]));
    expect(await service.editNote('u1', '#WP-123', 'nope', 'text')).toBeNull();
  });
});
