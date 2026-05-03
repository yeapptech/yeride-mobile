import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type {
  BgGeofenceEvent,
  BgLocationEvent,
} from '@data/services/BackgroundGeolocationClient';
import { CancellationReason } from '@domain/entities/CancellationReason';
import { Coordinates } from '@domain/entities/Coordinates';
import {
  DriverSnapshot,
  VehicleSnapshot,
} from '@domain/entities/DriverSnapshot';
import { Email } from '@domain/entities/Email';
import { Endpoint } from '@domain/entities/Endpoint';
import { Money } from '@domain/entities/Money';
import { PassengerSnapshot } from '@domain/entities/PassengerSnapshot';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import { Route } from '@domain/entities/Route';
import { UserId } from '@domain/entities/UserId';
import { AuthorizationError, NetworkError } from '@domain/errors';
import { useDriverStatusStore, useGpsStore } from '@presentation/stores';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import { CrashlyticsLogTransport, LOG } from '@shared/logger';
import {
  FakeCrashReportingService,
  FakeNavigationSdkClient,
  InMemoryRideRepository,
  TestContainerProvider,
} from '@shared/testing';

import { useDriverMonitorViewModel } from '../useDriverMonitorViewModel';

// Navigation mock — we assert reset() calls for cancelled / completed
// terminal redirects.
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockReset = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    replace: mockReplace,
    reset: mockReset,
  }),
}));

// Toast mock — `onLaunchNavigation` (Phase 8 turn 2) surfaces init
// failures via Toast. Hooked here so other tests stay isolated.
jest.mock('react-native-toast-message', () => {
  const show = jest.fn();
  const hide = jest.fn();
  function ToastComponent() {
    return null;
  }
  ToastComponent.show = show;
  ToastComponent.hide = hide;
  return { __esModule: true, default: ToastComponent };
});

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));
const DRIVER_LOC = unwrap(Coordinates.create(25.79, -80.2));
const RIDE_ID = unwrap(RideId.create('rideForMonitor1234567'));
const DRIVER_ID = unwrap(UserId.create('driverxxxxxxxxxxxxxxxxxxxxxx'));

const PASSENGER = unwrap(
  PassengerSnapshot.create({
    id: unwrap(UserId.create('passengerxxxxxxxxxxxxxxxxxxx')),
    name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
    email: unwrap(Email.create('ada@yeapp.tech')),
    phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
    pushToken: null,
    avatarUrl: null,
    defaultPaymentMethod: null,
  }),
);

const ECONOMY_SNAPSHOT = unwrap(
  RideServiceSnapshot.create({
    id: unwrap(RideServiceId.create('economy')),
    name: 'Economy',
    baseFare: usd(2.5),
    minimumFare: usd(5),
    cancelationFee: usd(2),
    costPerKm: usd(1.25),
    costPerMinute: usd(0.2),
    seatCapacity: 4,
  }),
);

const PICKUP_ROUTE = unwrap(
  Route.create({
    distanceMeters: 5_000,
    durationSeconds: 600,
    distanceText: '3.1 mi',
    durationText: '10 mins',
    encodedPolyline: '_p~iF',
    startLocation: DRIVER_LOC,
    endLocation: MIAMI,
    routeLabels: [],
    tollPrice: null,
    routeToken: 'tk-pickup',
    description: '',
  }),
);

function makeDriverSnap(): DriverSnapshot {
  return unwrap(
    DriverSnapshot.create({
      id: DRIVER_ID,
      name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
      email: unwrap(Email.create('driver@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155552222')),
      stripeAccountId: 'acct_test',
      pushToken: null,
      avatarUrl: null,
      vehicle: unwrap(
        VehicleSnapshot.create({
          make: 'Toyota',
          model: 'Camry',
          year: 2024,
          color: 'White',
          licensePlate: 'ABC1234',
          stockPhoto: null,
          photos: [],
        }),
      ),
    }),
  );
}

