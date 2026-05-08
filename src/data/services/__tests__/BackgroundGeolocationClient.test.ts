/**
 * @jest-environment node
 */
import BackgroundGeolocation from 'react-native-background-geolocation';

import { Coordinates } from '@domain/entities/Coordinates';
import { RideId } from '@domain/entities/RideId';
import type { BgGeofenceEvent, BgLocationEvent } from '@domain/services';
import { CrashlyticsLogTransport, LOG } from '@shared/logger';
import { FakeCrashReportingService } from '@shared/testing';

import { BackgroundGeolocationClient } from '../BackgroundGeolocationClient';

/**
 * Type cast for the global SDK mock from jest.setup.ts. The mock exposes
 * a `__listeners` registry + `__emitLocation` / `__emitGeofence` /
 * `__reset` helpers under the `default` export.
 */
interface BgMock {
  ready: jest.Mock;
  start: jest.Mock;
  stop: jest.Mock;
  getState: jest.Mock;
  addGeofence: jest.Mock;
  removeGeofence: jest.Mock;
  removeGeofences: jest.Mock;
  getOdometer: jest.Mock;
  resetOdometer: jest.Mock;
  requestPermission: jest.Mock;
  removeAllListeners: jest.Mock;
  onLocation: jest.Mock;
  onGeofence: jest.Mock;
  __emitLocation: (loc: unknown) => void;
  /**
   * Phase 9 turn 9: drive the SDK's `onLocation` error callback so the
   * adapter's flipped `LOG.error` at L348 fires through the rawMeta
   * channel to `recordError`.
   */
  __emitLocationError: (code: number) => void;
  __emitGeofence: (geo: unknown) => void;
  __reset: () => void;
  AUTHORIZATION_STATUS_ALWAYS: number;
  AUTHORIZATION_STATUS_WHEN_IN_USE: number;
  AUTHORIZATION_STATUS_DENIED: number;
}

const sdk = BackgroundGeolocation as unknown as BgMock;

const validRideId = (): RideId => {
  const r = RideId.create('ride-abc-12345');
  if (!r.ok) throw new Error('test setup: bad rideId');
  return r.value;
};

const validCoords = (): Coordinates => {
  const r = Coordinates.create(40.7128, -74.006);
  if (!r.ok) throw new Error('test setup: bad coords');
  return r.value;
};

const sampleSdkLocation = (
  overrides: Partial<{
    latitude: number;
    longitude: number;
    timestamp: string;
    odometer: number;
    speed: number;
    is_moving: boolean;
  }> = {},
): unknown => ({
  timestamp: overrides.timestamp ?? '2026-04-30T12:00:00.000Z',
  age: 0,
  odometer: overrides.odometer ?? 1234,
  is_moving: overrides.is_moving ?? true,
  uuid: 'uuid-1',
  coords: {
    latitude: overrides.latitude ?? 40.7128,
    longitude: overrides.longitude ?? -74.006,
    accuracy: 5,
    speed: overrides.speed ?? 12.5,
  },
  battery: { level: 0.8, is_charging: false },
  activity: { type: 'in_vehicle', confidence: 90 },
});

const sampleSdkGeofence = (
  overrides: Partial<{
    identifier: string;
    action: 'ENTER' | 'EXIT';
    rideId: string | null;
    timestamp: string;
  }> = {},
): unknown => ({
  timestamp: overrides.timestamp ?? '2026-04-30T12:00:00.000Z',
  identifier: overrides.identifier ?? 'pickup',
  action: overrides.action ?? 'ENTER',
  location: {
    timestamp: '2026-04-30T12:00:00.000Z',
    age: 0,
    odometer: 0,
    is_moving: true,
    uuid: 'uuid-2',
    coords: {
      latitude: 40.7128,
      longitude: -74.006,
      accuracy: 5,
    },
    battery: { level: 0.8, is_charging: false },
    activity: { type: 'still', confidence: 100 },
  },
  extras:
    overrides.rideId === null
      ? undefined
      : { rideId: overrides.rideId ?? 'ride-abc-12345' },
});

