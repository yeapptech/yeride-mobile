import { StripeAccountId } from '../StripeAccountId';

describe('StripeAccountId.create', () => {
  it('accepts a valid Stripe Connect account id', () => {
    const r = StripeAccountId.create('acct_1ABC234DEFghij5K');
    expect(r.ok).toBe(true);
    if (r.ok) expect(String(r.value)).toBe('acct_1ABC234DEFghij5K');
  });

  it('rejects non-string input', () => {
    const r = StripeAccountId.create(null as unknown as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('stripe_account_id_not_a_string');
  });

  it('rejects an id missing the acct_ prefix', () => {
    const r = StripeAccountId.create('cus_1ABC234DEFghij5K');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('stripe_account_id_invalid_prefix');
  });

  it('rejects an empty string (no prefix)', () => {
    const r = StripeAccountId.create('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('stripe_account_id_invalid_prefix');
  });

  it('rejects an id with the prefix but empty body', () => {
    const r = StripeAccountId.create('acct_');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('stripe_account_id_invalid_format');
  });

  it('rejects an id with non-alphanumeric body characters', () => {
    const r = StripeAccountId.create('acct_abc def');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('stripe_account_id_invalid_format');
  });

  it('rejects an id whose body exceeds 255 characters', () => {
    const longBody = 'a'.repeat(256);
    const r = StripeAccountId.create(`acct_${longBody}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('stripe_account_id_invalid_format');
  });
});
