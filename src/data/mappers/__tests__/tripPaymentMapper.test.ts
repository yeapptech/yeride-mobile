import { parseTripPaymentDoc, toDomain } from '../tripPaymentMapper';

// `amount` on the wire is INTEGER CENTS (Stripe-native), NOT dollars. The
// webhook server (yeride-stripe-server/stripe/routes.js:132) writes the raw
// `pi.amount` from the Stripe PaymentIntent, which is always an integer in
// the smallest currency unit. Tests use integer-cents fixtures throughout.

describe('parseTripPaymentDoc', () => {
  it.each([
    ['fare', 'succeeded'],
    ['tip', 'succeeded'],
    ['refund', 'refunded'],
    ['fare', 'failed'],
  ] as const)('accepts type=%s with status=%s', (type, status) => {
    const r = parseTripPaymentDoc({
      type,
      status,
      amount: 1050, // $10.50 in integer cents
      createdAt: '2026-04-27T12:30:00Z',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects an unknown type', () => {
    const r = parseTripPaymentDoc({
      type: 'bonus',
      status: 'succeeded',
      amount: 100,
      createdAt: '2026-04-27T12:30:00Z',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('trip_payment_doc_invalid_shape');
  });

  it('rejects a negative amount', () => {
    const r = parseTripPaymentDoc({
      type: 'fare',
      status: 'succeeded',
      amount: -1,
      createdAt: '2026-04-27T12:30:00Z',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a non-integer amount (Stripe always writes integer cents)', () => {
    // Phase 9 turn 4 smoke fix #2 — `.int()` on the schema enforces the
    // Stripe contract. A non-integer here would be a wire-format break
    // worth surfacing as a parse failure.
    const r = parseTripPaymentDoc({
      type: 'fare',
      status: 'succeeded',
      amount: 10.5,
      createdAt: '2026-04-27T12:30:00Z',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('trip_payment_doc_invalid_shape');
  });
});

describe('toDomain', () => {
  it('builds a TripPayment with the amount converted from integer cents to Money', () => {
    const docR = parseTripPaymentDoc({
      type: 'fare',
      status: 'succeeded',
      amount: 1234, // $12.34 in integer cents
      createdAt: '2026-04-27T12:30:00Z',
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain('pay_1', docR.value);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.id).toBe('pay_1');
      expect(r.value.amount.format()).toBe('$12.34');
      expect(r.value.type).toBe('fare');
    }
  });

  it('errors on a malformed createdAt', () => {
    const docR = parseTripPaymentDoc({
      type: 'tip',
      status: 'succeeded',
      amount: 200,
      createdAt: 'not-a-date',
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain('p', docR.value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('trip_payment_invalid_created_at');
  });

  // Phase 9 turn 4 smoke fix #2 — pre-fix the mapper used `Money.fromMajor`
  // which interpreted `amount` as dollars. A real-user smoke surfaced
  // $5 charges rendering as $500 on the receipt:
  // amount=500 (cents) → fromMajor(500) → 50000 minor units → "$500.00".
  // This regression test pins the cents interpretation: amount=500 must
  // render as "$5.00".
  it("regression: amount=500 (cents) renders as '$5.00' (cents-not-dollars contract)", () => {
    const docR = parseTripPaymentDoc({
      type: 'fare',
      status: 'succeeded',
      amount: 500,
      createdAt: '2026-04-27T12:30:00Z',
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain('pay_500', docR.value);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.amount.format()).toBe('$5.00');
    }
  });

  it("regression: tip amount=500 (cents) renders as '$5.00'", () => {
    const docR = parseTripPaymentDoc({
      type: 'tip',
      status: 'succeeded',
      amount: 500,
      createdAt: '2026-04-27T12:30:00Z',
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain('tip_500', docR.value);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.amount.format()).toBe('$5.00');
      expect(r.value.type).toBe('tip');
    }
  });
});

// Phase 9 Turn 7 — paymentMethodId join key for the receipt screen.
// The webhook server writes `pi.payment_method` as `paymentMethodId` on
// fare + tip charges. Refund rows + legacy pre-Turn-7 fare rows omit
// the field. The mapper accepts missing as null, parses canonical
// `pm_…` ids to the branded VO, and falls back to null with LOG.warn
// on malformed values.
describe('toDomain — paymentMethodId join key', () => {
  it('parses a canonical pm_… id to a branded PaymentMethodId', () => {
    const docR = parseTripPaymentDoc({
      type: 'fare',
      status: 'succeeded',
      amount: 1234,
      createdAt: '2026-04-27T12:30:00Z',
      paymentMethodId: 'pm_1ABcdEFghIJkLmNoP',
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain('pay_1', docR.value);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(String(r.value.paymentMethodId)).toBe('pm_1ABcdEFghIJkLmNoP');
    }
  });

  it('returns null when the wire payload omits paymentMethodId (refund / legacy)', () => {
    const docR = parseTripPaymentDoc({
      type: 'refund',
      status: 'refunded',
      amount: 500,
      createdAt: '2026-04-27T12:30:00Z',
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain('refund_1', docR.value);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.paymentMethodId).toBeNull();
    }
  });

  it('returns null when the wire payload sets paymentMethodId to null', () => {
    // The DTO's `nullish()` accepts both undefined and null. A null on
    // the wire (some webhook code paths emit `customerId: null`) hydrates
    // the same as a missing field.
    const docR = parseTripPaymentDoc({
      type: 'fare',
      status: 'succeeded',
      amount: 500,
      createdAt: '2026-04-27T12:30:00Z',
      paymentMethodId: null,
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain('pay_null', docR.value);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.paymentMethodId).toBeNull();
    }
  });

  it('falls back to null when paymentMethodId is malformed (legacy resilience)', () => {
    // A `pm_…` id without the canonical prefix is a wire-format break,
    // but we don't want to fail the entire payment row over it — the
    // amount + status are still valid and the receipt should render
    // (with a brand-agnostic fallback).
    const docR = parseTripPaymentDoc({
      type: 'fare',
      status: 'succeeded',
      amount: 1234,
      createdAt: '2026-04-27T12:30:00Z',
      paymentMethodId: 'pi_NotAPaymentMethod',
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain('pay_bad', docR.value);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.paymentMethodId).toBeNull();
    }
  });

  it('rejects an empty-string paymentMethodId at the schema layer', () => {
    // Zod's `.min(1)` rejects empty strings before they reach the
    // mapper. Surface as a parse failure so we know the wire shape is
    // off rather than silently coercing to null.
    const r = parseTripPaymentDoc({
      type: 'fare',
      status: 'succeeded',
      amount: 1234,
      createdAt: '2026-04-27T12:30:00Z',
      paymentMethodId: '',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('trip_payment_doc_invalid_shape');
  });
});