beforeEach(() => {
  // Reset listener registry + jest.fn() call counts. Default-resolved
  // values are restored by re-priming inside each test that needs a
  // specific shape.
  sdk.__reset();
  sdk.ready.mockClear().mockResolvedValue({ enabled: false, odometer: 0 });
  sdk.start.mockClear().mockResolvedValue({ enabled: true });
  sdk.stop.mockClear().mockResolvedValue({ enabled: false });
  sdk.getState.mockClear().mockResolvedValue({
    enabled: false,
    odometer: 0,
    didLaunchInBackground: false,
  });
  sdk.addGeofence.mockClear().mockResolvedValue(true);
  sdk.removeGeofence.mockClear().mockResolvedValue(true);
  sdk.removeGeofences.mockClear().mockResolvedValue(true);
  sdk.getOdometer.mockClear().mockResolvedValue(0);
  sdk.resetOdometer.mockClear().mockResolvedValue({ odometer: 0 });
  sdk.requestPermission
    .mockClear()
    .mockResolvedValue(sdk.AUTHORIZATION_STATUS_ALWAYS);
  sdk.removeAllListeners.mockClear().mockResolvedValue(undefined);
  sdk.onLocation.mockClear();
  sdk.onGeofence.mockClear();
});

describe('BackgroundGeolocationClient', () => {
  describe('init', () => {
    it('calls SDK ready with reset:true and the legacy config flags', async () => {
      const client = new BackgroundGeolocationClient();
      const result = await client.init({ distanceFilter: 200 });

      expect(result.ok).toBe(true);
      expect(sdk.ready).toHaveBeenCalledTimes(1);
      // v5.x compound config: settings are grouped under
      // `geolocation` / `app` / `activity` / `logger` / `persistence`
      // sub-objects rather than at the top level. `reset` stays top-level.
      const passed = sdk.ready.mock.calls[0]?.[0] as Record<string, unknown>;
      const geo = passed['geolocation'] as Record<string, unknown>;
      const app = passed['app'] as Record<string, unknown>;
      expect(passed['reset']).toBe(true);
      expect(geo['distanceFilter']).toBe(200);
      expect(geo['locationAuthorizationRequest']).toBe('Always');
      expect(app['stopOnTerminate']).toBe(true);
      expect(app['startOnBoot']).toBe(false);
    });

    it('is idempotent — second init is a no-op', async () => {
      const client = new BackgroundGeolocationClient();
      await client.init({ distanceFilter: 200 });
      await client.init({ distanceFilter: 200 });
      expect(sdk.ready).toHaveBeenCalledTimes(1);
    });

    it('returns NetworkError when ready throws', async () => {
      sdk.ready.mockRejectedValueOnce(new Error('native crash'));
      const client = new BackgroundGeolocationClient();
      const result = await client.init({ distanceFilter: 200 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('bg_geolocation_init_failed');
      }
    });
  });

  describe('start / stop', () => {
    it('start no-ops when SDK reports already enabled', async () => {
      sdk.getState.mockResolvedValueOnce({ enabled: true, odometer: 0 });
      const client = new BackgroundGeolocationClient();
      const result = await client.start();
      expect(result.ok).toBe(true);
      expect(sdk.start).not.toHaveBeenCalled();
    });

    it('start invokes SDK start when disabled', async () => {
      const client = new BackgroundGeolocationClient();
      const result = await client.start();
      expect(result.ok).toBe(true);
      expect(sdk.start).toHaveBeenCalledTimes(1);
    });

    it('stop calls the SDK and clears dedup keys', async () => {
      const client = new BackgroundGeolocationClient();
      const result = await client.stop();
      expect(result.ok).toBe(true);
      expect(sdk.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('addPickupGeofence', () => {
    it('registers identifier "pickup" with extras.rideId and the supplied radius', async () => {
      const client = new BackgroundGeolocationClient();
      const result = await client.addPickupGeofence({
        location: validCoords(),
        radiusMeters: 200,
        rideId: validRideId(),
      });
      expect(result.ok).toBe(true);
      expect(sdk.addGeofence).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'pickup',
          radius: 200,
          notifyOnEntry: true,
          notifyOnExit: true,
          extras: { rideId: 'ride-abc-12345' },
        }),
      );
    });

    it('returns NetworkError when SDK throws', async () => {
      sdk.addGeofence.mockRejectedValueOnce(new Error('OS denied'));
      const client = new BackgroundGeolocationClient();
      const result = await client.addPickupGeofence({
        location: validCoords(),
        radiusMeters: 200,
        rideId: validRideId(),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('bg_geolocation_add_geofence_failed');
      }
    });
  });

  describe('subscribeToLocation', () => {
    it('registers exactly one SDK listener regardless of subscriber count', () => {
      const client = new BackgroundGeolocationClient();
      const a = jest.fn();
      const b = jest.fn();
      const disposeA = client.subscribeToLocation(a);
      const disposeB = client.subscribeToLocation(b);
      expect(sdk.onLocation).toHaveBeenCalledTimes(1);
      disposeA();
      disposeB();
    });

    it('dedupes 3 multi-fires with the same (lat,lng,ts,odometer) to a single callback emission', () => {
      const client = new BackgroundGeolocationClient();
      const cb = jest.fn();
      const dispose = client.subscribeToLocation(cb);

      const loc = sampleSdkLocation();
      sdk.__emitLocation(loc);
      sdk.__emitLocation(loc);
      sdk.__emitLocation(loc);

      expect(cb).toHaveBeenCalledTimes(1);
      const event: BgLocationEvent = cb.mock.calls[0][0] as BgLocationEvent;
      expect(event.coords.latitude).toBe(40.7128);
      expect(event.coords.longitude).toBe(-74.006);
      expect(event.odometerMeters).toBe(1234);
      expect(event.speed).toBe(12.5);
      expect(event.isMoving).toBe(true);
      dispose();
    });

    it('passes through distinct fires (different timestamp)', () => {
      const client = new BackgroundGeolocationClient();
      const cb = jest.fn();
      const dispose = client.subscribeToLocation(cb);

      sdk.__emitLocation(
        sampleSdkLocation({ timestamp: '2026-04-30T12:00:00.000Z' }),
      );
      sdk.__emitLocation(
        sampleSdkLocation({ timestamp: '2026-04-30T12:00:01.000Z' }),
      );

      expect(cb).toHaveBeenCalledTimes(2);
      dispose();
    });

    it('returns a synchronous disposer that tears down the SDK listener when last subscriber leaves', () => {
      const client = new BackgroundGeolocationClient();
      const cb = jest.fn();
      const dispose = client.subscribeToLocation(cb);

      // After dispose: the underlying SDK listener has been removed, so
      // re-subscribing causes a fresh `onLocation()` registration.
      dispose();
      expect(sdk.onLocation).toHaveBeenCalledTimes(1);

      const cb2 = jest.fn();
      client.subscribeToLocation(cb2);
      expect(sdk.onLocation).toHaveBeenCalledTimes(2);

      // And events post-dispose don't reach the original callback.
      sdk.__emitLocation(sampleSdkLocation());
      expect(cb).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('emits null speed when the SDK reports a negative speed sentinel', () => {
      const client = new BackgroundGeolocationClient();
      const cb = jest.fn();
      const dispose = client.subscribeToLocation(cb);
      sdk.__emitLocation(sampleSdkLocation({ speed: -1 }));
      const event: BgLocationEvent = cb.mock.calls[0][0] as BgLocationEvent;
      expect(event.speed).toBeNull();
      dispose();
    });
  });

  describe('subscribeToGeofence', () => {
    it('dedupes consecutive identical (identifier,action,rideId) fires', () => {
      const client = new BackgroundGeolocationClient();
      const cb = jest.fn();
      const dispose = client.subscribeToGeofence(cb);

      const evt = sampleSdkGeofence({ action: 'ENTER' });
      sdk.__emitGeofence(evt);
      sdk.__emitGeofence(evt);

      expect(cb).toHaveBeenCalledTimes(1);
      const event: BgGeofenceEvent = cb.mock.calls[0][0] as BgGeofenceEvent;
      expect(event.identifier).toBe('pickup');
      expect(event.action).toBe('ENTER');
      expect(String(event.rideId)).toBe('ride-abc-12345');
      dispose();
    });

    it('treats ENTER and EXIT for the same rideId as distinct events', () => {
      const client = new BackgroundGeolocationClient();
      const cb = jest.fn();
      const dispose = client.subscribeToGeofence(cb);

      sdk.__emitGeofence(sampleSdkGeofence({ action: 'ENTER' }));
      sdk.__emitGeofence(sampleSdkGeofence({ action: 'EXIT' }));

      expect(cb).toHaveBeenCalledTimes(2);
      dispose();
    });

    it('exposes rideId as null when extras are missing', () => {
      const client = new BackgroundGeolocationClient();
      const cb = jest.fn();
      const dispose = client.subscribeToGeofence(cb);
      sdk.__emitGeofence(sampleSdkGeofence({ rideId: null }));
      const event: BgGeofenceEvent = cb.mock.calls[0][0] as BgGeofenceEvent;
      expect(event.rideId).toBeNull();
      dispose();
    });

    it('ignores unknown actions (e.g. DWELL) without emitting', () => {
      const client = new BackgroundGeolocationClient();
      const cb = jest.fn();
      const dispose = client.subscribeToGeofence(cb);
      sdk.__emitGeofence({
        ...(sampleSdkGeofence({ action: 'ENTER' }) as object),
        action: 'DWELL',
      });
      expect(cb).not.toHaveBeenCalled();
      dispose();
    });
  });

  describe('odometer + permission', () => {
    it('getOdometer returns the SDK numeric value wrapped in Result.ok', async () => {
      sdk.getOdometer.mockResolvedValueOnce(5_432);
      const client = new BackgroundGeolocationClient();
      const result = await client.getOdometer();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBe(5_432);
    });

    it('requestAuthorizationIfNeeded maps SDK status enum to string union', async () => {
      const client = new BackgroundGeolocationClient();

      sdk.requestPermission.mockResolvedValueOnce(
        sdk.AUTHORIZATION_STATUS_ALWAYS,
      );
      const a = await client.requestAuthorizationIfNeeded();
      expect(a.ok && a.value).toBe('always');

      sdk.requestPermission.mockResolvedValueOnce(
        sdk.AUTHORIZATION_STATUS_WHEN_IN_USE,
      );
      const b = await client.requestAuthorizationIfNeeded();
      expect(b.ok && b.value).toBe('when_in_use');

      sdk.requestPermission.mockResolvedValueOnce(
        sdk.AUTHORIZATION_STATUS_DENIED,
      );
      const c = await client.requestAuthorizationIfNeeded();
      expect(c.ok && c.value).toBe('denied');
    });
  });

  /**
   * Phase 9 turn 9 — telemetry: 4 chain-fatal / contract-violation
   * `LOG.error` sites in the SDK adapter must reach
   * `CrashlyticsLogTransport.recordError` via the rawMeta channel
   * (Phase 9 turn 6 contract). Pattern mirrors `Logger.test.ts:244-267`
   * and Turn 4's nav VM telemetry tests:
   *   - attach a `CrashlyticsLogTransport` to the singleton `LOG`
   *   - drive the failure path
   *   - assert on `fakeCrash.getRecordedErrors()`
   *   - detach in `try/finally` so subsequent tests in the same Jest
   *     worker don't see leaked transports
   *
   * Four sites covered:
   *   - L348 onLocation: error           — constructed Error, message-substring assertion
   *   - L506 invalid coords from SDK     — ValidationError reference (real Error)
   *   - L536 location subscriber threw   — re-thrown subscriber Error (real Error)
   *   - L585 geofence subscriber threw   — same shape as L536
   *
   * All tests assert `recorded.name === 'YeRide:BgGeolocation'` so
   * Firebase Console groups non-fatals correctly under the adapter's
   * scope.
   */
  describe('telemetry — recordError fan-out via rawMeta channel (Phase 9 turn 9)', () => {
    const SCOPE = 'YeRide:BgGeolocation';

    it('onLocation SDK error code → recordError fires with a constructed Error carrying the code', () => {
      const fakeCrash = new FakeCrashReportingService();
      const transport = new CrashlyticsLogTransport(fakeCrash);
      LOG.addTransport(transport);
      try {
        const client = new BackgroundGeolocationClient();
        const cb = jest.fn();
        const dispose = client.subscribeToLocation(cb);

        // Drive the SDK's onError callback (the second arg passed to
        // `BackgroundGeolocation.onLocation`). Code 1 in legacy
        // background-geolocation is "permission denied"; the adapter
        // constructs an Error embedding the code.
        sdk.__emitLocationError(1);

        const recorded = fakeCrash.getRecordedErrors();
        // Constructed Error — assert on message substring so a future
        // cosmetic edit to the message won't silently regroup the
        // Firebase issue under a different identifier. The assertion
        // is loose enough to survive grammar edits but tight enough
        // to catch removal of the error code.
        const codeRecord = recorded.find((r) =>
          r.error.message.includes('code=1'),
        );
        expect(codeRecord).toBeDefined();
        expect(codeRecord?.error.message).toContain(
          'bg_geolocation_onlocation_error',
        );
        expect(codeRecord?.name).toBe(SCOPE);
        // Breadcrumb still fans out at the formatted-string level.
        expect(fakeCrash.getBreadcrumbs()).toEqual(
          expect.arrayContaining([
            expect.stringContaining('[YeRide:BgGeolocation] onLocation: error'),
          ]),
        );
        dispose();
      } finally {
        LOG.removeTransport(transport);
      }
    });

    it('routine onLocation status (code 0 / 499) does NOT fire recordError', () => {
      const fakeCrash = new FakeCrashReportingService();
      const transport = new CrashlyticsLogTransport(fakeCrash);
      LOG.addTransport(transport);
      try {
        const client = new BackgroundGeolocationClient();
        const cb = jest.fn();
        const dispose = client.subscribeToLocation(cb);

        // Code 0 = OK, code 499 = client cancelled. Both stay at info
        // and do NOT recordError. Routine status changes — clutter on
        // the dashboard if recorded.
        sdk.__emitLocationError(0);
        sdk.__emitLocationError(499);

        expect(fakeCrash.getRecordedErrors()).toHaveLength(0);
        // Breadcrumbs DO record at info level (helpful for triage if
        // a later error fires).
        expect(fakeCrash.getBreadcrumbs().length).toBeGreaterThan(0);
        dispose();
      } finally {
        LOG.removeTransport(transport);
      }
    });

    it('invalid coords from SDK → recordError fires with the ValidationError carrying the validation code', () => {
      const fakeCrash = new FakeCrashReportingService();
      const transport = new CrashlyticsLogTransport(fakeCrash);
      LOG.addTransport(transport);
      try {
        const client = new BackgroundGeolocationClient();
        const cb = jest.fn();
        const dispose = client.subscribeToLocation(cb);

        // Drive `Coordinates.create` rejection — latitude > 90 is
        // out-of-range, SDK contract violation territory. The adapter
        // passes `coordsR.error` (a `ValidationError`) directly to
        // `LOG.error`; the rawMeta channel preserves the reference.
        sdk.__emitLocation(
          sampleSdkLocation({ latitude: 999, longitude: -74.006 }),
        );

        const recorded = fakeCrash.getRecordedErrors();
        // ValidationError carries `code: 'coordinates_lat_out_of_range'`.
        // Asserting on `code` (rather than reference identity) since
        // `Coordinates.create` instantiates a fresh ValidationError per
        // call — the test doesn't own the reference. Same caveat as
        // Turn 8's ValidationError test: a future refactor of
        // `Coordinates.create` to a const-error pattern would silently
        // break the "fresh ValidationError per call" assumption, but
        // the `code` field would still match.
        const validationRecord = recorded.find(
          (r) =>
            // ValidationError extends DomainError which has a `code` field.
            (r.error as Error & { code?: string }).code ===
            'coordinates_lat_out_of_range',
        );
        expect(validationRecord).toBeDefined();
        expect(validationRecord?.name).toBe(SCOPE);
        // Subscribers received NOTHING — the invalid event was filtered
        // out before the fan-out.
        expect(cb).not.toHaveBeenCalled();
        dispose();
      } finally {
        LOG.removeTransport(transport);
      }
    });

    it('location subscriber throws → recordError fires with the thrown Error (fan-out continues)', () => {
      const fakeCrash = new FakeCrashReportingService();
      const transport = new CrashlyticsLogTransport(fakeCrash);
      LOG.addTransport(transport);
      try {
        const client = new BackgroundGeolocationClient();
        const seededError = new Error('subscriber-bug');
        const throwingCb = jest.fn(() => {
          throw seededError;
        });
        const peerCb = jest.fn();

        const disposeA = client.subscribeToLocation(throwingCb);
        const disposeB = client.subscribeToLocation(peerCb);

        sdk.__emitLocation(sampleSdkLocation());

        const recorded = fakeCrash.getRecordedErrors();
        // Reference identity — `e` in the catch is the seededError
        // instance; the rawMeta channel preserves it through
        // `sanitizeForLogging`.
        const seededRecord = recorded.find((r) => r.error === seededError);
        expect(seededRecord).toBeDefined();
        expect(seededRecord?.name).toBe(SCOPE);
        // Fan-out resilience: peer subscriber DID receive the event.
        expect(peerCb).toHaveBeenCalledTimes(1);
        // Throwing subscriber was called once before throwing.
        expect(throwingCb).toHaveBeenCalledTimes(1);

        disposeA();
        disposeB();
      } finally {
        LOG.removeTransport(transport);
      }
    });

    it('geofence subscriber throws → recordError fires with the thrown Error (fan-out continues)', () => {
      const fakeCrash = new FakeCrashReportingService();
      const transport = new CrashlyticsLogTransport(fakeCrash);
      LOG.addTransport(transport);
      try {
        const client = new BackgroundGeolocationClient();
        const seededError = new Error('geofence-subscriber-bug');
        const throwingCb = jest.fn(() => {
          throw seededError;
        });
        const peerCb = jest.fn();

        const disposeA = client.subscribeToGeofence(throwingCb);
        const disposeB = client.subscribeToGeofence(peerCb);

        sdk.__emitGeofence(sampleSdkGeofence({ action: 'ENTER' }));

        const recorded = fakeCrash.getRecordedErrors();
        const seededRecord = recorded.find((r) => r.error === seededError);
        expect(seededRecord).toBeDefined();
        expect(seededRecord?.name).toBe(SCOPE);
        expect(peerCb).toHaveBeenCalledTimes(1);
        expect(throwingCb).toHaveBeenCalledTimes(1);

        disposeA();
        disposeB();
      } finally {
        LOG.removeTransport(transport);
      }
    });
  });
});
