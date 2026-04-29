import { Money } from '../Money';
import { Payout, type PayoutStatus } from '../Payout';

function usd(minor: number): Money {
  const r = Money.create(minor, 'USD');
  if (!r.ok) throw new Error('test setup: money');
  return r.value;
}

describe('Payout.create', () => {
  it('accepts a well-formed payout', () => {
    const r = Payout.create({
      id: 'po_1NQ7Vy',
      amount: usd(15000),
      status: 'paid',
      arrivalDate: new Date('2026-04-15T00:00:00Z'),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.id).toBe('po_1NQ7Vy');
      expect(r.value.amount.minorUnits).toBe(15000);
      expect(r.value.status).toBe('paid');
    }
  });

  it.each<PayoutStatus>([
    'paid',
    'pending',
    'in_transit',
    'failed',
    'canceled',
  ])('accepts canonical status %s', (status) => {
    const r = Payout.create({
      id: 'po_1',
      amount: usd(1000),
      status,
      arrivalDate: new Date('2026-04-15T00:00:00Z'),
    });
    expect(r.ok).toBe(true);
  });

  it('rejects empty id', () => {
    const r = Payout.create({
      id: '',
      amount: usd(1000),
      status: 'paid',
      arrivalDate: new Date('2026-04-15T00:00:00Z'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payout_invalid_id');
  });

  it('rejects unknown status', () => {
    const r = Payout.create({
      id: 'po_1',
      amount: usd(1000),
      status: 'paid_in_full' as unknown as PayoutStatus,
      arrivalDate: new Date('2026-04-15T00:00:00Z'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payout_invalid_status');
  });

  it('rejects an invalid Date', () => {
    const r = Payout.create({
      id: 'po_1',
      amount: usd(1000),
      status: 'paid',
      arrivalDate: new Date('not-a-date'),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('payout_invalid_arrival_date');
  });
});
