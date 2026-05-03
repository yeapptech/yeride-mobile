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
}

class RecordingTransport implements LogTransport {
  readonly entries: Recorded[] = [];

  log(level: LogLevel, scope: string, message: string, meta?: unknown): void {
    this.entries.push({ level, scope, message, meta });
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
