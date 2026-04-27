import { sanitizeForLogging } from './sanitize';

/**
 * Lightweight typed logger. Every payload is run through `sanitizeForLogging`
 * before it's emitted, so call sites cannot leak PII even by accident.
 *
 * Backends:
 *   - In tests / Node: writes to stdout/stderr.
 *   - In the React Native app: a Crashlytics transport will be attached in
 *     Phase 9 (see REFACTOR_PLAN.md). For now, console.* is fine; we run in
 *     development and bug reporting is done via the dev tools.
 *
 * Use `LOG.extend('ModuleName')` to scope log lines.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogTransport {
  log(level: LogLevel, scope: string, message: string, meta?: unknown): void;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

class ConsoleTransport implements LogTransport {
  log(level: LogLevel, scope: string, message: string, meta?: unknown): void {
    const tag = `[${scope}]`;
    const args: unknown[] = [tag, message];
    if (meta !== undefined) args.push(meta);
    // We deliberately avoid `console.log` (banned by ESLint), but `debug`,
    // `info`, `warn`, and `error` are all available and route to the
    // appropriate Metro/Xcode console levels — important so that informational
    // boot signals like "real Firebase wired" don't show up tagged WARN.
    switch (level) {
      case 'debug':
        console.debug(...args);
        break;
      case 'info':
        console.info(...args);
        break;
      case 'warn':
        console.warn(...args);
        break;
      case 'error':
        console.error(...args);
        break;
    }
  }
}

class Logger {
  constructor(
    public readonly scope: string,
    private readonly transport: LogTransport,
    private readonly minLevel: LogLevel,
  ) {}

  extend(childScope: string): Logger {
    return new Logger(
      `${this.scope}:${childScope}`,
      this.transport,
      this.minLevel,
    );
  }

  debug(message: string, meta?: unknown): void {
    this.write('debug', message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.write('error', message, meta);
  }

  private write(level: LogLevel, message: string, meta?: unknown): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) return;
    const safeMeta = meta === undefined ? undefined : sanitizeForLogging(meta);
    this.transport.log(level, this.scope, message, safeMeta);
  }
}

const isDev = (): boolean => {
  // __DEV__ is a global in React Native bundles; in Node tests it's undefined.
  // Guarded access keeps this file usable in both contexts.
  const flag = (
    globalThis as unknown as {
      __DEV__?: boolean;
      process?: { env?: Record<string, string | undefined> };
    }
  ).__DEV__;
  if (typeof flag === 'boolean') return flag;
  return (
    (
      globalThis as unknown as {
        process?: { env?: Record<string, string | undefined> };
      }
    ).process?.env?.NODE_ENV !== 'production'
  );
};

const defaultTransport = new ConsoleTransport();

export const LOG = new Logger(
  'YeRide',
  defaultTransport,
  isDev() ? 'debug' : 'info',
);

export type { Logger };
