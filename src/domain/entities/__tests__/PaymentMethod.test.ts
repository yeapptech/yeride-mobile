import { PaymentMethod, normalizeCardBrand } from '../PaymentMethod';
import { PaymentMethodId } from '../PaymentMethodId';

function id(): PaymentMethodId {
  const r = PaymentMethodId.create('pm_1NQ7VyKZ0vjV3xHjzYbq2cDe');
  if (!r.ok) throw new Error('test setup: id failed');
  return r.value;
}

describe('PaymentMethod.create', () => {
  it('accepts a well-formed payment method', () => {
    const r = PaymentMethod.create({
      id: id(),
      brand: 'visa',
      last4: '4242',
      expiry: { month: 12, year: 2030 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.brand).toBe('visa');
      expect(r.value.last4).toBe('4242');
      expect(r.value.expiry).toEqual({ month: 12, year: 2030 });
    }
  });

  it('rejects last4 with non-digit characters', () => {
    const r = PaymentMethod.create({
      id: id(),
      brand: 'visa',
      last4: '12a4',
      expiry: { month: 1, year: 2030 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_method_invalid_last4');
  });

  it('rejects last4 not exactly 4 digits', () => {
    const r = PaymentMethod.create({
      id: id(),
      brand: 'visa',
      last4: '12345',
      expiry: { month: 1, year: 2030 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_method_invalid_last4');
  });

  it('rejects expiry month out of range (0)', () => {
    const r = PaymentMethod.create({
      id: id(),
      brand: 'visa',
      last4: '4242',
      expiry: { month: 0, year: 2030 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_method_invalid_expiry_month');
  });

  it('rejects expiry month out of range (13)', () => {
    const r = PaymentMethod.create({
      id: id(),
      brand: 'visa',
      last4: '4242',
      expiry: { month: 13, year: 2030 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_method_invalid_expiry_month');
  });

  it('rejects non-integer expiry month', () => {
    const r = PaymentMethod.create({
      id: id(),
      brand: 'visa',
      last4: '4242',
      expiry: { month: 6.5, year: 2030 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_method_invalid_expiry_month');
  });

  it('rejects 2-digit expiry year', () => {
    const r = PaymentMethod.create({
      id: id(),
      brand: 'visa',
      last4: '4242',
      expiry: { month: 6, year: 30 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_method_invalid_expiry_year');
  });

  it('rejects expiry year before 2000', () => {
    const r = PaymentMethod.create({
      id: id(),
      brand: 'visa',
      last4: '4242',
      expiry: { month: 6, year: 1999 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_method_invalid_expiry_year');
  });

  it('does not reject an already-expired card (UI surfaces this separately)', () => {
    const r = PaymentMethod.create({
      id: id(),
      brand: 'visa',
      last4: '4242',
      expiry: { month: 1, year: 2020 },
    });
    expect(r.ok).toBe(true);
  });
});

describe('PaymentMethod.isExpired', () => {
  function pm(month: number, year: number): PaymentMethod {
    const r = PaymentMethod.create({
      id: id(),
      brand: 'visa',
      last4: '4242',
      expiry: { month, year },
    });
    if (!r.ok) throw new Error('test setup: pm failed');
    return r.value;
  }

  it('is not expired the day before the cutover', () => {
    // Card 12/2026 → cutover 2027-01-01 UTC.
    const card = pm(12, 2026);
    expect(card.isExpired(new Date('2026-12-31T23:59:59.999Z'))).toBe(false);
  });

  it('is expired at the start of the cutover month', () => {
    const card = pm(12, 2026);
    expect(card.isExpired(new Date('2027-01-01T00:00:00.000Z'))).toBe(true);
  });

  it('rolls over at end of December (month 12 → next year January)', () => {
    const card = pm(12, 2026);
    // Last second of December 2026 still valid.
    expect(card.isExpired(new Date('2026-12-31T23:59:59.000Z'))).toBe(false);
    // First instant of January 2027 expired.
    expect(card.isExpired(new Date('2027-01-01T00:00:00.000Z'))).toBe(true);
  });
});

describe('normalizeCardBrand', () => {
  it.each([
    'visa',
    'mastercard',
    'amex',
    'discover',
    'diners',
    'jcb',
    'unionpay',
  ])('preserves known brand %s', (brand) => {
    expect(normalizeCardBrand(brand)).toBe(brand);
  });

  it('lowercases mixed-case input', () => {
    expect(normalizeCardBrand('Visa')).toBe('visa');
    expect(normalizeCardBrand('MASTERCARD')).toBe('mastercard');
  });

  it('coerces unknown strings to "unknown"', () => {
    expect(normalizeCardBrand('mystery_card')).toBe('unknown');
  });

  it('coerces null/undefined/non-string to "unknown"', () => {
    expect(normalizeCardBrand(null)).toBe('unknown');
    expect(normalizeCardBrand(undefined)).toBe('unknown');
    expect(normalizeCardBrand(42 as unknown as string)).toBe('unknown');
  });
});