function makeAwaitingRide(): Ride {
  return unwrap(
    Ride.create({
      id: RIDE_ID,
      passenger: PASSENGER,
      rideService: ECONOMY_SNAPSHOT,
      pickup: unwrap(
        Endpoint.create({
          location: MIAMI,
          address: 'pickup',
          placeName: null,
          directions: null,
        }),
      ),
      dropoff: unwrap(
        Endpoint.create({
          location: FORT_LAUDERDALE,
          address: 'dropoff',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: new Date(),
    }),
  );
}

function makeDispatchedRide(): Ride {
  return unwrap(
    makeAwaitingRide().dispatch({
      driver: makeDriverSnap(),
      pickupDirections: PICKUP_ROUTE,
      at: new Date(),
    }),
  );
}

function makeStartedRide(): Ride {
  return unwrap(
    makeDispatchedRide().start({ odometerMeters: 1_000, at: new Date() }),
  );
}

function makePaymentRequestedRide(): Ride {
  return unwrap(
    makeStartedRide().requestPayment({
      odometerMeters: 6_000,
      at: new Date(),
    }),
  );
}

function makeCompletedRide(): Ride {
  return unwrap(makePaymentRequestedRide().markCompleted());
}

function makePaymentFailedRide(): Ride {
  return unwrap(makePaymentRequestedRide().markPaymentFailed());
}

interface SeededState {
  ridesRepo: InMemoryRideRepository;
}

function setupSeededState(opts?: { seedRide?: Ride }): SeededState {
  const ridesRepo = new InMemoryRideRepository();
  if (opts?.seedRide) {
    ridesRepo.seed(opts.seedRide);
  }
  // Production wires this in AppContent's auth observer; emulate it here.
  useSessionStore.getState().setSignedIn(DRIVER_ID);
  return { ridesRepo };
}

function withTestContainer(
  setup: SeededState,
  fakes?: { readonly navigationSdk?: FakeNavigationSdkClient },
) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider
      rides={setup.ridesRepo}
      {...(fakes?.navigationSdk ? { navigationSdk: fakes.navigationSdk } : {})}
    >
      {children}
    </TestContainerProvider>
  );
}

/**
 * Build a `BgLocationEvent` for seeding `useGpsStore.setLocation` —
 * Phase 7 turn 3 swapped `useDriverMonitorViewModel`'s stub odometer
 * for `useGpsCurrentOdometer()`, so any test that exercises
 * `onStartRide` / `requestPayment` against the entity's monotonicity
 * check needs a high-enough odometer seeded first.
 */
let bgLocationTick = 1_000;
function bgLocationEvent(odometerMeters: number): BgLocationEvent {
  return {
    coords: DRIVER_LOC,
    speed: null,
    odometerMeters,
    timestampMs: ++bgLocationTick,
    isMoving: false,
  };
}

let bgGeofenceTick = 2_000;
function bgGeofenceEvent(
  action: 'ENTER' | 'EXIT',
  identifier: 'pickup' | string = 'pickup',
): BgGeofenceEvent {
  return {
    identifier,
    action,
    rideId: null,
    coords: null,
    timestampMs: ++bgGeofenceTick,
  };
}

describe('useDriverMonitorViewModel', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockReplace.mockClear();
    mockReset.mockClear();
    useDriverStatusStore.getState().reset();
    useGpsStore.getState().reset();
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it("stays in 'loading' until the ride subscription emits", () => {
    const setup = setupSeededState();
    const { result } = renderHook(
      () =>
        useDriverMonitorViewModel({
          rideId: RIDE_ID,
        }),
      { wrapper: withTestContainer(setup) },
    );
    // No ride seeded — the live subscription emits null and the VM
    // surfaces 'loading' (since the screen also treats null as loading).
    expect(result.current.status).toBe('loading');
    expect(result.current.ride).toBeNull();
  });

  it("dispatched ride → 'en_route_to_pickup' and store mode flips to 'dispatched'", async () => {
    const setup = setupSeededState({ seedRide: makeDispatchedRide() });
    const { result } = renderHook(
      () =>
        useDriverMonitorViewModel({
          rideId: RIDE_ID,
        }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('en_route_to_pickup');
    });
    expect(useDriverStatusStore.getState().mode).toBe('dispatched');
    expect(result.current.ride?.status).toBe('dispatched');
  });

  it("onArriveAtPickup() flips status to 'at_pickup' without a server write", async () => {
    const setup = setupSeededState({ seedRide: makeDispatchedRide() });
    const { result } = renderHook(
      () =>
        useDriverMonitorViewModel({
          rideId: RIDE_ID,
        }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('en_route_to_pickup');
    });
    const updateSpyBefore = setup.ridesRepo.spies.update;

    act(() => {
      result.current.onArriveAtPickup();
    });

    expect(result.current.status).toBe('at_pickup');
    expect(result.current.arrivedAtPickup).toBe(true);
    // No persistence — at-pickup is UI-only state.
    expect(setup.ridesRepo.spies.update).toBe(updateSpyBefore);
    // Server status is still 'dispatched' under the hood.
    expect(result.current.ride?.status).toBe('dispatched');
  });

  it("onStartRide() persists 'started' and status flips to 'started'", async () => {
    const setup = setupSeededState({ seedRide: makeDispatchedRide() });
    // Seed a real GPS odometer so the test exercises the post-Phase-7
    // path (start no longer reads from `pickupTiming.odometerMeters ??
    // 0`; it reads from `useGpsCurrentOdometer()`).
    act(() => {
      useGpsStore.getState().setLocation(bgLocationEvent(2_500));
    });

    const { result } = renderHook(
      () =>
        useDriverMonitorViewModel({
          rideId: RIDE_ID,
        }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('en_route_to_pickup');
    });

    let ok = false;
    await act(async () => {
      ok = await result.current.onStartRide();
    });

    expect(ok).toBe(true);
    expect(setup.ridesRepo.spies.update).toBeGreaterThanOrEqual(1);
    // Persisted ride is now 'started' and the GPS odometer landed in
    // pickupTiming — proves real GPS data, not the stub.
    const persisted = await setup.ridesRepo.getById(RIDE_ID);
    expect(persisted.ok).toBe(true);
    if (persisted.ok) {
      expect(persisted.value.status).toBe('started');
      expect(persisted.value.pickupTiming.odometerMeters).toBe(2_500);
    }
    // Live subscription delivered → VM status flipped → store mirrors it.
    await waitFor(() => {
      expect(result.current.status).toBe('started');
    });
    expect(useDriverStatusStore.getState().mode).toBe('on_trip');
    expect(result.current.startError).toBeNull();
  });

  it("requestPayment() persists 'payment_requested' and status flips", async () => {
    const setup = setupSeededState({ seedRide: makeStartedRide() });
    // Seed the GPS-store odometer to clear the entity's monotonicity
    // floor (start was at 1_000m). Without this seed
    // `useGpsCurrentOdometer()` would return `0` and the entity would
    // reject the requestPayment.
    act(() => {
      useGpsStore.getState().setLocation(bgLocationEvent(6_000));
    });

    const { result } = renderHook(
      () =>
        useDriverMonitorViewModel({
          rideId: RIDE_ID,
        }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('started');
    });

    let ok = false;
    await act(async () => {
      ok = await result.current.requestPayment();
    });

    expect(ok).toBe(true);
    expect(setup.ridesRepo.spies.requestPayment).toBe(1);
    const persisted = await setup.ridesRepo.getById(RIDE_ID);
    expect(persisted.ok).toBe(true);
    if (persisted.ok) {
      expect(persisted.value.status).toBe('payment_requested');
      // The seeded GPS odometer flowed all the way through to the
      // entity's dropoffTiming — proves real GPS data, not the stub.
      expect(persisted.value.dropoffTiming.odometerMeters).toBe(6_000);
    }
    await waitFor(() => {
      expect(result.current.status).toBe('payment_requested');
    });
    expect(result.current.requestPaymentError).toBeNull();
    // No terminal redirect on payment_requested — only completed/cancelled.
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('requestPayment() surfaces error message on failure', async () => {
    const setup = setupSeededState({ seedRide: makeStartedRide() });
    const error = new NetworkError({
      code: 'request_payment_failed',
      message: 'Stripe is down',
    });
    setup.ridesRepo.mockRequestPaymentResult(error);

    const { result } = renderHook(
      () =>
        useDriverMonitorViewModel({
          rideId: RIDE_ID,
        }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('started');
    });

    let ok = true;
    await act(async () => {
      ok = await result.current.requestPayment();
    });

    expect(ok).toBe(false);
    expect(result.current.requestPaymentError).toBe('Stripe is down');
    // Persisted ride is still 'started' — the mock short-circuited
    // before the entity transition.
    const persisted = await setup.ridesRepo.getById(RIDE_ID);
    expect(persisted.ok).toBe(true);
    if (persisted.ok) {
      expect(persisted.value.status).toBe('started');
    }
  });

  it('cancel() persists cancelled, fires reset() once, and store flips to online_idle', async () => {
    const setup = setupSeededState({ seedRide: makeDispatchedRide() });
    const { result } = renderHook(
      () =>
        useDriverMonitorViewModel({
          rideId: RIDE_ID,
        }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('en_route_to_pickup');
    });

    const reason = unwrap(
      CancellationReason.create({
        code: 'changed_mind',
        reasonText: null,
      }),
    );

    let ok = false;
    await act(async () => {
      ok = await result.current.cancel({ reason });
    });

    expect(ok).toBe(true);
    expect(setup.ridesRepo.spies.cancel).toBe(1);
    expect(setup.ridesRepo.spies.lastCancelArgs?.by).toBe('driver');
    // Persisted ride is now cancelled.
    const persisted = await setup.ridesRepo.getById(RIDE_ID);
    expect(persisted.ok).toBe(true);
    if (persisted.ok) {
      expect(persisted.value.status).toBe('cancelled');
    }
    // Live subscription delivered → status flipped → reset fired → mode
    // is back to online_idle.
    await waitFor(() => {
      expect(mockReset).toHaveBeenCalledTimes(1);
    });
    expect(mockReset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'DriverTabs' }],
    });
    expect(useDriverStatusStore.getState().mode).toBe('online_idle');
  });

  it('does not re-fire navigation.reset on a re-render with the same cancelled status', async () => {
    const setup = setupSeededState({ seedRide: makeDispatchedRide() });
    const { result, rerender } = renderHook(
      () =>
        useDriverMonitorViewModel({
          rideId: RIDE_ID,
        }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('en_route_to_pickup');
    });

    const reason = unwrap(
      CancellationReason.create({
        code: 'changed_mind',
        reasonText: null,
      }),
    );
    await act(async () => {
      await result.current.cancel({ reason });
    });
    await waitFor(() => {
      expect(mockReset).toHaveBeenCalledTimes(1);
    });

    // Force a re-render without changing inputs. The redirect ref should
    // suppress a second reset call.
    rerender({});
    rerender({});

    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it("ride flipping into 'completed' fires the terminal reset", async () => {
    const setup = setupSeededState({ seedRide: makeDispatchedRide() });
    const { result, rerender } = renderHook(
      () =>
        useDriverMonitorViewModel({
          rideId: RIDE_ID,
        }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('en_route_to_pickup');
    });

    // Server-side flip — Cloud Function path could transition the ride
    // straight through to completed. Live subscription delivers the new
    // state; the VM's terminal-redirect effect resets to DriverTabs.
    setup.ridesRepo.seed(makeCompletedRide());
    await act(async () => {
      // Seed alone doesn't notify observers; flush a full update.
      await setup.ridesRepo.update(makeCompletedRide());
    });

    await waitFor(() => {
      expect(result.current.status).toBe('completed');
    });
    expect(useDriverStatusStore.getState().mode).toBe('on_trip');
    await waitFor(() => {
      expect(mockReset).toHaveBeenCalledTimes(1);
    });
    expect(mockReset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'DriverTabs' }],
    });

    // Re-render with the same status — redirectedRef should suppress a
    // second reset call.
    rerender({});
    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it("ride flipping into 'payment_failed' does NOT redirect", async () => {
    const setup = setupSeededState({ seedRide: makeDispatchedRide() });
    const { result } = renderHook(
      () =>
        useDriverMonitorViewModel({
          rideId: RIDE_ID,
        }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('en_route_to_pickup');
    });

    // Flip the ride to 'payment_failed' via the same seed-then-update
    // pattern. The driver should stay on DriverMonitor — the VM only
    // redirects on cancelled / completed.
    setup.ridesRepo.seed(makePaymentFailedRide());
    await act(async () => {
      await setup.ridesRepo.update(makePaymentFailedRide());
    });

    await waitFor(() => {
      expect(result.current.status).toBe('payment_failed');
    });
    expect(useDriverStatusStore.getState().mode).toBe('on_trip');
    // No terminal redirect.
    expect(mockReset).not.toHaveBeenCalled();
  });

  describe('arrivedAtPickup auto-flip (Phase 7 turn 3)', () => {
    it('pickup-geofence ENTER auto-flips arrivedAtPickup to true', async () => {
      const setup = setupSeededState({ seedRide: makeDispatchedRide() });
      const { result } = renderHook(
        () =>
          useDriverMonitorViewModel({
            rideId: RIDE_ID,
          }),
        { wrapper: withTestContainer(setup) },
      );
      await waitFor(() => {
        expect(result.current.status).toBe('en_route_to_pickup');
      });
      expect(result.current.arrivedAtPickup).toBe(false);

      act(() => {
        useGpsStore.getState().setGeofenceEvent(bgGeofenceEvent('ENTER'));
      });

      await waitFor(() => {
        expect(result.current.arrivedAtPickup).toBe(true);
      });
      expect(result.current.status).toBe('at_pickup');
      // No server write — at-pickup stays UI-only.
      expect(setup.ridesRepo.spies.update).toBe(0);
    });

    it('pickup-geofence EXIT (no manual override) flips arrivedAtPickup back to false', async () => {
      const setup = setupSeededState({ seedRide: makeDispatchedRide() });
      const { result } = renderHook(
        () =>
          useDriverMonitorViewModel({
            rideId: RIDE_ID,
          }),
        { wrapper: withTestContainer(setup) },
      );
      await waitFor(() => {
        expect(result.current.status).toBe('en_route_to_pickup');
      });

      act(() => {
        useGpsStore.getState().setGeofenceEvent(bgGeofenceEvent('ENTER'));
      });
      await waitFor(() => {
        expect(result.current.status).toBe('at_pickup');
      });

      act(() => {
        useGpsStore.getState().setGeofenceEvent(bgGeofenceEvent('EXIT'));
      });
      await waitFor(() => {
        expect(result.current.status).toBe('en_route_to_pickup');
      });
      expect(result.current.arrivedAtPickup).toBe(false);
    });

    it('manual override holds across a subsequent geofence EXIT', async () => {
      const setup = setupSeededState({ seedRide: makeDispatchedRide() });
      const { result } = renderHook(
        () =>
          useDriverMonitorViewModel({
            rideId: RIDE_ID,
          }),
        { wrapper: withTestContainer(setup) },
      );
      await waitFor(() => {
        expect(result.current.status).toBe('en_route_to_pickup');
      });

      // Driver taps "Arrived at pickup" without GPS reporting inside.
      act(() => {
        result.current.onArriveAtPickup();
      });
      expect(result.current.status).toBe('at_pickup');
      expect(result.current.arrivedAtPickup).toBe(true);

      // GPS subsequently reports EXIT (cellular dead zone, GPS drift).
      // The override should hold the at-pickup view.
      act(() => {
        useGpsStore.getState().setGeofenceEvent(bgGeofenceEvent('EXIT'));
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      expect(result.current.status).toBe('at_pickup');
      expect(result.current.arrivedAtPickup).toBe(true);
    });

    it('status leaving dispatched resets the manual override', async () => {
      const setup = setupSeededState({ seedRide: makeDispatchedRide() });
      const { result } = renderHook(
        () =>
          useDriverMonitorViewModel({
            rideId: RIDE_ID,
          }),
        { wrapper: withTestContainer(setup) },
      );
      await waitFor(() => {
        expect(result.current.status).toBe('en_route_to_pickup');
      });

      // Manual override on.
      act(() => {
        result.current.onArriveAtPickup();
      });
      expect(result.current.arrivedAtPickup).toBe(true);

      // Server-side flip to 'started' — manual override should reset
      // so a future re-entry into 'dispatched' (theoretical) starts
      // clean. Mostly defensive — production server doesn't roll a
      // ride backward from 'started'.
      act(() => {
        useGpsStore.getState().setLocation(bgLocationEvent(2_000));
      });
      let ok = false;
      await act(async () => {
        ok = await result.current.onStartRide();
      });
      expect(ok).toBe(true);
      await waitFor(() => {
        expect(result.current.status).toBe('started');
      });

      // The at-pickup display flag flips to `false` because the status
      // is no longer `'dispatched'` (the router returns 'started'
      // regardless of `arrivedAtPickup`).
      expect(result.current.status).toBe('started');
    });
  });

  describe('onLaunchNavigation (Phase 8 turn 2)', () => {
    function makeDispatchedRideWithPref(opts?: {
      readonly avoidTolls?: boolean;
    }): Ride {
      const base = unwrap(
        Ride.create({
          id: RIDE_ID,
          passenger: PASSENGER,
          rideService: ECONOMY_SNAPSHOT,
          pickup: unwrap(
            Endpoint.create({
              location: MIAMI,
              address: 'pickup',
              placeName: null,
              directions: null,
            }),
          ),
          dropoff: unwrap(
            Endpoint.create({
              location: FORT_LAUDERDALE,
              address: 'dropoff',
              placeName: null,
              directions: null,
            }),
          ),
          createdAt: new Date(),
          routePreference: {
            avoidTolls: opts?.avoidTolls ?? false,
            selectedRouteSummary: null,
            routeToken: 'tk-rider-selected',
          },
        }),
      );
      return unwrap(
        base.dispatch({
          driver: makeDriverSnap(),
          pickupDirections: PICKUP_ROUTE,
          at: new Date(),
        }),
      );
    }

    function makeStartedRideWithPref(opts?: {
      readonly avoidTolls?: boolean;
      readonly routeToken?: string | null;
    }): Ride {
      const base = unwrap(
        Ride.create({
          id: RIDE_ID,
          passenger: PASSENGER,
          rideService: ECONOMY_SNAPSHOT,
          pickup: unwrap(
            Endpoint.create({
              location: MIAMI,
              address: 'pickup',
              placeName: null,
              directions: null,
            }),
          ),
          dropoff: unwrap(
            Endpoint.create({
              location: FORT_LAUDERDALE,
              address: 'dropoff',
              placeName: null,
              directions: null,
            }),
          ),
          createdAt: new Date(),
          routePreference: {
            avoidTolls: opts?.avoidTolls ?? false,
            selectedRouteSummary: null,
            routeToken:
              opts?.routeToken === undefined
                ? 'tk-rider-selected'
                : opts.routeToken,
          },
        }),
      );
      return unwrap(
        unwrap(
          base.dispatch({
            driver: makeDriverSnap(),
            pickupDirections: PICKUP_ROUTE,
            at: new Date(),
          }),
        ).start({ odometerMeters: 1_000, at: new Date() }),
      );
    }

    it('on dispatched, navigates with the pickup leg payload', async () => {
      const fake = new FakeNavigationSdkClient();
      const setup = setupSeededState({
        seedRide: makeDispatchedRideWithPref({ avoidTolls: true }),
      });
      const { result } = renderHook(
        () =>
          useDriverMonitorViewModel({
            rideId: RIDE_ID,
          }),
        { wrapper: withTestContainer(setup, { navigationSdk: fake }) },
      );
      await waitFor(() => {
        expect(result.current.ride).not.toBeNull();
      });

      await act(async () => {
        await result.current.onLaunchNavigation();
      });

      expect(fake.spies.initCalls).toBe(1);
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      const [routeName, payload] = mockNavigate.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(routeName).toBe('DriverNavigation');
      expect(payload.leg).toBe('pickup');
      expect(payload.title).toBe('Pickup Location');
      expect(payload.destination).toEqual({
        lat: MIAMI.latitude,
        lng: MIAMI.longitude,
      });
      // Pickup leg never forwards routeToken (pickup directions are
      // computed by the dispatch flow, not rider-selected).
      expect(payload.routeToken).toBeUndefined();
      expect(payload.avoidTolls).toBe(true);
    });

    it('on started, navigates with the dropoff leg payload + routeToken', async () => {
      const fake = new FakeNavigationSdkClient();
      // Seed BG GPS so the start mutation didn't bump us elsewhere.
      const setup = setupSeededState({
        seedRide: makeStartedRideWithPref(),
      });
      const { result } = renderHook(
        () =>
          useDriverMonitorViewModel({
            rideId: RIDE_ID,
          }),
        { wrapper: withTestContainer(setup, { navigationSdk: fake }) },
      );
      await waitFor(() => {
        expect(result.current.ride?.status).toBe('started');
      });

      await act(async () => {
        await result.current.onLaunchNavigation();
      });

      expect(fake.spies.initCalls).toBe(1);
      const [, payload] = mockNavigate.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(payload.leg).toBe('dropoff');
      expect(payload.title).toBe('Dropoff Location');
      expect(payload.destination).toEqual({
        lat: FORT_LAUDERDALE.latitude,
        lng: FORT_LAUDERDALE.longitude,
      });
      expect(payload.routeToken).toBe('tk-rider-selected');
    });

    it('on started without a routeToken, omits routeToken from the payload', async () => {
      const fake = new FakeNavigationSdkClient();
      const setup = setupSeededState({
        seedRide: makeStartedRideWithPref({ routeToken: null }),
      });
      const { result } = renderHook(
        () =>
          useDriverMonitorViewModel({
            rideId: RIDE_ID,
          }),
        { wrapper: withTestContainer(setup, { navigationSdk: fake }) },
      );
      await waitFor(() => {
        expect(result.current.ride?.status).toBe('started');
      });

      await act(async () => {
        await result.current.onLaunchNavigation();
      });

      const [, payload] = mockNavigate.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(payload.routeToken).toBeUndefined();
    });

    it('on terms-not-accepted, shows dialog, accepts, retries init, then navigates', async () => {
      const fake = new FakeNavigationSdkClient();
      // First init returns the terms_not_accepted error.
      fake.failNext({
        method: 'init',
        error: new AuthorizationError({
          code: 'navigation_terms_not_accepted',
          message: 'terms',
        }),
      });
      // Default: showTermsAndConditionsDialog → accepted; second init → ok.
      const setup = setupSeededState({
        seedRide: makeDispatchedRideWithPref(),
      });
      const { result } = renderHook(
        () =>
          useDriverMonitorViewModel({
            rideId: RIDE_ID,
          }),
        { wrapper: withTestContainer(setup, { navigationSdk: fake }) },
      );
      await waitFor(() => {
        expect(result.current.ride).not.toBeNull();
      });

      await act(async () => {
        await result.current.onLaunchNavigation();
      });

      expect(fake.spies.initCalls).toBe(2);
      expect(fake.spies.showTermsCalls).toBe(1);
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });

    it('on terms declined by user, does not navigate', async () => {
      const fake = new FakeNavigationSdkClient();
      fake.failNext({
        method: 'init',
        error: new AuthorizationError({
          code: 'navigation_terms_not_accepted',
          message: 'terms',
        }),
      });
      fake.seedTermsAccepted(false);

      const setup = setupSeededState({
        seedRide: makeDispatchedRideWithPref(),
      });
      const { result } = renderHook(
        () =>
          useDriverMonitorViewModel({
            rideId: RIDE_ID,
          }),
        { wrapper: withTestContainer(setup, { navigationSdk: fake }) },
      );
      await waitFor(() => {
        expect(result.current.ride).not.toBeNull();
      });

      await act(async () => {
        await result.current.onLaunchNavigation();
      });

      expect(fake.spies.showTermsCalls).toBe(1);
      // Init was called once; no retry after decline.
      expect(fake.spies.initCalls).toBe(1);
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('on init network error, surfaces a Toast and does not navigate', async () => {
      const Toast = (
        require('react-native-toast-message') as {
          default: { show: jest.Mock };
        }
      ).default;
      Toast.show.mockClear();

      const fake = new FakeNavigationSdkClient();
      fake.failNext({
        method: 'init',
        error: new NetworkError({
          code: 'navigation_init_network_error',
          message: 'down',
        }),
      });

      const setup = setupSeededState({
        seedRide: makeDispatchedRideWithPref(),
      });
      const { result } = renderHook(
        () =>
          useDriverMonitorViewModel({
            rideId: RIDE_ID,
          }),
        { wrapper: withTestContainer(setup, { navigationSdk: fake }) },
      );
      await waitFor(() => {
        expect(result.current.ride).not.toBeNull();
      });

      await act(async () => {
        await result.current.onLaunchNavigation();
      });

      expect(mockNavigate).not.toHaveBeenCalled();
      expect(Toast.show).toHaveBeenCalledTimes(1);
    });

    it('on a non-launchable status (completed), does nothing', async () => {
      const fake = new FakeNavigationSdkClient();
      const setup = setupSeededState({
        seedRide: makeCompletedRide(),
      });
      const { result } = renderHook(
        () =>
          useDriverMonitorViewModel({
            rideId: RIDE_ID,
          }),
        { wrapper: withTestContainer(setup, { navigationSdk: fake }) },
      );
      await waitFor(() => {
        expect(result.current.ride?.status).toBe('completed');
      });
      // Wait for the terminal-redirect effect to fire so it doesn't
      // race onLaunchNavigation; clear the mock so we only see the
      // launch-navigation behaviour below.
      await waitFor(() => {
        expect(mockReset).toHaveBeenCalled();
      });
      mockNavigate.mockClear();

      await act(async () => {
        await result.current.onLaunchNavigation();
      });

      expect(fake.spies.initCalls).toBe(0);
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('isLaunchingNavigation is true while in flight', async () => {
      const fake = new FakeNavigationSdkClient();
      const setup = setupSeededState({
        seedRide: makeDispatchedRideWithPref(),
      });
      const { result } = renderHook(
        () =>
          useDriverMonitorViewModel({
            rideId: RIDE_ID,
          }),
        { wrapper: withTestContainer(setup, { navigationSdk: fake }) },
      );
      await waitFor(() => {
        expect(result.current.ride).not.toBeNull();
      });
      expect(result.current.isLaunchingNavigation).toBe(false);

      await act(async () => {
        await result.current.onLaunchNavigation();
      });

      // Settled — flag should reset.
      expect(result.current.isLaunchingNavigation).toBe(false);
      expect(mockNavigate).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Phase 9 turn 4 — telemetry: chain-fatal LOG.error sites in
   * `onLaunchNavigation` must reach
   * `CrashlyticsLogTransport.recordError` via the rawMeta channel
   * (Phase 9 turn 6 contract). Pattern mirrors `Logger.test.ts:244-267`.
   *
   * Two sites covered:
   *   - terms-dialog Result.err — error reference flows directly
   *   - non-terms init Result.err — error reference flows directly
   *
   * Excluded: terms-declined-by-user is a deliberate user choice and
   * stays at LOG.info (no recordError fan-out — declining is not an
   * error).
   */
  describe('telemetry — recordError fan-out via rawMeta channel (Phase 9 turn 4)', () => {
    /** Drains the microtask queue so async `void`-fired SDK calls land. */
    const flushMicrotasks = () => Promise.resolve();

    it('terms-dialog Result.err → recordError fires with the error reference', async () => {
      const fakeCrash = new FakeCrashReportingService();
      const transport = new CrashlyticsLogTransport(fakeCrash);
      LOG.addTransport(transport);
      try {
        const fake = new FakeNavigationSdkClient();
        // First init returns terms_not_accepted → triggers terms dialog.
        fake.failNext({
          method: 'init',
          error: new AuthorizationError({
            code: 'navigation_terms_not_accepted',
            message: 'terms',
          }),
        });
        // Then the terms dialog itself fails with a network error.
        const seededTermsError = new NetworkError({
          code: 'navigation_show_terms_failed',
          message: 'terms dialog crashed',
        });
        fake.failNext({
          method: 'showTermsAndConditionsDialog',
          error: seededTermsError,
        });

        const setup = setupSeededState({
          seedRide: makeDispatchedRide(),
        });
        const { result } = renderHook(
          () =>
            useDriverMonitorViewModel({
              rideId: RIDE_ID,
            }),
          { wrapper: withTestContainer(setup, { navigationSdk: fake }) },
        );
        await waitFor(() => {
          expect(result.current.ride).not.toBeNull();
        });

        await act(async () => {
          await result.current.onLaunchNavigation();
        });
        await flushMicrotasks();

        const recorded = fakeCrash.getRecordedErrors();
        const seededRecord = recorded.find((r) => r.error === seededTermsError);
        expect(seededRecord).toBeDefined();
        expect(seededRecord?.name).toBe('YeRide:DriverMonitorVM');
        expect(fakeCrash.getBreadcrumbs()).toEqual(
          expect.arrayContaining([
            '[YeRide:DriverMonitorVM] terms dialog failed',
          ]),
        );
        // Sanity: navigation never fired.
        expect(mockNavigate).not.toHaveBeenCalled();
      } finally {
        LOG.removeTransport(transport);
      }
    });

    it('init Result.err (non-terms branch) → recordError fires with the error reference', async () => {
      const fakeCrash = new FakeCrashReportingService();
      const transport = new CrashlyticsLogTransport(fakeCrash);
      LOG.addTransport(transport);
      try {
        const seededInitError = new NetworkError({
          code: 'navigation_init_network_error',
          message: 'init transport down',
        });
        const fake = new FakeNavigationSdkClient();
        fake.failNext({ method: 'init', error: seededInitError });

        const setup = setupSeededState({
          seedRide: makeDispatchedRide(),
        });
        const { result } = renderHook(
          () =>
            useDriverMonitorViewModel({
              rideId: RIDE_ID,
            }),
          { wrapper: withTestContainer(setup, { navigationSdk: fake }) },
        );
        await waitFor(() => {
          expect(result.current.ride).not.toBeNull();
        });

        await act(async () => {
          await result.current.onLaunchNavigation();
        });
        await flushMicrotasks();

        const recorded = fakeCrash.getRecordedErrors();
        const seededRecord = recorded.find((r) => r.error === seededInitError);
        expect(seededRecord).toBeDefined();
        expect(seededRecord?.name).toBe('YeRide:DriverMonitorVM');
        expect(fakeCrash.getBreadcrumbs()).toEqual(
          expect.arrayContaining([
            '[YeRide:DriverMonitorVM] navigation init failed',
          ]),
        );
        expect(mockNavigate).not.toHaveBeenCalled();
      } finally {
        LOG.removeTransport(transport);
      }
    });
  });
});
