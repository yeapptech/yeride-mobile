import { Coordinates } from '@domain/entities/Coordinates';
import { RideId } from '@domain/entities/RideId';
import { UserId } from '@domain/entities/UserId';
import { UserLocation } from '@domain/entities/UserLocation';

import { parseUserLocationDoc, toDoc, toDomain } from '../userLocationMapper';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const USER_ID_STR = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TRIP_ID_STR = 'tripIdAbcDef1234567890';
const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));

describe('parseUserLocationDoc', () => {
  it('accepts a minimal location doc', () => {
    const r = parseUserLocationDoc({
      latitude: 25.7617,
      longitude: -80.1918,
      updatedAt: '2026-04-27T12:00:00Z',
    });
    expect(r.ok).toBe(true);
  });

  it('accepts a doc with optional speed + tripTracking', () => {
    const r = parseUserLocationDoc({
      latitude: 25.7617,
      longitude: -80.1918,
      speed: 12.5,
      updatedAt: '2026-04-27T12:00:00Z',
      tripTracking: {
        tripId: TRIP_ID_STR,
        tripStatus: 'started',
        destination: {
          type: 'dropoff',
          latitude: 26.1224,
          longitude: -80.1373,
        },
      },
    });
    expect(r.ok).toBe(true);
  });

  it('rejects an out-of-range latitude', () => {
    const r = parseUserLocationDoc({
      latitude: 95,
      longitude: 0,
      updatedAt: '2026-04-27T12:00:00Z',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects an unknown tripStatus', () => {
    const r = parseUserLocationDoc({
      latitude: 25.7617,
      longitude: -80.1918,
      updatedAt: '2026-04-27T12:00:00Z',
      tripTracking: {
        tripId: TRIP_ID_STR,
        tripStatus: 'awaiting_driver',
        destination: { type: 'pickup', latitude: 0, longitude: 0 },
      },
    });
    expect(r.ok).toBe(false);
  });
});

describe('domain → doc → domain round-trip', () => {
  it('preserves location without tripTracking', () => {
    const original = unwrap(
      UserLocation.create({
        userId: unwrap(UserId.create(USER_ID_STR)),
        location: MIAMI,
        speed: null,
        updatedAt: new Date('2026-04-27T12:00:00Z'),
        tripTracking: null,
      }),
    );
    const doc = toDoc(original);
    const parsed = unwrap(parseUserLocationDoc(doc));
    const round = unwrap(toDomain(USER_ID_STR, parsed));
    expect(round.location.latitude).toBe(MIAMI.latitude);
    expect(round.speed).toBeNull();
    expect(round.tripTracking).toBeNull();
  });

  it('preserves tripTracking shape', () => {
    const original = unwrap(
      UserLocation.create({
        userId: unwrap(UserId.create(USER_ID_STR)),
        location: MIAMI,
        speed: 10,
        updatedAt: new Date('2026-04-27T12:00:00Z'),
        tripTracking: {
          tripId: unwrap(RideId.create(TRIP_ID_STR)),
          tripStatus: 'dispatched',
          destination: { type: 'pickup', location: FORT_LAUDERDALE },
        },
      }),
    );
    const doc = toDoc(original);
    const parsed = unwrap(parseUserLocationDoc(doc));
    const round = unwrap(toDomain(USER_ID_STR, parsed));
    expect(String(round.tripTracking?.tripId)).toBe(TRIP_ID_STR);
    expect(round.tripTracking?.tripStatus).toBe('dispatched');
    expect(round.tripTracking?.destination.type).toBe('pickup');
    expect(round.tripTracking?.destination.location.latitude).toBe(
      FORT_LAUDERDALE.latitude,
    );
  });
});
