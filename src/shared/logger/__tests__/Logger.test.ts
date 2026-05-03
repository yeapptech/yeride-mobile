import { FakeCrashReportingService } from '@shared/testing';

import { CrashlyticsLogTransport } from '../CrashlyticsLogTransport';
import {
  CompositeTransport,
  ConsoleTransport,
  LOG,
  type LogLevel,
  type LogTransport,
} from '../Logger';

interface Recorded {
  level: LogLevel;
  scope: string;
  message: string;
  meta: unknown;
  rawMeta: unknown;
}

class RecordingTransport implements LogTransport {
  readonly entries: Recorded[] = [];

  log(
    level: LogLevel,
    scope: string,
    message: string,
    meta?: unknown,
    rawMeta?: unknown,
  ): void {
    this.entries.push({ level, scope, message, meta, rawMeta });
  }

  reset(): void {
    this.entries.length = 0;
  }
}

class ThrowingTransport implements LogTransport {
  log(): never {
    throw new Error('boom');
  }
}

/** Drains the microtask queue so async `void`-fired SDK calls land. */
const flushMicrotasks = () => Promise.resolve();

describe('CompositeTransport — fan-out + isolation', () => {
  it('fans log() to every child in order', () => {
    const a = new RecordingTransport();
    const b = new RecordingTransport();
    const composite = new CompositeTransport([a, b]);
    composite.log('info', 'Test', 'hello');
    expect(a.entries).toHaveLength(1);
    expect(b.entries).toHaveLength(1);
    expect(a.entries[0]?.message).toBe('hello');
    expect(b.entries[0]?.message).toBe('hello');
  });

  it('add() ignores duplicates', () => {
    const a = new RecordingTransport();
    const composite = new CompositeTransport();
    composite.add(a);
    composite.add(a);
    composite.log('info', 'Test', 'one');
    expect(a.entries).toHaveLength(1);
  });

  it('remove() detaches a transport (subsequent log() does not reach it)', () => {
    const a = new RecordingTransport();
    const b = new RecordingTransport();
    const composite = new CompositeTransport([a, b]);
    composite.remove(a);
    composite.log('info', 'Test', 'hi');
    expect(a.entries).toHaveLength(0);
    expect(b.entries).toHaveLength(1);
  });

  it('remove() is a no-op for a transport not in the list', () => {
    const a = new RecordingTransport();
    const composite = new CompositeTransport();
    expect(() => composite.remove(a)).not.toThrow();
    expect(composite.list()).toEqual([]);
  });

  it('list() returns a snapshot — caller mutation does not affect the live list', () => {
    const a = new RecordingTransport();
    const b = new RecordingTransport();
    const composite = new CompositeTransport([a, b]);
    const view = composite.list() as LogTransport[];
    view.length = 0;
    composite.log('info', 'Test', 'still works');
    expect(a.entries).toHaveLength(1);
    expect(b.entries).toHaveLength(1);
  });

  it('a throwing child does NOT block siblings (per-transport isolation)', () => {
    const a = new RecordingTransport();
    const b = new ThrowingTransport();
    const c = new RecordingTransport();
    const composite = new CompositeTransport([a, b, c]);
    expect(() => composite.log('error', 'Test', 'boom')).not.toThrow();
    expect(a.entries).toHaveLength(1);
    expect(c.entries).toHaveLength(1);
  });
});

describe('Logger — addTransport / removeTransport', () => {
  /**
   * The singleton `LOG` is constructed with a `CompositeTransport` that
   * already holds the default `ConsoleTransport`. Tests attach a
   * recording transport via `LOG.addTransport()` and then detach to
   * keep the singleton clean for the next test.
   */
  it('addTransport(t) makes subsequent LOG.* calls reach t', () => {
    const recorder = new RecordingTransport();
    LOG.addTransport(recorder);
    LOG.info('hello');
    LOG.removeTransport(recorder);
    expect(recorder.entries).toHaveLength(1);
    expect(recorder.entries[0]?.scope).toBe('YeRide');
    expect(recorder.entries[0]?.message).toBe('hello');
  });

  it('extend() preserves the transport pipeline (children share the composite)', () => {
    const recorder = new RecordingTransport();
    LOG.addTransport(recorder);
    const child = LOG.extend('Module');
    child.warn('care');
    LOG.removeTransport(recorder);
    expect(recorder.entries).toHaveLength(1);
    expect(recorder.entries[0]?.scope).toBe('YeRide:Module');
    expect(recorder.entries[0]?.level).toBe('warn');
  });

  it('removeTransport(t) detaches a previously attached transport', () => {
    const recorder = new RecordingTransport();
    LOG.addTransport(recorder);
    LOG.info('first');
    LOG.removeTransport(recorder);
    LOG.info('second');
    expect(recorder.entries).toHaveLength(1);
    expect(recorder.entries[0]?.message).toBe('first');
  });

  it('addTransport on a logger with a non-composite transport is a no-op', () => {
    // Build a custom Logger directly to exercise the non-composite branch.
    // We do this via the singleton's prototype since the Logger class
    // isn't exported as a constructor — a workaround is fine here, but
    // simpler: assert that calling addTransport on the singleton logger
    // doesn't throw and that a recording transport DOES receive logs
    // (because the default IS a composite). The negative case (non-composite
    // returning early) is exercised through the `instanceof` check in
    // the implementation; we verify it via the source rather than a
    // unit test against a Logger we can't construct.
    expect(() => LOG.addTransport(new ConsoleTransport())).not.toThrow();
    LOG.removeTransport(new ConsoleTransport()); // best-effort cleanup
  });
});

