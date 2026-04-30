import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type {
  BgGeofenceEvent,
  BgLocationEvent,
} from '@data/services/BackgroundGeolocationClient';
import { Coordinates } from '@domain/entities/Coordinates';
import { RideId } from '@domain/entities/RideId';
import { UserId } from '@domain/entities/UserId';
import { AuthorizationError, NetworkError } from '@domain/errors';
import { useGpsStore } from '@presentation/stores';
import {
  FakeBackgroundGeolocationClient,
  InMemoryLocationRepository,
  TestContainerProvider,
} from '@shared/testing';

import { useGpsLifecycle, type UseGpsLifecycleArgs } from '../useGpsLifecycle';

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));
const USER_ID = unwrap(UserId.create('userxxxxxxxxxxxxxxxxxxxxxxxx'));
const RIDE_A = unwrap(RideId.create('ride_aaaaaaaaaaaa'));
const RIDE_B = unwrap(RideId.create('ride_bbbbbbbbbbbb'));

function locationEvent(overrides?: Partial<BgLocationEvent>): BgLocationEvent {
  return {
    coords: MIAMI,
    speed: 12.5,
    odometerMeters: 1500,
    timestampMs: 1_700_000_000_000,
    isMoving: true,
    ...overrides,
  };
}

function geofenceEvent(overrides?: Partial<BgGeofenceEvent>): BgGeofenceEvent {
  return {
    identifier: 'pickup',
    action: 'ENTER',
    rideId: RIDE_A,
    coords: MIAMI,
    timestampMs: 1_700_000_000_000,
    ...overrides,
  };
}

function makeWrapper(opts: {
  bg: FakeBackgroundGeolocationClient;
  locations?: InMemoryLocationRepository;
}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TestContainerProvider
        bgGeolocation={opts.bg}
        locations={opts.locations ?? new InMemoryLocationRepository()}
      >
        {children}
      </TestContainerProvider>
    );
  };
}

