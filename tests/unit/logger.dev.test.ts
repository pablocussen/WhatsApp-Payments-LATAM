/**
 * Unit tests for createLogger (src/config/logger.ts) — development mode.
 *
 * This file has its own top-level jest.mock with NODE_ENV='development' so that
 * logger.ts is loaded with MIN_LEVEL='debug' and formatEntry uses the
 * human-readable bracket format instead of JSON.
 */

// Mock: development environment → human-readable format, debug+ level
jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'development' },
}));

import { createLogger } from '../../src/config/logger';

describe('Logger (NODE_ENV=development) — human-readable format, debug+', () => {
  const log = createLogger('dev-svc');

  it('allows debug messages in development mode (MIN_LEVEL=debug)', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    log.debug('debug visible');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('uses human-readable bracket format — NOT JSON', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    log.info('hello world');
    const output = spy.mock.calls[0][0] as string;
    // Format: "[2026-…T…Z] INFO  [dev-svc] hello world"
    expect(output).toMatch(/^\[\d{4}-\d{2}-\d{2}/);
    expect(output).toContain('INFO');
    expect(output).toContain('dev-svc');
    expect(output).toContain('hello world');
    expect(output).not.toContain('"level"'); // NOT a JSON string
    spy.mockRestore();
  });

  it('appends serialized extra fields when metadata is provided', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    log.info('with extras', { userId: 'u1', count: 3 });
    const output = spy.mock.calls[0][0] as string;
    // Extra fields are appended as JSON suffix: " {"userId":"u1","count":3}"
    expect(output).toContain('userId');
    expect(output).toContain('u1');
    spy.mockRestore();
  });

  it('omits trailing JSON suffix when no extra metadata', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    log.info('no extras');
    const output = spy.mock.calls[0][0] as string;
    // No extra fields → format ends with the message, no JSON object appended
    expect(output).not.toContain('{');
    spy.mockRestore();
  });
});
