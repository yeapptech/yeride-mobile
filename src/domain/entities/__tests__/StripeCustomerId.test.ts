import { StripeCustomerId } from '../StripeCustomerId';

describe('StripeCustomerId.create', () => {
  it('accepts a valid Stripe customer id', () => {
    const r = StripeCustomerId.create('cus_NQ7VyhkUx9wQYz');
    expect(r.ok).toBe(true);
    if (r.ok) expect(String(r.value)).toBe('cus_NQ7VyhkUx9wQYz');
  });

  it('rejects non-string input', () => {
    const r = StripeCustomerId.create(42 as unknown as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('stripe_customer_id_not_a_string');
  });

  it('rejects an id missing the cus_ prefix', () => {
    const r = StripeCustomerId.create('acct_NQ7VyhkUx9wQYz');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('stripe_customer_id_invalid_prefix');
  });

  it('rejects an empty string (no prefix)', () => {
    const r = StripeCustomerId.create('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('stripe_customer_id_invalid_prefix');
  });

  it('rejects an id with the prefix but empty body', () => {
    const r = StripeCustomerId.create('cus_');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('stripe_customer_id_invalid_format');
  });

  it('rejects an id with non-alphanumeric body characters', () => {
    const r = StripeCustomerId.create('cus_abc-def');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('stripe_customer_id_invalid_format');
  });

  it('rejects an id whose body exceeds 255 characters', () => {
    const longBody = 'a'.repeat(256);
    const r = StripeCustomerId.create(`cus_${longBody}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('stripe_customer_id_invalid_format');
  });
});
