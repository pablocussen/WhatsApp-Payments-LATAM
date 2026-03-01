/**
 * Unit tests for createLogger (src/config/logger.ts) — production/test mode.
 *
 * Covers JSON output, level routing, and level filtering (info+).
 * Development-mode branches (human-readable format, debug+) are covered in
 * logger.dev.test.ts, which loads the module with NODE_ENV='development'.
 */

// Mock: test/production environment → JSON format, info+ level
jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

import { createLogger } from '../../src/config/logger';

describe('Logger (NODE_ENV=test) — JSON format, info+ only', () => {
  const log = createLogger('test-svc');

  it('suppresses debug messages in test/production mode', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    log.debug('should not appear');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('logs info messages via console.log', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    log.info('info message');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('emits valid JSON with all expected fields', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    log.info('payload test', { key: 'value' });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.level).toBe('info');
    expect(parsed.service).toBe('test-svc');
    expect(parsed.message).toBe('payload test');
    expect(parsed.key).toBe('value');
    spy.mockRestore();
  });

  it('routes warn to console.warn', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    log.warn('warning message');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('routes error to console.error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    log.error('error message');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
