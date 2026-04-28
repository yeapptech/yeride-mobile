import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

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
import { makeDriver } from '@domain/entities/User';
import { UserId } from '@domain/entities/UserId';
import { useDriverStatusStore } from '@presentation/stores';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import {
  InMemoryAuthRepository,
  InMemoryRideRepository,
  InMemoryUserRepository,
  TestContainerProvider,
} from '@shared/testing';

import { useDriverDispatchViewModel } from '../useDriverDispatchViewModel';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    replace: mockReplace,
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
const DRIVER_LOCATION = unwrap(Coordinates.create(25.79, -80.2));
const RIDE_ID = unwrap(RideId.create('rideForDispatch12345ab'));

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
  // Awaiting → dispatched (some other driver took it). Used for the
  // 'gone' state test.
  const awaiting = makeAwaitingRide();
  const otherDriver = unwrap(
    DriverSnapshot.create({
      id: unwrap(UserId.create('otherDriverxxxxxxxxxxxxxxxxx')),
      name: unwrap(PersonName.create({ first: 'Other', last: 'Driver' })),
      email: unwrap(Email.create('other@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155559999')),
      stripeAccountId: 'acct_other',
      pushToken: null,
      avatarUrl: null,
      vehicle: unwrap(
        VehicleSnapshot.create({
          make: 'Honda',
          model: 'Civic',
          year: 2025,
          color: 'Blue',
          licensePlate: 'XYZ7890',
          stockPhoto: null,
          photos: [],
        }),
      ),
    }),
  );
  const route = unwrap(
    Route.create({
      distanceMeters: 5_000,
      durationSeconds: 600,
      distanceText: '3.1 mi',
      durationText: '10 mins',
      encodedPolyline: '_p~iF',
      startLocation: MIAMI,
      endLocation: FORT_LAUDERDALE,
      routeLabels: [],
      tollPrice: null,
      routeToken: 'tk',
      description: '',
    }),
  );
  return unwrap(
    awaiting.dispatch({
      driver: otherDriver,
      pickupDirections: route,
      at: new Date(),
    }),
  );
}

interface SeededState {
  authRepo: InMemoryAuthRepository;
  usersRepo: InMemoryUserRepository;
  ridesRepo: InMemoryRideRepository;
  uid: UserId;
}

async function setupSeededState(opts?: {
  driverOverrides?: Partial<Parameters<typeof makeDriver>[0]>;
  seedRide?: Ride;
}): Promise<SeededState> {
  const authRepo = new InMemoryAuthRepository();
  const signUpR = await authRepo.signUp({
    email: unwrap(Email.create('driver@yeapp.tech')),
    password: 'pw1234',
  });
  const uid = unwrap(signUpR);

  const usersRepo = new InMemoryUserRepository();
  const driver = makeDriver({
    id: uid,
    email: unwrap(Email.create('driver@yeapp.tech')),
    emailVerified: true,
    name: unwrap(PersonName.create({ first: 'Grace', last: 'Hopper' })),
    phone: unwrap(PhoneNumber.create('+14155552222')),
    avatarUrl: null,
    savedPlaces: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    stripeAccountId: 'acct_driver',
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    activeVehicleId: 'vehicle-real-1',
    vehicleIds: ['vehicle-real-1'],
    ...opts?.driverOverrides,
  });
  await usersRepo.create(driver);

  const ridesRepo = new InMemoryRideRepository();
  if (opts?.seedRide !== undefined) {
    ridesRepo.seed(opts.seedRide);
  } else {
    ridesRepo.seed(makeAwaitingRide());
  }

  useSessionStore.getState().setSignedIn(uid);

  return { authRepo, usersRepo, ridesRepo, uid };
}

function withTestContainer(setup: SeededState) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider
      auth={setup.authRepo}
      users={setup.usersRepo}
      rides={setup.ridesRepo}
    >
      {children}
    </TestContainerProvider>
  );
}

