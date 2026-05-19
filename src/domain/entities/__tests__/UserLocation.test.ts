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

  it('accepts a record with active trip tracking (no live telemetry yet)', () => {
    const r = UserLocation.create({
      userId: USER,
      location: MIAMI,
      speed: 12.5,
      updatedAt: new Date('2026-04-27T12:00:00Z'),
      tripTracking: {
        tripId: TRIP,
        tripStatus: 'dispatched',
        destination: { type: 'pickup', location: FORT_LAUDERDALE },
        distanceMeters: null,
        durationSeconds: null,
        updatedAt: null,
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tripTracking?.tripStatus).toBe('dispatched');
      expect(r.value.tripTracking?.destination.type).toBe('pickup');
      expect(r.value.tripTracking?.distanceMeters).toBeNull();
      expect(r.value.tripTracking?.durationSeconds).toBeNull();
      expect(r.value.tripTracking?.updatedAt).toBeNull();
    }
  });

  // Phase 10 turn 5 — live-ETA telemetry coverage.
  it('accepts a record with live NavSdk telemetry populated', () => {
    const calculatedAt = new Date('2026-04-27T12:00:05Z');
    const r = UserLocation.create({
      userId: USER,
      location: MIAMI,
      speed: 12.5,
      updatedAt: new Date('2026-04-27T12:00:05Z'),
      tripTracking: {
        tripId: TRIP,
        tripStatus: 'started',
        destination: { type: 'dropoff', location: FORT_LAUDERDALE },
        distanceMeters: 4250,
        durationSeconds: 420,
        updatedAt: calculatedAt,
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tripTracking?.distanceMeters).toBe(4250);
      expect(r.value.tripTracking?.durationSeconds).toBe(420);
      expect(r.value.tripTracking?.updatedAt).toEqual(calculatedAt);
    }
  });

  it('rejects negative tripTracking.distanceMeters', () => {
    const r = UserLocation.create({
      userId: USER,
      location: MIAMI,
      speed: null,
      updatedAt: new Date(),
      tripTracking: {
        tripId: TRIP,
        tripStatus: 'dispatched',
        destination: { type: 'pickup', location: FORT_LAUDERDALE },
        distanceMeters: -1,
        durationSeconds: 0,
        updatedAt: new Date(),
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('trip_tracking_invalid_distance');
  });

  it('rejects non-finite tripTracking.durationSeconds', () => {
    const r = UserLocation.create({
      userId: USER,
      location: MIAMI,
      speed: null,
      updatedAt: new Date(),
      tripTracking: {
        tripId: TRIP,
        tripStatus: 'dispatched',
        destination: { type: 'pickup', location: FORT_LAUDERDALE },
        distanceMeters: 100,
        durationSeconds: Number.POSITIVE_INFINITY,
        updatedAt: new Date(),
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('trip_tracking_invalid_duration');
  });

  it('rejects an invalid tripTracking.updatedAt', () => {
    const r = UserLocation.create({
      userId: USER,
      location: MIAMI,
      speed: null,
      updatedAt: new Date(),
      tripTracking: {
        tripId: TRIP,
        tripStatus: 'dispatched',
        destination: { type: 'pickup', location: FORT_LAUDERDALE },
        distanceMeters: 100,
        durationSeconds: 60,
        updatedAt: new Date('not-a-date'),
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('trip_tracking_invalid_updated_at');
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
