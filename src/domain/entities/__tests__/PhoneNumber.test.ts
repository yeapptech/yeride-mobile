import { PhoneNumber } from '../PhoneNumber';

describe('PhoneNumber', () => {
  it('accepts a clean E.164 number', () => {
    const r = PhoneNumber.create('+14155550123');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value).toBe('+14155550123');
  });

  it('strips formatting characters', () => {
    const r = PhoneNumber.create('+1 (415) 555-0123');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value).toBe('+14155550123');
  });

  it('handles dots and dashes', () => {
    const r = PhoneNumber.create('+1.415.555.0123');
    if (r.ok) expect(r.value.value).toBe('+14155550123');
  });

  it('rejects numbers without a leading +', () => {
    const r = PhoneNumber.create('14155550123');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('phone_missing_country_code');
  });

  it('rejects numbers shorter than 7 digits', () => {
    const r = PhoneNumber.create('+12345');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('phone_too_short');
  });

  it('rejects numbers longer than 15 digits', () => {
    const r = PhoneNumber.create('+1234567890123456');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('phone_too_long');
  });

  it('rejects empty string', () => {
    const r = PhoneNumber.create('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('phone_empty');
  });

  it('rejects non-string input', () => {
    const r = PhoneNumber.create(15555550123 as unknown as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('phone_not_a_string');
  });

  it('compares by canonical value', () => {
    const a = PhoneNumber.create('+14155550123');
    const b = PhoneNumber.create('+1 (415) 555-0123');
    if (a.ok && b.ok) expect(a.value.equals(b.value)).toBe(true);
  });
});
