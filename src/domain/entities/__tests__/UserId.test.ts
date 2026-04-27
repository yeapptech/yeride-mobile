import { UserId } from '../UserId';

describe('UserId', () => {
  it('accepts a valid 28-character Firebase UID', () => {
    const r = UserId.create('abcdefghijklmnopqrstuvwxyz12');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('abcdefghijklmnopqrstuvwxyz12');
  });

  it('accepts a numeric-heavy UID', () => {
    const r = UserId.create('1234567890123456789012345678');
    expect(r.ok).toBe(true);
  });

  it('rejects shorter strings', () => {
    const r = UserId.create('abc');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('user_id_invalid_length');
  });

  it('rejects longer strings', () => {
    const r = UserId.create('a'.repeat(29));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('user_id_invalid_length');
  });

  it('rejects non-alphanumeric characters', () => {
    const r = UserId.create('abcdefghijklmnopqrstuvwxyz1!');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('user_id_invalid_format');
  });

  it('rejects non-string input', () => {
    const r = UserId.create(12345 as unknown as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('user_id_not_a_string');
  });
});
