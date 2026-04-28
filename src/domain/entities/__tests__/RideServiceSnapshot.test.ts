import { Money } from '../Money';
import { RideServiceId } from '../RideServiceId';
import { RideServiceSnapshot } from '../RideServiceSnapshot';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(major: number) {
  return unwrap(Money.fromMajor(major, 'USD'));
}

const VALID = {
  id: unwrap(RideServiceId.create('economy')),
  name: 'Economy',
  baseFare: usd(2.5),
  minimumFare: usd(5),
  cancelationFee: usd(2),
  costPerKm: usd(1.25),
  costPerMinute: usd(0.2),
  seatCapacity: 4,
};

describe('RideServiceSnapshot', () => {
  it('constructs from valid props', () => {
    const r = RideServiceSnapshot.create(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(String(r.value.id)).toBe('economy');
      expect(r.value.baseFare.format()).toBe('$2.50');
      expect(r.value.seatCapacity).toBe(4);
    }
  });

  it('rejects seatCapacity below 1', () => {
    const r = RideServiceSnapshot.create({ ...VALID, seatCapacity: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.error.code).toBe('ride_service_snapshot_invalid_seat_capacity');
  });

  it('rejects an empty name', () => {
    const r = RideServiceSnapshot.create({ ...VALID, name: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ride_service_snapshot_empty_name');
  });
});
