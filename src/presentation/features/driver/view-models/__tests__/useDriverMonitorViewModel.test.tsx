import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

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
import { NetworkError } from '@domain/errors';
import { useDriverStatusStore } from '@presentation/stores';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import {
  InMemoryLocationRepository,
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
const DRIVER_LOC_MOVED = unwrap(Coordinates.create(25.795, -80.205));
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
  locationsRepo: InMemoryLocationRepository;
}

function setupSeededState(opts?: { seedRide?: Ride }): SeededState {
  const ridesRepo = new InMemoryRideRepository();
  const locationsRepo = new InMemoryLocationRepository();
  if (opts?.seedRide) {
    ridesRepo.seed(opts.seedRide);
  }
  // Production wires this in AppContent's auth observer; emulate it here.
  useSessionStore.getState().setSignedIn(DRIVER_ID);
  return { ridesRepo, locationsRepo };
}

function withTestContainer(setup: SeededState) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider
      rides={setup.ridesRepo}
      locations={setup.locationsRepo}
    >
      {children}
    </TestContainerProvider>
  );
}

describe('useDriverMonitorViewModel', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockReplace.mockClear();
    mockReset.mockClear();
    useDriverStatusStore.getState().reset();
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it("stays in 'loading' until the ride subscription emits", () => {
    const setup = setupSeededState();
    const { result } = renderHook(
      () =>
        useDriverMonitorViewModel({
          rideId: RIDE_ID,
          driverLocation: DRIVER_LOC,
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
          driverLocation: DRIVER_LOC,
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
          driverLocation: DRIVER_LOC,
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
    const { result } = renderHook(
      () =>
        useDriverMonitorViewModel({
          rideId: RIDE_ID,
          driverLocation: DRIVER_LOC,
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
    // Persisted ride is now 'started'.
    const persisted = await setup.ridesRepo.getById(RIDE_ID);
    expect(persisted.ok).toBe(true);
    if (persisted.ok) {
      expect(persisted.value.status).toBe('started');
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
    const { result } = renderHook(
      () =>
        useDriverMonitorViewModel({
          rideId: RIDE_ID,
          driverLocation: DRIVER_LOC,
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
          driverLocation: DRIVER_LOC,
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
          driverLocation: DRIVER_LOC,
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
          driverLocation: DRIVER_LOC,
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

  it('writes location once per fresh coordinate (dedup ref)', async () => {
    const setup = setupSeededState({ seedRide: makeDispatchedRide() });
    const { rerender } = renderHook(
      (props: { coords: Coordinates | null }) =>
        useDriverMonitorViewModel({
          rideId: RIDE_ID,
          driverLocation: props.coords,
        }),
      {
        wrapper: withTestContainer(setup),
        initialProps: { coords: DRIVER_LOC },
      },
    );

    // First write fires off the initial coordinate.
    await waitFor(() => {
      expect(setup.locationsRepo.spies.updateLocation).toBe(1);
    });

    // Same coordinates again — should NOT fire a second write.
    rerender({ coords: DRIVER_LOC });
    await new Promise((r) => setTimeout(r, 30));
    expect(setup.locationsRepo.spies.updateLocation).toBe(1);

    // A new coordinate fires a new write.
    rerender({ coords: DRIVER_LOC_MOVED });
    await waitFor(() => {
      expect(setup.locationsRepo.spies.updateLocation).toBe(2);
    });
  });

  it("ride flipping into 'completed' fires the terminal reset", async () => {
    const setup = setupSeededState({ seedRide: makeDispatchedRide() });
    const { result, rerender } = renderHook(
      () =>
        useDriverMonitorViewModel({
          rideId: RIDE_ID,
          driverLocation: DRIVER_LOC,
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
          driverLocation: DRIVER_LOC,
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
});
