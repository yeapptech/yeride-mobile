import {
  isKnownPaymentFailureCode,
  KNOWN_PAYMENT_FAILURE_CODES,
  PaymentFailure,
} from '../PaymentFailure';

const T_OCCURRED = new Date('2026-05-26T12:00:00Z');

describe('PaymentFailure.create', () => {
  it('accepts a well-formed failure with a known catalog code', () => {
    const r = PaymentFailure.create({
      code: 'trip_missing_payment_method',
      message: 'passenger.defaultPaymentMethod.id is missing',
      occurredAt: T_OCCURRED,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.code).toBe('trip_missing_payment_method');
      expect(r.value.message).toBe(
        'passenger.defaultPaymentMethod.id is missing',
      );
      expect(r.value.occurredAt).toEqual(T_OCCURRED);
      expect(r.value.isKnown()).toBe(true);
    }
  });

  it('accepts an unknown code without rejecting (forward compat)', () => {
    const r = PaymentFailure.create({
      code: 'a_future_server_code_not_in_catalog',
      message: 'something happened',
      occurredAt: T_OCCURRED,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.isKnown()).toBe(false);
    }
  });

  it('accepts an empty message (server may emit sparse errors)', () => {
    const r = PaymentFailure.create({
      code: 'payment_processing_unknown',
      message: '',
      occurredAt: T_OCCURRED,
    });
    expect(r.ok).toBe(true);
  });

  it('rejects an empty code', () => {
    const r = PaymentFailure.create({
      code: '',
      message: 'x',
      occurredAt: T_OCCURRED,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_failure_empty_code');
  });

  it('rejects a non-string code', () => {
    const r = PaymentFailure.create({
      code: 42 as unknown as string,
      message: 'x',
      occurredAt: T_OCCURRED,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_failure_code_not_a_string');
  });

  it('rejects a code longer than 128 chars', () => {
    const r = PaymentFailure.create({
      code: 'a'.repeat(129),
      message: 'x',
      occurredAt: T_OCCURRED,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_failure_code_too_long');
  });

  it('rejects a non-string message', () => {
    const r = PaymentFailure.create({
      code: 'card_declined',
      message: 42 as unknown as string,
      occurredAt: T_OCCURRED,
    });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error.code).toBe('payment_failure_message_not_a_string');
  });

  it('rejects a message longer than 1024 chars', () => {
    const r = PaymentFailure.create({
      code: 'card_declined',
      message: 'a'.repeat(1025),
      occurredAt: T_OCCURRED,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_failure_message_too_long');
  });

  it('rejects a non-Date occurredAt', () => {
    const r = PaymentFailure.create({
      code: 'card_declined',
      message: 'x',
      occurredAt: 'not-a-date' as unknown as Date,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_failure_invalid_occurred_at');
  });

  it('rejects an Invalid Date instance', () => {
    const r = PaymentFailure.create({
      code: 'card_declined',
      message: 'x',
      occurredAt: new Date('not-a-real-date'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payment_failure_invalid_occurred_at');
  });
});

describe('PaymentFailure.equals', () => {
  it('returns true for identical props', () => {
    const a = PaymentFailure.create({
      code: 'card_declined',
      message: 'Your card was declined.',
      occurredAt: T_OCCURRED,
    });
    const b = PaymentFailure.create({
      code: 'card_declined',
      message: 'Your card was declined.',
      occurredAt: new Date('2026-05-26T12:00:00Z'),
    });
    if (!a.ok || !b.ok) throw new Error('test setup: create failed');
    expect(a.value.equals(b.value)).toBe(true);
  });

  it('returns false when code differs', () => {
    const a = PaymentFailure.create({
      code: 'card_declined',
      message: 'x',
      occurredAt: T_OCCURRED,
    });
    const b = PaymentFailure.create({
      code: 'expired_card',
      message: 'x',
      occurredAt: T_OCCURRED,
    });
    if (!a.ok || !b.ok) throw new Error('test setup: create failed');
    expect(a.value.equals(b.value)).toBe(false);
  });

  it('returns false when occurredAt differs', () => {
    const a = PaymentFailure.create({
      code: 'card_declined',
      message: 'x',
      occurredAt: T_OCCURRED,
    });
    const b = PaymentFailure.create({
      code: 'card_declined',
      message: 'x',
      occurredAt: new Date('2026-05-26T13:00:00Z'),
    });
    if (!a.ok || !b.ok) throw new Error('test setup: create failed');
    expect(a.value.equals(b.value)).toBe(false);
  });
});

describe('isKnownPaymentFailureCode', () => {
  it.each(KNOWN_PAYMENT_FAILURE_CODES)('returns true for %s', (code) => {
    expect(isKnownPaymentFailureCode(code)).toBe(true);
  });

  it('returns false for an unknown string', () => {
    expect(isKnownPaymentFailureCode('not_in_catalog')).toBe(false);
  });

  it('returns false for the empty string', () => {
    expect(isKnownPaymentFailureCode('')).toBe(false);
  });
});
