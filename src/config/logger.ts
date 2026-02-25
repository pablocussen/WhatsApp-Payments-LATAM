import { env } from './environment';

// ─── Structured Logger ──────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  [key: string]: any;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL = env.NODE_ENV === 'development' ? 'debug' : 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LEVEL];
}

function formatEntry(entry: LogEntry): string {
  if (env.NODE_ENV === 'development') {
    const { timestamp, level, service, message, ...rest } = entry;
    const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
    return `[${timestamp}] ${level.toUpperCase().padEnd(5)} [${service}] ${message}${extra}`;
  }
  return JSON.stringify(entry);
}

export function createLogger(service: string) {
  function log(level: LogLevel, message: string, meta?: Record<string, any>) {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service,
      message,
      ...meta,
    };

    const formatted = formatEntry(entry);

    if (level === 'error') {
      console.error(formatted);
    } else if (level === 'warn') {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  }

  return {
    debug: (msg: string, meta?: Record<string, any>) => log('debug', msg, meta),
    info: (msg: string, meta?: Record<string, any>) => log('info', msg, meta),
    warn: (msg: string, meta?: Record<string, any>) => log('warn', msg, meta),
    error: (msg: string, meta?: Record<string, any>) => log('error', msg, meta),
  };
}
