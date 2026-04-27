import { Result } from '../Result';

describe('Result', () => {
  describe('ok / err constructors', () => {
    it('produces a success result', () => {
      const r = Result.ok(42);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(42);
    });

    it('produces an error result', () => {
      const r = Result.err(new Error('boom'));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toBe('boom');
    });
  });

  describe('map', () => {
    it('maps the success value', () => {
      const r = Result.map(Result.ok(2), (n) => n * 3);
      expect(r).toEqual({ ok: true, value: 6 });
    });

    it('passes errors through unchanged', () => {
      const original = Result.err('e');
      const r = Result.map(original, (n: number) => n * 3);
      expect(r).toBe(original);
    });
  });

  describe('flatMap', () => {
    it('chains successful operations', () => {
      const r = Result.flatMap(Result.ok(2), (n) => Result.ok(n + 1));
      expect(r).toEqual({ ok: true, value: 3 });
    });

    it('short-circuits on the first error', () => {
      const calls: number[] = [];
      const r = Result.flatMap(Result.err('first'), (n: number) => {
        calls.push(n);
        return Result.ok(n);
      });
      expect(calls).toEqual([]);
      expect(r).toEqual({ ok: false, error: 'first' });
    });

    it('returns the inner error if the chained call fails', () => {
      const r = Result.flatMap(Result.ok(2), (_n) => Result.err('inner'));
      expect(r).toEqual({ ok: false, error: 'inner' });
    });
  });

  describe('tap', () => {
    it('runs side effects on success', () => {
      let seen = 0;
      const r = Result.tap(Result.ok(7), (n) => {
        seen = n;
      });
      expect(seen).toBe(7);
      expect(r).toEqual({ ok: true, value: 7 });
    });

    it('does not run side effects on error', () => {
      let seen = 0;
      Result.tap(Result.err('e'), (n: number) => {
        seen = n;
      });
      expect(seen).toBe(0);
    });
  });

  describe('all', () => {
    it('combines successful results into a tuple', () => {
      const r = Result.all([Result.ok(1), Result.ok('x'), Result.ok(true)]);
      expect(r).toEqual({ ok: true, value: [1, 'x', true] });
    });

    it('returns the first error when any input fails', () => {
      const r = Result.all<readonly [number, string], string>([
        Result.ok(1),
        Result.err('second-failed'),
      ]);
      expect(r).toEqual({ ok: false, error: 'second-failed' });
    });

    it('handles an empty input', () => {
      const r = Result.all([]);
      expect(r).toEqual({ ok: true, value: [] });
    });
  });

  describe('fromThrowable', () => {
    it('captures successful return values', () => {
      const r = Result.fromThrowable(
        () => JSON.parse('{"x":1}') as { x: number },
        (e) => e,
      );
      expect(r).toEqual({ ok: true, value: { x: 1 } });
    });

    it('captures thrown errors', () => {
      const r = Result.fromThrowable(
        () => {
          throw new Error('bad');
        },
        (e) => (e as Error).message,
      );
      expect(r).toEqual({ ok: false, error: 'bad' });
    });
  });
});
