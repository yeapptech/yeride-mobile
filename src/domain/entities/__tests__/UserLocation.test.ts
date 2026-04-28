import { Coordinates } from '../Coordinates';
import { RideId } from '../RideId';
import { UserId } from '../UserId';
import { UserLocation } from '../UserLocation';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const USER = unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
const TRIP = unwrap(RideId.create('tripIdAbcDef1234567890'));
const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));

describe('UserLocation.create', () => {
  it('constructs from minimal valid props (no tripTracking)', () => {
    const r = UserLocation.create({
      userId: USER,
      location: MIAMI,
      speed: null,
      updatedAt: new Date('2026-04-27T12:00:00Z'),
      tripTracking: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.speed).toBeNull();
      expect(r.value.tripTracking).toBeNull();
    }
  });

  it('accepts a record with active trip tracking', () => {
    const r = UserLocation.create({
      userId: USER,
      location: MIAMI,
      speed: 12.5,
      updatedAt: new Date('2026-04-27T12:00:00Z'),
      tripTracking: {
        tripId: TRIP,
        tripStatus: 'dispatched',
        destination: { type: 'pickup', location: FORT_LAUDERDALE },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tripTracking?.tripStatus).toBe('dispatched');
      expect(r.value.tripTracking?.destination.type).toBe('pickup');
    }
  });

  it('rejects negative speed', () => {
    const r = UserLocation.create({
      userId: USER,
      location: MIAMI,
      speed: -1,
      updatedAt: new Date(),
      tripTracking: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('user_location_invalid_speed');
  });

  it('rejects non-finite speed', () => {
    const r = UserLocation.create({
      userId: USER,
      location: MIAMI,
      speed: Number.POSITIVE_INFINITY,
      updatedAt: new Date(),
      tripTracking: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('user_location_invalid_speed');
  });

  it('rejects an invalid updatedAt', () => {
    const r = UserLocation.create({
      userId: USER,
      location: MIAMI,
      speed: null,
      updatedAt: new Date('not-a-date'),
      tripTracking: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('user_location_invalid_updated_at');
  });
});
