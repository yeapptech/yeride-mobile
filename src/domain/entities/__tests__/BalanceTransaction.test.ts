import { BalanceTransaction } from '../BalanceTransaction';
import { Money } from '../Money';

function usd(minor: number): Money {
  const r = Money.create(minor, 'USD');
  if (!r.ok) throw new Error('test setup: money');
  return r.value;
}

describe('BalanceTransaction.create', () => {
  it('accepts a well-formed transaction with net = amount - fee', () => {
    const r = BalanceTransaction.create({
      id: 'txn_1NQ7Vy',
      amount: usd(10000),
      fee: usd(290),
      net: usd(9710),
      createdAt: new Date('2026-04-15T12:00:00Z'),
      type: 'charge',
      tripId: 'trip_abc',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tripId).toBe('trip_abc');
      expect(r.value.type).toBe('charge');
      expect(r.value.net.minorUnits).toBe(9710);
    }
  });

  it('accepts a transaction with null tripId', () => {
    const r = BalanceTransaction.create({
      id: 'txn_2',
      amount: usd(5000),
      fee: usd(0),
      net: usd(5000),
      createdAt: new Date('2026-04-15T12:00:00Z'),
      type: 'transfer',
      tripId: null,
    });
    expect(r.ok).toBe(true);
  });

  it('rejects empty id', () => {
    const r = BalanceTransaction.create({
      id: '',
      amount: usd(1000),
      fee: usd(30),
      net: usd(970),
      createdAt: new Date('2026-04-15T12:00:00Z'),
      type: 'charge',
      tripId: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('balance_txn_invalid_id');
  });

  it('rejects empty type', () => {
    const r = BalanceTransaction.create({
      id: 'txn_1',
      amount: usd(1000),
      fee: usd(30),
      net: usd(970),
      createdAt: new Date('2026-04-15T12:00:00Z'),
      type: '',
      tripId: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('balance_txn_invalid_type');
  });

  it('rejects an invalid Date', () => {
    const r = BalanceTransaction.create({
      id: 'txn_1',
      amount: usd(1000),
      fee: usd(30),
      net: usd(970),
      createdAt: new Date('not-a-date'),
      type: 'charge',
      tripId: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('balance_txn_invalid_created_at');
  });

  it('rejects when net != amount - fee', () => {
    const r = BalanceTransaction.create({
      id: 'txn_1',
      amount: usd(10000),
      fee: usd(290),
      net: usd(9000), // wrong: should be 9710
      createdAt: new Date('2026-04-15T12:00:00Z'),
      type: 'charge',
      tripId: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('balance_txn_invariant_broken');
  });
});
