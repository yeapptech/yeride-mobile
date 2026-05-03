import { sanitizeForLogging } from './sanitize';

/**
 * Lightweight typed logger. Every payload is run through `sanitizeForLogging`
 * before it's emitted, so call sites cannot leak PII even by accident.
 *
 * Backends:
 *   - In tests / Node: writes to stdout/stderr.
 *   - In the React Native app: a `ConsoleTransport` is wired at module load
 *     so log lines show up in Metro / Xcode. Phase 9 turn 3 adds a
 *     `CrashlyticsLogTransport` at runtime via `LOG.addTransport(...)`,
 *     attached from `<ContainerProvider/>` once the DI container resolves
 *     the real `FirebaseCrashlyticsAdapter`. The transport list is mutable
 *     so the Crashlytics fan-out can be attached AFTER the logger
 *     singleton is constructed (the SDK isn't available at module load).
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

export class ConsoleTransport implements LogTransport {
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

/**
 * Composite transport that fans `log()` calls out to a list of children
 * sequentially. Each child's failure is isolated — if a Crashlytics
 * transport throws (e.g. native module unavailable), the console
 * transport still runs.
 *
 * Mutable list: `add(transport)` and `remove(transport)` allow runtime
 * attachment of the Crashlytics transport once the DI container is
 * built. Calling `add` with a transport already in the list is a no-op
 * (no duplicates). Calling `remove` with a transport not in the list
 * is also a no-op.
 *
 * Note: this class is intentionally exposed (not just used internally)
 * because tests + the `<ContainerProvider/>` mount need to inspect /
 * attach to the live transport list on the singleton `LOG`.
 */
export class CompositeTransport implements LogTransport {
  private readonly transports: LogTransport[] = [];

  constructor(initial: ReadonlyArray<LogTransport> = []) {
    for (const t of initial) this.add(t);
  }

  add(transport: LogTransport): void {
    if (this.transports.includes(transport)) return;
    this.transports.push(transport);
  }

  remove(transport: LogTransport): void {
    const idx = this.transports.indexOf(transport);
    if (idx >= 0) this.transports.splice(idx, 1);
  }

  /** Read-only snapshot for tests. Order matches insertion. */
  list(): readonly LogTransport[] {
    return this.transports.slice();
  }

  log(level: LogLevel, scope: string, message: string, meta?: unknown): void {
    // Iterate over a snapshot so a transport that mutates the list (e.g.
    // self-detaching on first error) doesn't break iteration.
    for (const t of [...this.transports]) {
      try {
        t.log(level, scope, message, meta);
      } catch {
        // Per-transport failure is silently swallowed: logging must
        // never break the calling code, and we can't recursively log
        // a logger failure (would loop forever). One bad transport
        // doesn't block siblings.
      }
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

  /**
   * Attach an additional transport to this logger's underlying transport
   * pipeline. Only valid if the logger was constructed with a
   * `CompositeTransport` — which the singleton `LOG` is. A no-op when
   * the underlying transport is a single (non-composite) transport, so
   * a custom-built logger with a different transport doesn't surprise
   * its callers.
   *
   * Used at app boot from `<ContainerProvider/>` to attach the
   * `CrashlyticsLogTransport` once the DI container resolves the real
   * adapter (Phase 9 turn 3 sub-turn 3a).
   */
  addTransport(transport: LogTransport): void {
    if (this.transport instanceof CompositeTransport) {
      this.transport.add(transport);
    }
  }

  /**
   * Detach a previously-added transport. Same composite-only semantics
   * as `addTransport`. Used by `<ContainerProvider/>`'s cleanup if the
   * provider unmounts (rare in production, common in tests).
   */
  removeTransport(transport: LogTransport): void {
    if (this.transport instanceof CompositeTransport) {
      this.transport.remove(transport);
    }
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

/**
 * Singleton `LOG`. Constructed with a `CompositeTransport` holding a
 * single `ConsoleTransport`. Phase 9 turn 3's
 * `<ContainerProvider/>` mount attaches a `CrashlyticsLogTransport` via
 * `LOG.addTransport(...)` once the DI container resolves.
 */
const defaultTransport = new CompositeTransport([new ConsoleTransport()]);

export const LOG = new Logger(
  'YeRide',
  defaultTransport,
  isDev() ? 'debug' : 'info',
);

export type { Logger };