describe('useDriverDispatchViewModel', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockGoBack.mockClear();
    mockReplace.mockClear();
    useDriverStatusStore.getState().reset();
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it('starts in loading until ride + user + pickup route resolve', async () => {
    const setup = await setupSeededState();
    const { result } = renderHook(
      () =>
        useDriverDispatchViewModel({
          rideId: RIDE_ID,
          driverLocation: DRIVER_LOCATION,
        }),
      { wrapper: withTestContainer(setup) },
    );
    // Initial render: subscription has emitted (in-memory fake is sync) but
    // the route query still races. Wait for ready.
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.ride).not.toBeNull();
    expect(result.current.pickupRoute).not.toBeNull();
  });

  it("flips to 'gone' when the ride leaves awaiting_driver mid-decision", async () => {
    const setup = await setupSeededState({ seedRide: makeDispatchedRide() });
    const { result } = renderHook(
      () =>
        useDriverDispatchViewModel({
          rideId: RIDE_ID,
          driverLocation: DRIVER_LOCATION,
        }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('gone');
    });
  });

  it("'cannot_accept' (no_stripe_connect) when driver has no Stripe account", async () => {
    const setup = await setupSeededState({
      driverOverrides: { stripeAccountId: null },
    });
    const { result } = renderHook(
      () =>
        useDriverDispatchViewModel({
          rideId: RIDE_ID,
          driverLocation: DRIVER_LOCATION,
        }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('cannot_accept');
    });
    expect(result.current.cannotAcceptReason).toBe('no_stripe_connect');
  });

  it("'cannot_accept' (no_active_vehicle) when driver has no active vehicle", async () => {
    const setup = await setupSeededState({
      driverOverrides: { activeVehicleId: null },
    });
    const { result } = renderHook(
      () =>
        useDriverDispatchViewModel({
          rideId: RIDE_ID,
          driverLocation: DRIVER_LOCATION,
        }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('cannot_accept');
    });
    expect(result.current.cannotAcceptReason).toBe('no_active_vehicle');
  });

  it('onAccept calls DispatchRide and replaces with DriverMonitor on success', async () => {
    const setup = await setupSeededState();
    const { result } = renderHook(
      () =>
        useDriverDispatchViewModel({
          rideId: RIDE_ID,
          driverLocation: DRIVER_LOCATION,
        }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    act(() => {
      result.current.onAccept();
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('DriverMonitor', {
        rideId: String(RIDE_ID),
      });
    });
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(useDriverStatusStore.getState().mode).toBe('dispatched');
    // The seeded ride is now dispatched in the fake repo.
    const persisted = await setup.ridesRepo.getById(RIDE_ID);
    expect(persisted.ok).toBe(true);
    if (persisted.ok) {
      expect(persisted.value.status).toBe('dispatched');
      expect(persisted.value.driver?.id).toBe(setup.uid);
    }
  });

  it('onDecline pops back without calling DispatchRide', async () => {
    const setup = await setupSeededState();
    const { result } = renderHook(
      () =>
        useDriverDispatchViewModel({
          rideId: RIDE_ID,
          driverLocation: DRIVER_LOCATION,
        }),
      { wrapper: withTestContainer(setup) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    act(() => {
      result.current.onDecline();
    });

    expect(mockGoBack).toHaveBeenCalled();
    // Ride should still be awaiting_driver in the fake repo.
    const persisted = await setup.ridesRepo.getById(RIDE_ID);
    expect(persisted.ok).toBe(true);
    if (persisted.ok) {
      expect(persisted.value.status).toBe('awaiting_driver');
    }
  });

  it('stays loading when driver location is null', async () => {
    const setup = await setupSeededState();
    const { result } = renderHook(
      () =>
        useDriverDispatchViewModel({
          rideId: RIDE_ID,
          driverLocation: null,
        }),
      { wrapper: withTestContainer(setup) },
    );
    // Without a driver location we can't compute the pickup route, so we
    // never leave 'loading'. Wait a tick to confirm the status stayed put.
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.status).toBe('loading');
    expect(result.current.pickupRoute).toBeNull();
  });
});