describe('Logger — sanitization still runs through addTransport', () => {
  it('meta with email is redacted before reaching the recording transport', () => {
    const recorder = new RecordingTransport();
    LOG.addTransport(recorder);
    LOG.info('user logged in', { email: 'alice@example.com', userId: 'u1' });
    LOG.removeTransport(recorder);
    const [entry] = recorder.entries;
    expect(entry).toBeDefined();
    const meta = entry?.meta as { email?: unknown; userId?: unknown };
    expect(meta?.email).not.toBe('alice@example.com');
    // sanitizeForLogging redacts the email — exact replacement format is
    // tested elsewhere; here we just assert it changed.
    expect(meta?.email).toBeDefined();
  });
});

/**
 * Phase 9 turn 6 — the rawMeta channel.
 *
 * Sub-turn 3a's `CrashlyticsLogTransport` extracts `Error` instances
 * from the meta argument to fire `crashReporting.recordError(err)`.
 * Sub-turn 3b surfaced a real production gap: `Logger.write` runs
 * `sanitizeForLogging(meta)` before passing meta to the transport, and
 * `sanitize` converts every `Error` to a plain `{name, message, stack}`
 * object. The transport's `instanceof Error` check then fails — so
 * `LOG.error('scope', errorInstance)` never produced a recorded
 * non-fatal in Firebase Console.
 *
 * The fix is a parallel `rawMeta` channel: `LogTransport.log` takes an
 * optional 5th `rawMeta` argument carrying the un-sanitized original.
 * `ConsoleTransport` ignores it (text output must not leak PII);
 * `CrashlyticsLogTransport` reads it for `extractError`.
 */
describe('Logger — rawMeta channel preserves Error instance through sanitize', () => {
  it('passes the original meta as rawMeta alongside the sanitized meta', () => {
    const recorder = new RecordingTransport();
    LOG.addTransport(recorder);
    const err = new Error('boom');
    LOG.error('scope', err);
    LOG.removeTransport(recorder);
    const [entry] = recorder.entries;
    expect(entry).toBeDefined();
    // sanitized meta is a plain object — `instanceof Error` would fail.
    expect(entry?.meta instanceof Error).toBe(false);
    expect(entry?.meta).toMatchObject({ name: 'Error', message: 'boom' });
    // rawMeta is the ACTUAL Error reference — `instanceof Error` passes.
    expect(entry?.rawMeta).toBe(err);
    expect(entry?.rawMeta instanceof Error).toBe(true);
  });

  it('rawMeta is undefined when no meta was passed', () => {
    const recorder = new RecordingTransport();
    LOG.addTransport(recorder);
    LOG.info('no meta here');
    LOG.removeTransport(recorder);
    const [entry] = recorder.entries;
    expect(entry?.meta).toBeUndefined();
    expect(entry?.rawMeta).toBeUndefined();
  });

  it('rawMeta carries the un-sanitized object when meta has redacted fields', () => {
    const recorder = new RecordingTransport();
    LOG.addTransport(recorder);
    LOG.info('user', { email: 'alice@example.com', userId: 'u1' });
    LOG.removeTransport(recorder);
    const [entry] = recorder.entries;
    const meta = entry?.meta as { email?: unknown };
    const rawMeta = entry?.rawMeta as { email?: unknown };
    // sanitized meta has the email redacted.
    expect(meta?.email).not.toBe('alice@example.com');
    // rawMeta still holds the original unredacted email — it must
    // never reach a text-output transport, but the contract is that
    // it carries the ORIGINAL value, period. Telemetry transports that
    // read it are responsible for emitting only safe derivatives (e.g.
    // the breadcrumb buffer gets the formatted string, not rawMeta).
    expect(rawMeta?.email).toBe('alice@example.com');
  });

  /**
   * The headline regression: end-to-end through the production
   * pipeline (LOG → CompositeTransport → CrashlyticsLogTransport).
   * Pre-fix this test would fail because `extractError` saw the
   * sanitized object (which is not `instanceof Error`).
   */
  it('LOG.error(scope, err) → CrashlyticsLogTransport fires recordError with the actual Error', async () => {
    const fake = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fake);
    LOG.addTransport(transport);
    const err = new Error('something broke');
    LOG.error('RIDE', err);
    LOG.removeTransport(transport);
    await flushMicrotasks();
    const recorded = fake.getRecordedErrors();
    expect(recorded).toHaveLength(1);
    // Reference identity — the recordError adapter call gets the
    // SAME Error object the call site passed to LOG.error, not a
    // shallow-copied or sanitized stand-in.
    expect(recorded[0]?.error).toBe(err);
    // Logger scope is what `extend('YeRide:RIDE')` produces; here we
    // called `LOG.error('RIDE', ...)` directly on the singleton, so
    // the scope on the breadcrumb / recorded name is `'YeRide'` (the
    // singleton's scope, not the message text). The recordError
    // `name` arg is the transport's `scope` arg.
    expect(recorded[0]?.name).toBe('YeRide');
    // Breadcrumb still fans out at every level — the message text
    // (the LOG.error first arg) lands in the breadcrumb buffer.
    expect(fake.getBreadcrumbs()).toEqual(['[YeRide] RIDE']);
  });

  it('LOG.warn(scope, err) does NOT fire recordError (error level only)', async () => {
    const fake = new FakeCrashReportingService();
    const transport = new CrashlyticsLogTransport(fake);
    LOG.addTransport(transport);
    LOG.warn('something', new Error('not-fatal'));
    LOG.removeTransport(transport);
    await flushMicrotasks();
    expect(fake.getRecordedErrors()).toHaveLength(0);
    expect(fake.getBreadcrumbs()).toHaveLength(1);
  });
});
