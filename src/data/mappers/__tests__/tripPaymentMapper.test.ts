import { parseTripPaymentDoc, toDomain } from '../tripPaymentMapper';

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
      amount: 10.5,
      createdAt: '2026-04-27T12:30:00Z',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects an unknown type', () => {
    const r = parseTripPaymentDoc({
      type: 'bonus',
      status: 'succeeded',
      amount: 1,
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
});

describe('toDomain', () => {
  it('builds a TripPayment with the amount converted to Money', () => {
    const docR = parseTripPaymentDoc({
      type: 'fare',
      status: 'succeeded',
      amount: 12.34,
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
      amount: 2,
      createdAt: 'not-a-date',
    });
    if (!docR.ok) throw docR.error;
    const r = toDomain('p', docR.value);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('trip_payment_invalid_created_at');
  });
});
