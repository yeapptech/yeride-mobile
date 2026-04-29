import { PaymentMethodId } from '../PaymentMethodId';

describe('PaymentMethodId.create', () => {
  it('accepts a valid Stripe payment method id', () => {
    const r = PaymentMethodId.create('pm_1NQ7VyKZ0vjV3xHjzYbq2cDe');
    expect(r.ok).toBe(true);
    if (r.ok) expect(String(r.value)).toBe('pm_1NQ7VyKZ0vjV3xHjzYbq2cDe');
  });

  it('rejects non-string input', () => {
    const r = PaymentMethodId.create(undefined as unknown as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_method_id_not_a_string');
  });

  it('rejects an id missing the pm_ prefix', () => {
    const r = PaymentMethodId.create('card_1NQ7Vy');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_method_id_invalid_prefix');
  });

  it('rejects an empty string (no prefix)', () => {
    const r = PaymentMethodId.create('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_method_id_invalid_prefix');
  });

  it('rejects an id with the prefix but empty body', () => {
    const r = PaymentMethodId.create('pm_');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_method_id_invalid_format');
  });

  it('rejects an id with non-alphanumeric body characters', () => {
    const r = PaymentMethodId.create('pm_abc_def');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_method_id_invalid_format');
  });

  it('rejects an id whose body exceeds 255 characters', () => {
    const longBody = 'a'.repeat(256);
    const r = PaymentMethodId.create(`pm_${longBody}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_method_id_invalid_format');
  });
});
