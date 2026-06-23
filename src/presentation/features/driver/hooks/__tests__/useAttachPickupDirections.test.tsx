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
import type { BgLocationEvent } from '@domain/services';
import { useGpsStore } from '@presentation/stores';
import {
  FakeRoutesService,
  InMemoryRideRepository,
  TestContainerProvider,
} from '@shared/testing';

import { useAttachPickupDirections } from '../useAttachPickupDirections';

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
const DRIVER_LOC_2 = unwrap(Coordinates.create(25.8, -80.21));
const RIDE_ID = unwrap(RideId.create('attachHook1234567890a'));

const DRIVER = unwrap(
  DriverSnapshot.create({
    id: unwrap(UserId.create('bbbbbbbbbbbbbbbbbbbbbbbbbbbb')),
    name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
    email: unwrap(Email.create('grace@yeapp.tech')),
    phoneNumber: unwrap(PhoneNumber.create('+14155552222')),
    stripeAccountId: 'acct_abc',
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

const PASSENGER = unwrap(
  PassengerSnapshot.create({
    id: unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
    name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
    email: unwrap(Email.create('ada@yeapp.tech')),
    phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
    pushToken: null,
    avatarUrl: null,
    stripeCustomerId: null,
    defaultPaymentMethod: null,
  }),
);

function makeRoute(): Route {
  return unwrap(
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
      routeToken: 'tk',
      description: '',
    }),
  );
}

function makeDispatchedRideNoDirections(): Ride {
  const awaiting = unwrap(
    Ride.create({
      id: RIDE_ID,
      passenger: PASSENGER,
      rideService: unwrap(
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
      ),
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
  return unwrap(awaiting.claimForDispatch({ driver: DRIVER, at: new Date() }));
}

function locationEvent(coords: Coordinates = DRIVER_LOC): BgLocationEvent {
  return {
    coords,
    speed: null,
    odometerMeters: 0,
    timestampMs: 0,
    isMoving: true,
  };
}

function makeCancelledRide(): Ride {
  return unwrap(
    makeDispatchedRideNoDirections().cancel({
      reason: unwrap(
        CancellationReason.create({ code: 'changed_mind', reasonText: null }),
      ),
      by: 'rider',
      at: new Date(),
      odometerMeters: 0,
    }),
  );
}

function withContainer(
  rides: InMemoryRideRepository,
  routes: FakeRoutesService,
) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider rides={rides} routes={routes}>
      {children}
    </TestContainerProvider>
  );
}

describe('useAttachPickupDirections', () => {
  beforeEach(() => {
    useGpsStore.getState().reset();
  });

  it('computes + attaches the pickup route when a dispatched ride has none', async () => {
    const rides = new InMemoryRideRepository();
    const routes = new FakeRoutesService();
    rides.seed(makeDispatchedRideNoDirections());
    useGpsStore.getState().setLocation(locationEvent());

    renderHook(
      () => useAttachPickupDirections(makeDispatchedRideNoDirections()),
      {
        wrapper: withContainer(rides, routes),
      },
    );

    await waitFor(() => {
      expect(routes.spies.length).toBe(1);
    });
    const persisted = await rides.getById(RIDE_ID);
    expect(persisted.ok).toBe(true);
    if (persisted.ok) {
      expect(persisted.value.pickup.directions).not.toBeNull();
    }
    // Origin is the live GPS coordinate, not the pickup location.
    const origin = routes.spies[0]?.origin;
    expect(
      origin && 'coordinates' in origin && origin.coordinates.latitude,
    ).toBe(DRIVER_LOC.latitude);
  });

  it('does nothing when the ride already has directions', async () => {
    const rides = new InMemoryRideRepository();
    const routes = new FakeRoutesService();
    const withDirections = unwrap(
      makeDispatchedRideNoDirections().attachPickupDirections(makeRoute()),
    );
    rides.seed(withDirections);
    useGpsStore.getState().setLocation(locationEvent());

    renderHook(() => useAttachPickupDirections(withDirections), {
      wrapper: withContainer(rides, routes),
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(routes.spies.length).toBe(0);
  });

  it('does nothing without a live driver location', async () => {
    const rides = new InMemoryRideRepository();
    const routes = new FakeRoutesService();
    rides.seed(makeDispatchedRideNoDirections());
    // No setLocation → useGpsCurrentLocation() is null.

    renderHook(
      () => useAttachPickupDirections(makeDispatchedRideNoDirections()),
      {
        wrapper: withContainer(rides, routes),
      },
    );

    await new Promise((r) => setTimeout(r, 30));
    expect(routes.spies.length).toBe(0);
  });

  it('clears the latch on a compute failure and retries on the next GPS tick', async () => {
    const rides = new InMemoryRideRepository();
    const routes = new FakeRoutesService();
    rides.seed(makeDispatchedRideNoDirections());
    const ride = makeDispatchedRideNoDirections();
    // First compute fails — the hook must clear its per-rideId latch so a
    // later GPS emit retries instead of leaving the ride permanently
    // directions-less.
    routes.seedError(
      new NetworkError({
        code: 'routes_request_timeout',
        message: 'timed out',
      }),
    );
    useGpsStore.getState().setLocation(locationEvent());

    renderHook(() => useAttachPickupDirections(ride), {
      wrapper: withContainer(rides, routes),
    });

    await waitFor(() => {
      expect(routes.spies.length).toBe(1);
    });
    const afterFailure = await rides.getById(RIDE_ID);
    expect(afterFailure.ok && afterFailure.value.pickup.directions).toBeNull();

    // Next GPS tick (a fresh coordinate) re-fires the effect; seedError is
    // one-shot, so this attempt succeeds and attaches.
    act(() => {
      useGpsStore.getState().setLocation(locationEvent(DRIVER_LOC_2));
    });

    await waitFor(() => {
      expect(routes.spies.length).toBe(2);
    });
    const persisted = await rides.getById(RIDE_ID);
    expect(persisted.ok).toBe(true);
    if (persisted.ok) {
      expect(persisted.value.pickup.directions).not.toBeNull();
    }
  });

  it('swallows an attach failure when the ride is no longer dispatched', async () => {
    const rides = new InMemoryRideRepository();
    const routes = new FakeRoutesService();
    // The persisted doc moved on (rider cancelled in the claim→attach
    // window) so attachPickupDirections is an illegal transition. The hook
    // still computes — its prop is the stale dispatched ride — but the
    // failed attach must be swallowed, not thrown.
    rides.seed(makeCancelledRide());
    useGpsStore.getState().setLocation(locationEvent());

    renderHook(
      () => useAttachPickupDirections(makeDispatchedRideNoDirections()),
      {
        wrapper: withContainer(rides, routes),
      },
    );

    await waitFor(() => {
      expect(routes.spies.length).toBe(1);
    });
    // No directions attached to the cancelled doc, and no error surfaced.
    const persisted = await rides.getById(RIDE_ID);
    expect(persisted.ok).toBe(true);
    if (persisted.ok) {
      expect(persisted.value.status).toBe('cancelled');
      expect(persisted.value.pickup.directions).toBeNull();
    }
  });
});