describe('useGpsLifecycle', () => {
  beforeEach(() => {
    useGpsStore.getState().reset();
  });

  it('inits the SDK once when first enabled, requests permission, and starts', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.seedAuthorization('always');
    const wrapper = makeWrapper({ bg });

    renderHook((args: UseGpsLifecycleArgs) => useGpsLifecycle(args), {
      wrapper,
      initialProps: { enabled: true, userId: USER_ID },
    });

    await waitFor(() => {
      expect(bg.spies.startCalls).toBe(1);
    });
    expect(bg.spies.initCalls).toEqual([{ distanceFilter: 200 }]);
    expect(bg.spies.requestAuthorizationCalls).toBe(1);
    expect(bg.isInitialized()).toBe(true);
    expect(bg.isEnabled()).toBe(true);
    expect(useGpsStore.getState().permissionStatus).toBe('always');
  });

  it('stops the SDK when enabled flips false', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.seedAuthorization('always');
    const wrapper = makeWrapper({ bg });

    const { rerender } = renderHook(
      (args: UseGpsLifecycleArgs) => useGpsLifecycle(args),
      {
        wrapper,
        initialProps: { enabled: true, userId: USER_ID },
      },
    );
    await waitFor(() => {
      expect(bg.spies.startCalls).toBe(1);
    });

    rerender({ enabled: false, userId: USER_ID });
    await waitFor(() => {
      expect(bg.spies.stopCalls).toBeGreaterThanOrEqual(1);
    });
    expect(bg.isEnabled()).toBe(false);
  });

  it('does not re-init or re-prompt on a second false → true transition', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.seedAuthorization('always');
    const wrapper = makeWrapper({ bg });

    const { rerender } = renderHook(
      (args: UseGpsLifecycleArgs) => useGpsLifecycle(args),
      {
        wrapper,
        initialProps: { enabled: true, userId: USER_ID },
      },
    );
    await waitFor(() => {
      expect(bg.spies.startCalls).toBe(1);
    });

    rerender({ enabled: false, userId: USER_ID });
    await waitFor(() => {
      expect(bg.isEnabled()).toBe(false);
    });

    rerender({ enabled: true, userId: USER_ID });
    await waitFor(() => {
      expect(bg.isEnabled()).toBe(true);
    });

    expect(bg.spies.initCalls.length).toBe(1);
    expect(bg.spies.requestAuthorizationCalls).toBe(1);
    expect(bg.spies.startCalls).toBe(2);
  });

  it('does not start the SDK when permission is denied', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.seedAuthorization('denied');
    const wrapper = makeWrapper({ bg });

    renderHook((args: UseGpsLifecycleArgs) => useGpsLifecycle(args), {
      wrapper,
      initialProps: { enabled: true, userId: USER_ID },
    });

    await waitFor(() => {
      expect(useGpsStore.getState().permissionStatus).toBe('denied');
    });
    expect(bg.spies.startCalls).toBe(0);
    expect(bg.isEnabled()).toBe(false);
  });

  it('does not init or prompt while disabled', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.seedAuthorization('always');
    const wrapper = makeWrapper({ bg });

    renderHook((args: UseGpsLifecycleArgs) => useGpsLifecycle(args), {
      wrapper,
      initialProps: { enabled: false, userId: USER_ID },
    });

    // Give async effects a tick.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(bg.spies.initCalls).toEqual([]);
    expect(bg.spies.requestAuthorizationCalls).toBe(0);
    expect(bg.spies.startCalls).toBe(0);
  });

  it('subscribes to location events and pushes them into the store', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.seedAuthorization('always');
    const wrapper = makeWrapper({ bg });

    renderHook((args: UseGpsLifecycleArgs) => useGpsLifecycle(args), {
      wrapper,
      initialProps: { enabled: true, userId: USER_ID },
    });
    await waitFor(() => {
      expect(bg.isEnabled()).toBe(true);
    });

    act(() => {
      bg.emitLocation(locationEvent());
    });

    expect(useGpsStore.getState().currentLocation).toBe(MIAMI);
    expect(useGpsStore.getState().currentSpeed).toBe(12.5);
    expect(useGpsStore.getState().currentOdometerMeters).toBe(1500);
  });

  it('writes each location event through the location repository', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.seedAuthorization('always');
    const locations = new InMemoryLocationRepository();
    const wrapper = makeWrapper({ bg, locations });

    renderHook((args: UseGpsLifecycleArgs) => useGpsLifecycle(args), {
      wrapper,
      initialProps: { enabled: true, userId: USER_ID },
    });
    await waitFor(() => {
      expect(bg.isEnabled()).toBe(true);
    });

    act(() => {
      bg.emitLocation(locationEvent({ coords: MIAMI }));
    });
    await waitFor(() => {
      expect(locations.spies.updateLocation).toBe(1);
    });
    const firstR = await locations.getLastKnown(USER_ID);
    expect(firstR.ok).toBe(true);
    if (firstR.ok) {
      expect(firstR.value?.location.equals(MIAMI)).toBe(true);
    }

    act(() => {
      bg.emitLocation(
        locationEvent({
          coords: FORT_LAUDERDALE,
          timestampMs: 1_700_000_000_001,
        }),
      );
    });
    await waitFor(() => {
      expect(locations.spies.updateLocation).toBe(2);
    });
    const secondR = await locations.getLastKnown(USER_ID);
    expect(secondR.ok).toBe(true);
    if (secondR.ok) {
      expect(secondR.value?.location.equals(FORT_LAUDERDALE)).toBe(true);
    }
  });

  it('skips location writes when no userId is signed in', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.seedAuthorization('always');
    const locations = new InMemoryLocationRepository();
    const wrapper = makeWrapper({ bg, locations });

    renderHook((args: UseGpsLifecycleArgs) => useGpsLifecycle(args), {
      wrapper,
      initialProps: { enabled: true, userId: null },
    });
    await waitFor(() => {
      expect(bg.isEnabled()).toBe(true);
    });

    act(() => {
      bg.emitLocation(locationEvent());
    });

    // Store still updated (telemetry surface), but no Firestore write.
    expect(useGpsStore.getState().currentLocation).toBe(MIAMI);
    expect(locations.spies.updateLocation).toBe(0);
  });

  it('subscribes to geofence events and updates the store + isInsidePickupGeofence', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.seedAuthorization('always');
    const wrapper = makeWrapper({ bg });

    renderHook((args: UseGpsLifecycleArgs) => useGpsLifecycle(args), {
      wrapper,
      initialProps: { enabled: true, userId: USER_ID },
    });
    await waitFor(() => {
      expect(bg.isEnabled()).toBe(true);
    });

    act(() => {
      bg.emitGeofence(geofenceEvent({ action: 'ENTER' }));
    });
    expect(useGpsStore.getState().isInsidePickupGeofence).toBe(true);

    act(() => {
      bg.emitGeofence(geofenceEvent({ action: 'EXIT' }));
    });
    expect(useGpsStore.getState().isInsidePickupGeofence).toBe(false);
  });

  it('registers a pickup geofence when activeRideForGeofence becomes non-null', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.seedAuthorization('always');
    const wrapper = makeWrapper({ bg });

    const { rerender } = renderHook(
      (args: UseGpsLifecycleArgs) => useGpsLifecycle(args),
      {
        wrapper,
        initialProps: {
          enabled: true,
          userId: USER_ID,
          activeRideForGeofence: null,
        } as UseGpsLifecycleArgs,
      },
    );
    await waitFor(() => {
      expect(bg.isEnabled()).toBe(true);
    });
    expect(bg.spies.addPickupGeofenceCalls.length).toBe(0);

    rerender({
      enabled: true,
      userId: USER_ID,
      activeRideForGeofence: { rideId: RIDE_A, pickupCoords: MIAMI },
    });
    await waitFor(() => {
      expect(bg.spies.addPickupGeofenceCalls.length).toBe(1);
    });
    expect(bg.getActiveGeofence()?.rideId).toEqual(RIDE_A);
    expect(bg.getActiveGeofence()?.radiusMeters).toBe(200);
    expect(bg.getActiveGeofence()?.location).toBe(MIAMI);
  });

  it('removes the pickup geofence when activeRideForGeofence flips back to null and clears the inside flag', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.seedAuthorization('always');
    const wrapper = makeWrapper({ bg });

    const { rerender } = renderHook(
      (args: UseGpsLifecycleArgs) => useGpsLifecycle(args),
      {
        wrapper,
        initialProps: {
          enabled: true,
          userId: USER_ID,
          activeRideForGeofence: { rideId: RIDE_A, pickupCoords: MIAMI },
        } as UseGpsLifecycleArgs,
      },
    );
    await waitFor(() => {
      expect(bg.spies.addPickupGeofenceCalls.length).toBe(1);
    });
    act(() => {
      bg.emitGeofence(geofenceEvent({ action: 'ENTER' }));
    });
    expect(useGpsStore.getState().isInsidePickupGeofence).toBe(true);

    rerender({
      enabled: true,
      userId: USER_ID,
      activeRideForGeofence: null,
    });
    await waitFor(() => {
      expect(bg.spies.removePickupGeofenceCalls).toBe(1);
    });
    expect(bg.getActiveGeofence()).toBeNull();
    expect(useGpsStore.getState().isInsidePickupGeofence).toBe(false);
  });

  it('re-registers the pickup geofence when the rideId changes', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.seedAuthorization('always');
    const wrapper = makeWrapper({ bg });

    const { rerender } = renderHook(
      (args: UseGpsLifecycleArgs) => useGpsLifecycle(args),
      {
        wrapper,
        initialProps: {
          enabled: true,
          userId: USER_ID,
          activeRideForGeofence: { rideId: RIDE_A, pickupCoords: MIAMI },
        } as UseGpsLifecycleArgs,
      },
    );
    await waitFor(() => {
      expect(bg.spies.addPickupGeofenceCalls.length).toBe(1);
    });

    rerender({
      enabled: true,
      userId: USER_ID,
      activeRideForGeofence: {
        rideId: RIDE_B,
        pickupCoords: FORT_LAUDERDALE,
      },
    });
    await waitFor(() => {
      expect(bg.spies.addPickupGeofenceCalls.length).toBe(2);
    });
    expect(bg.getActiveGeofence()?.rideId).toEqual(RIDE_B);
    expect(bg.getActiveGeofence()?.location).toBe(FORT_LAUDERDALE);
  });

  it('chain-orders stop → removeAllGeofences → removeAllListeners on unmount', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.seedAuthorization('always');
    const wrapper = makeWrapper({ bg });

    const { unmount } = renderHook(
      (args: UseGpsLifecycleArgs) => useGpsLifecycle(args),
      {
        wrapper,
        initialProps: { enabled: true, userId: USER_ID },
      },
    );
    await waitFor(() => {
      expect(bg.isEnabled()).toBe(true);
    });

    unmount();

    await waitFor(() => {
      expect(bg.spies.removeAllListenersCalls).toBeGreaterThanOrEqual(1);
    });
    expect(bg.spies.stopCalls).toBeGreaterThanOrEqual(1);
    expect(bg.spies.removeAllGeofencesCalls).toBeGreaterThanOrEqual(1);
  });

  it('does not crash if init fails — store retains the undetermined permission status', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.failNext({
      method: 'init',
      error: new NetworkError({
        code: 'sdk_init_boom',
        message: 'simulated init failure',
      }),
    });
    const wrapper = makeWrapper({ bg });

    renderHook((args: UseGpsLifecycleArgs) => useGpsLifecycle(args), {
      wrapper,
      initialProps: { enabled: true, userId: USER_ID },
    });

    // Give async effects a tick.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(bg.spies.initCalls.length).toBe(1);
    expect(bg.spies.requestAuthorizationCalls).toBe(0);
    expect(bg.spies.startCalls).toBe(0);
    expect(useGpsStore.getState().permissionStatus).toBe('undetermined');
  });

  it('does not start when permission request fails', async () => {
    const bg = new FakeBackgroundGeolocationClient();
    bg.failNext({
      method: 'requestAuthorizationIfNeeded',
      error: new AuthorizationError({
        code: 'permission_boom',
        message: 'simulated permission failure',
      }),
    });
    const wrapper = makeWrapper({ bg });

    renderHook((args: UseGpsLifecycleArgs) => useGpsLifecycle(args), {
      wrapper,
      initialProps: { enabled: true, userId: USER_ID },
    });

    await waitFor(() => {
      expect(bg.spies.requestAuthorizationCalls).toBe(1);
    });
    expect(bg.spies.startCalls).toBe(0);
    expect(useGpsStore.getState().permissionStatus).toBe('undetermined');
  });
});
