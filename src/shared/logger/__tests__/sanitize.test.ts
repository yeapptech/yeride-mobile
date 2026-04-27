import { sanitizeForLogging } from '../sanitize';

describe('sanitizeForLogging', () => {
  it('passes through primitives untouched', () => {
    expect(sanitizeForLogging(42)).toBe(42);
    expect(sanitizeForLogging(true)).toBe(true);
    expect(sanitizeForLogging(null)).toBe(null);
    expect(sanitizeForLogging(undefined)).toBe(undefined);
  });

  it('redacts top-level sensitive keys', () => {
    const out = sanitizeForLogging({
      email: 'foo@bar.com',
      password: 'hunter2',
      role: 'rider',
    });
    expect(out).toEqual({
      email: '[REDACTED]',
      password: '[REDACTED]',
      role: 'rider',
    });
  });

  it('case-insensitive key matching', () => {
    const out = sanitizeForLogging({
      Email: 'foo@bar.com',
      PUSHTOKEN: 'abc',
      AvatarURL: 'http://x',
    }) as Record<string, unknown>;
    expect(out['Email']).toBe('[REDACTED]');
    expect(out['PUSHTOKEN']).toBe('[REDACTED]');
    expect(out['AvatarURL']).toBe('[REDACTED]');
  });

  it('redacts nested sensitive keys', () => {
    const out = sanitizeForLogging({
      user: { id: 'u1', email: 'foo@bar.com' },
      meta: { phone: '+1' },
    }) as { user: Record<string, unknown>; meta: Record<string, unknown> };
    expect(out.user['id']).toBe('u1');
    expect(out.user['email']).toBe('[REDACTED]');
    expect(out.meta['phone']).toBe('[REDACTED]');
  });

  it('walks into arrays', () => {
    const out = sanitizeForLogging([
      { id: 1, email: 'a@b.com' },
      { id: 2, email: 'c@d.com' },
    ]) as Array<Record<string, unknown>>;
    expect(out[0]?.['email']).toBe('[REDACTED]');
    expect(out[1]?.['id']).toBe(2);
  });

  it('truncates long strings', () => {
    const long = 'x'.repeat(1000);
    const out = sanitizeForLogging(long, { maxStringLength: 50 }) as string;
    expect(out.length).toBe(51 + '…[truncated]'.length - 1); // 50 chars + ellipsis tag
    expect(out.startsWith('xxx')).toBe(true);
    expect(out.endsWith('[truncated]')).toBe(true);
  });

  it('renders Error instances as plain objects', () => {
    const e = new Error('boom');
    const out = sanitizeForLogging(e) as { name: string; message: string };
    expect(out.name).toBe('Error');
    expect(out.message).toBe('boom');
  });

  it('stops at maxDepth', () => {
    const deep: Record<string, unknown> = { v: 1 };
    let cur: Record<string, unknown> = deep;
    for (let i = 0; i < 10; i++) {
      const next: Record<string, unknown> = { v: i };
      cur['child'] = next;
      cur = next;
    }
    const out = sanitizeForLogging(deep, { maxDepth: 2 });
    expect(JSON.stringify(out)).toContain('[truncated:depth]');
  });

  it('flags non-plain objects defensively', () => {
    class Foo {
      readonly x = 1;
    }
    const out = sanitizeForLogging(new Foo());
    expect(out).toBe('[unloggable:object]');
  });
});
