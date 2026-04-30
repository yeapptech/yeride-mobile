/**
 * @jest-environment node
 */
import { Coordinates } from '@domain/entities/Coordinates';
import { RideId } from '@domain/entities/RideId';
import { AuthorizationError, NetworkError } from '@domain/errors';

import {
  FakeBackgroundGeolocationClient,
  type BgLocationEvent,
} from '../FakeBackgroundGeolocationClient';

const validRideId = (id = 'ride-abc-12345'): RideId => {
  const r = RideId.create(id);
  if (!r.ok) throw new Error('test setup: bad rideId');
  return r.value;
};

const validCoords = (lat = 40.7128, lng = -74.006): Coordinates => {
  const r = Coordinates.create(lat, lng);
  if (!r.ok) throw new Error('test setup: bad coords');
  return r.value;
};

const sampleLocationEvent = (
  overrides: Partial<BgLocationEvent> = {},
): BgLocationEvent => ({
  coords: overrides.coords ?? validCoords(),
  speed: overrides.speed ?? 12.5,
  odometerMeters: overrides.odometerMeters ?? 1234,
  timestampMs: overrides.timestampMs ?? 1735_000_000_000,
  isMoving: overrides.isMoving ?? true,
});

describe('FakeBackgroundGeolocationClient', () => {
  describe('emit + subscribe', () => {
    it('emitLocation fans out to all registered subscribers', () => {
      const fake = new FakeBackgroundGeolocationClient();
      const a = jest.fn();
      const b = jest.fn();
      fake.subscribeToLocation(a);
      fake.subscribeToLocation(b);
      fake.emitLocation(sampleLocationEvent());
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });

    it('emitMultiFireLocation with the same event dedupes to ONE callback emission per subscriber', () => {
      const fake = new FakeBackgroundGeolocationClient();
      const cb = jest.fn();
      fake.subscribeToLocation(cb);
      fake.emitMultiFireLocation(sampleLocationEvent(), 3);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('emitGeofence dedupes by (identifier,action,rideId)', () => {
      const fake = new FakeBackgroundGeolocationClient();
      const cb = jest.fn();
      fake.subscribeToGeofence(cb);
      const event = {
        identifier: 'pickup',
        action: 'ENTER' as const,
        rideId: validRideId(),
        coords: validCoords(),
        timestampMs: 1735_000_000_000,
      };
      fake.emitGeofence(event);
      fake.emitGeofence(event);
      expect(cb).toHaveBeenCalledTimes(1);
      // Different action with same rideId fans through.
      fake.emitGeofence({ ...event, action: 'EXIT' });
      expect(cb).toHaveBeenCalledTimes(2);
    });
  });

  describe('seed + state', () => {
    it('seedOdometer round-trips through getOdometer', async () => {
      const fake = new FakeBackgroundGeolocationClient();
      fake.seedOdometer(42_000);
      const r = await fake.getOdometer();
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(42_000);
    });

    it('seedAuthorization changes what requestAuthorizationIfNeeded returns', async () => {
      const fake = new FakeBackgroundGeolocationClient();
      fake.seedAuthorization('denied');
      const r = await fake.requestAuthorizationIfNeeded();
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe('denied');
    });

    it('addPickupGeofence + removePickupGeofence flips the active-geofence record', async () => {
      const fake = new FakeBackgroundGeolocationClient();
      expect(fake.getActiveGeofence()).toBeNull();
      await fake.addPickupGeofence({
        location: validCoords(),
        radiusMeters: 200,
        rideId: validRideId(),
      });
      expect(fake.getActiveGeofence()).not.toBeNull();
      expect(fake.spies.addPickupGeofenceCalls).toHaveLength(1);
      await fake.removePickupGeofence();
      expect(fake.getActiveGeofence()).toBeNull();
    });

    it('start + stop flip isEnabled', async () => {
      const fake = new FakeBackgroundGeolocationClient();
      expect(fake.isEnabled()).toBe(false);
      await fake.start();
      expect(fake.isEnabled()).toBe(true);
      await fake.stop();
      expect(fake.isEnabled()).toBe(false);
    });
  });

  describe('failNext', () => {
    it('primes the next call to a method to fail and resets after one fire', async () => {
      const fake = new FakeBackgroundGeolocationClient();
      fake.failNext({
        method: 'addPickupGeofence',
        error: new NetworkError({
          code: 'test_failure',
          message: 'simulated',
        }),
      });
      const a = await fake.addPickupGeofence({
        location: validCoords(),
        radiusMeters: 200,
        rideId: validRideId(),
      });
      expect(a.ok).toBe(false);
      // Second call goes through.
      const b = await fake.addPickupGeofence({
        location: validCoords(),
        radiusMeters: 200,
        rideId: validRideId(),
      });
      expect(b.ok).toBe(true);
    });

    it('failures are scoped per method', async () => {
      const fake = new FakeBackgroundGeolocationClient();
      fake.failNext({
        method: 'requestAuthorizationIfNeeded',
        error: new AuthorizationError({
          code: 'permission_denied_by_test',
          message: 'simulated',
        }),
      });
      const start = await fake.start();
      expect(start.ok).toBe(true);
      const auth = await fake.requestAuthorizationIfNeeded();
      expect(auth.ok).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('reset() wipes seed + spy + failure state', async () => {
      const fake = new FakeBackgroundGeolocationClient();
      fake.seedOdometer(99);
      await fake.start();
      await fake.addPickupGeofence({
        location: validCoords(),
        radiusMeters: 200,
        rideId: validRideId(),
      });

      fake.reset();

      expect(fake.spies.startCalls).toBe(0);
      expect(fake.spies.addPickupGeofenceCalls).toHaveLength(0);
      expect(fake.getActiveGeofence()).toBeNull();
      const r = await fake.getOdometer();
      expect(r.ok && r.value).toBe(0);
    });

    it('disposer is synchronous and idempotent', () => {
      const fake = new FakeBackgroundGeolocationClient();
      const cb = jest.fn();
      const dispose = fake.subscribeToLocation(cb);
      dispose();
      // Calling twice should not throw and should leave the subscriber set
      // empty.
      expect(() => dispose()).not.toThrow();
      fake.emitLocation(sampleLocationEvent());
      expect(cb).not.toHaveBeenCalled();
    });

    it('removeAllListeners clears both location and geofence subscribers', async () => {
      const fake = new FakeBackgroundGeolocationClient();
      const locCb = jest.fn();
      const geoCb = jest.fn();
      fake.subscribeToLocation(locCb);
      fake.subscribeToGeofence(geoCb);

      await fake.removeAllListeners();

      fake.emitLocation(sampleLocationEvent());
      fake.emitGeofence({
        identifier: 'pickup',
        action: 'ENTER',
        rideId: validRideId(),
        coords: validCoords(),
        timestampMs: 1735_000_000_000,
      });
      expect(locCb).not.toHaveBeenCalled();
      expect(geoCb).not.toHaveBeenCalled();
      expect(fake.spies.removeAllListenersCalls).toBe(1);
    });
  });
});
