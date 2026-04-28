import { RideStatus } from '../RideStatus';

describe('RideStatus.parse', () => {
  it.each([
    'awaiting_driver',
    'scheduled',
    'scheduled_driver_accepted',
    'dispatched',
    'started',
    'payment_requested',
    'completed',
    'payment_failed',
    'cancelled',
  ] as const)('accepts %s', (s) => {
    const r = RideStatus.parse(s);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(s);
  });

  it('rejects an unknown string', () => {
    const r = RideStatus.parse('in_flight');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_status_unknown');
  });

  it('rejects non-string input', () => {
    const r = RideStatus.parse(42);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_status_not_a_string');
  });
});

describe('RideStatus.isActive', () => {
  it('returns true for in-progress states', () => {
    expect(RideStatus.isActive('awaiting_driver')).toBe(true);
    expect(RideStatus.isActive('dispatched')).toBe(true);
    expect(RideStatus.isActive('started')).toBe(true);
    expect(RideStatus.isActive('payment_requested')).toBe(true);
    expect(RideStatus.isActive('payment_failed')).toBe(true);
  });

  it('returns false for terminal states', () => {
    expect(RideStatus.isActive('completed')).toBe(false);
    expect(RideStatus.isActive('cancelled')).toBe(false);
  });
});

describe('RideStatus.isTerminal', () => {
  it('returns true for completed and cancelled', () => {
    expect(RideStatus.isTerminal('completed')).toBe(true);
    expect(RideStatus.isTerminal('cancelled')).toBe(true);
  });

  it('returns false for in-flight states', () => {
    expect(RideStatus.isTerminal('started')).toBe(false);
    expect(RideStatus.isTerminal('payment_requested')).toBe(false);
  });
});
