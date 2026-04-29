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
import { RideService } from '@domain/entities/RideService';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import { Route } from '@domain/entities/Route';
import { ServiceArea } from '@domain/entities/ServiceArea';
import { ServiceAreaId } from '@domain/entities/ServiceAreaId';
import { makeDriver } from '@domain/entities/User';
import { UserId } from '@domain/entities/UserId';
import { Vehicle } from '@domain/entities/Vehicle';
import { Vin } from '@domain/entities/Vin';
import {
  useDriverStatusStore,
  useServiceAreaStore,
} from '@presentation/stores';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import {
  InMemoryAuthRepository,
  InMemoryRideRepository,
  InMemoryServiceAreaRepository,
  InMemoryUserRepository,
  InMemoryVehicleRepository,
  TestContainerProvider,
} from '@shared/testing';

import { useDriverHomeViewModel } from '../useDriverHomeViewModel';

// Navigation mock — we assert `navigate` calls only.
const mockNavigate = jest.fn();
const focusCallbacks: (() => void)[] = [];
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (cb: () => void) => {
    focusCallbacks.push(cb);
    cb();
  },
}));

// expo-location mock — return a deterministic location.
jest.mock('expo-location', () => ({
  __esModule: true,
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({
    status: 'granted',
  })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 25.7617, longitude: -80.1918 },
  })),
}));

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

const AREA_ID = unwrap(ServiceAreaId.create('miami'));
const ECONOMY_ID = unwrap(RideServiceId.create('economy'));

const MIAMI = unwrap(Coordinates.create(25.7617, -80.1918));
const FORT_LAUDERDALE = unwrap(Coordinates.create(26.1224, -80.1373));

function makeArea(): ServiceArea {
  return unwrap(
    ServiceArea.create({
      id: AREA_ID,
      identifier: 'miami',
      center: MIAMI,
      radiusMeters: 50_000,
      notifyOnEntry: true,
      notifyOnDwell: false,
      notifyOnExit: true,
    }),
  );
}

function makeEconomy(): RideService {
  return unwrap(
    RideService.create({
      id: ECONOMY_ID,
      areaId: AREA_ID,
      name: 'Economy',
      description: 'Cheap and cheerful',
      baseFare: usd(2.5),
      minimumFare: usd(5),
      cancelationFee: usd(2),
      seatCapacity: 4,
      costPerKm: usd(1.25),
      costPerMinute: usd(0.2),
    }),
  );
}

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
    id: ECONOMY_ID,
    name: 'Economy',
    baseFare: usd(2.5),
    minimumFare: usd(5),
    cancelationFee: usd(2),
    costPerKm: usd(1.25),
    costPerMinute: usd(0.2),
    seatCapacity: 4,
  }),
);

function makeAwaitingRide(args: { id: string }): Ride {
  return unwrap(
    Ride.create({
      id: unwrap(RideId.create(args.id)),
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

// A valid 17-char VIN with correct check digit (legacy fixture).
const VALID_VIN = '1HGBH41JXMN109186';

function makeApprovedHonda(): Vehicle {
  const created = unwrap(
    Vehicle.create({
      vin: unwrap(Vin.create(VALID_VIN)),
      make: 'Honda',
      model: 'Accord',
      year: 2020,
      vehicleClass: 'comfort',
      eligibleServices: [unwrap(RideServiceId.create('comfort'))],
      dataSource: 'vin_decoded',
      stockPhoto: 'https://nhtsa.example/honda-accord-2020.png',
      createdAt: new Date(),
    }),
  );
  return unwrap(created.approve(new Date()));
}

async function setupSeededState(opts?: {
  /**
   * Override the driver's `activeVehicleId`. Pass `null` to model the
   * empty-state branch (Phase 5 turn 4 — `noActiveVehicle === true`).
   */
  readonly activeVehicleId?: string | null;
  /**
   * Optionally seed a Vehicle aggregate keyed by `activeVehicleId` so
   * `useDriverActiveVehicleQuery` resolves to a real entity.
   */
  readonly seedVehicle?: Vehicle;
}): Promise<{
  authRepo: InMemoryAuthRepository;
  usersRepo: InMemoryUserRepository;
  serviceAreasRepo: InMemoryServiceAreaRepository;
  ridesRepo: InMemoryRideRepository;
  vehiclesRepo: InMemoryVehicleRepository;
  uid: UserId;
}> {
  const authRepo = new InMemoryAuthRepository();
  const signUpR = await authRepo.signUp({
    email: unwrap(Email.create('driver@yeapp.tech')),
    password: 'pw1234',
  });
  const uid = unwrap(signUpR);

  const activeVehicleId =
    opts?.activeVehicleId !== undefined ? opts.activeVehicleId : VALID_VIN;
  const vehicleIds = activeVehicleId !== null ? [activeVehicleId] : [];

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
    stripeAccountId: null,
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    activeVehicleId,
    vehicleIds,
  });
  await usersRepo.create(driver);

  const serviceAreasRepo = new InMemoryServiceAreaRepository();
  serviceAreasRepo.reset({
    areas: [makeArea()],
    services: { [String(AREA_ID)]: [makeEconomy()] },
  });

  const ridesRepo = new InMemoryRideRepository();
  const vehiclesRepo = new InMemoryVehicleRepository();
  if (opts?.seedVehicle) {
    vehiclesRepo.seed(opts.seedVehicle, uid);
  }

  // Production wires this in AppContent's auth observer; test emulates it.
  useSessionStore.getState().setSignedIn(uid);

  return {
    authRepo,
    usersRepo,
    serviceAreasRepo,
    ridesRepo,
    vehiclesRepo,
    uid,
  };
}

function withTestContainer(opts: {
  authRepo: InMemoryAuthRepository;
  usersRepo: InMemoryUserRepository;
  serviceAreasRepo: InMemoryServiceAreaRepository;
  ridesRepo: InMemoryRideRepository;
  vehiclesRepo: InMemoryVehicleRepository;
}) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider
      auth={opts.authRepo}
      users={opts.usersRepo}
      serviceAreas={opts.serviceAreasRepo}
      rides={opts.ridesRepo}
      vehicles={opts.vehiclesRepo}
    >
      {children}
    </TestContainerProvider>
  );
}

describe('useDriverHomeViewModel', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    focusCallbacks.length = 0;
    useServiceAreaStore.getState().reset();
    useDriverStatusStore.getState().reset();
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it('reaches "ready" status with location + active area resolved', async () => {
    const setup = await setupSeededState();
    const { result } = renderHook(() => useDriverHomeViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.activeServiceArea?.identifier).toBe('miami');
    expect(result.current.user?.email.value).toBe('driver@yeapp.tech');
    expect(result.current.mode).toBe('offline');
  });

  it('starts offline; available-rides subscription stays empty', async () => {
    const setup = await setupSeededState();
    setup.ridesRepo.seed(makeAwaitingRide({ id: 'rideOffline123456789012' }));
    const { result } = renderHook(() => useDriverHomeViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    // Mode is offline → subscription is gated → empty array.
    expect(result.current.availableRides).toEqual([]);
  });

  it('onToggleOnline flips mode and seeds activeVehicleId from the user doc', async () => {
    const setup = await setupSeededState();
    const { result } = renderHook(() => useDriverHomeViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    act(() => {
      result.current.onToggleOnline();
    });

    expect(result.current.mode).toBe('online_idle');
    expect(result.current.activeVehicleId).toBe(VALID_VIN);
  });

  it('noActiveVehicle is true when the driver has no active vehicle', async () => {
    const setup = await setupSeededState({ activeVehicleId: null });
    const { result } = renderHook(() => useDriverHomeViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    expect(result.current.noActiveVehicle).toBe(true);

    // onToggleOnline is a no-op in this branch (defense in depth — the
    // screen also hides the toggle).
    act(() => {
      result.current.onToggleOnline();
    });
    expect(result.current.mode).toBe('offline');

    // onRegisterVehicle pushes the Vehicles screen.
    act(() => {
      result.current.onRegisterVehicle();
    });
    expect(mockNavigate).toHaveBeenCalledWith('Vehicles');
  });

  it('exposes the active vehicle from useDriverActiveVehicleQuery (stock photo surfacing)', async () => {
    const honda = makeApprovedHonda();
    const setup = await setupSeededState({
      activeVehicleId: VALID_VIN,
      seedVehicle: honda,
    });
    const { result } = renderHook(() => useDriverHomeViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    await waitFor(() => {
      expect(result.current.activeVehicle).not.toBeNull();
    });
    expect(result.current.activeVehicle?.make).toBe('Honda');
    expect(result.current.activeVehicle?.stockPhoto).toBe(
      'https://nhtsa.example/honda-accord-2020.png',
    );
    expect(result.current.noActiveVehicle).toBe(false);
  });

  it('exposes available rides once online with a seeded ride nearby', async () => {
    const setup = await setupSeededState();
    setup.ridesRepo.seed(makeAwaitingRide({ id: 'rideNear00000000000001' }));
    const { result } = renderHook(() => useDriverHomeViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    act(() => {
      result.current.onToggleOnline();
    });

    await waitFor(() => {
      expect(result.current.availableRides).toHaveLength(1);
    });
    expect(String(result.current.availableRides[0]!.id)).toBe(
      'rideNear00000000000001',
    );
  });

  it('toggling offline tears down the subscription (rides go back to empty)', async () => {
    const setup = await setupSeededState();
    setup.ridesRepo.seed(makeAwaitingRide({ id: 'rideToTearDown1234ab' }));
    const { result } = renderHook(() => useDriverHomeViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    act(() => {
      result.current.onToggleOnline();
    });
    await waitFor(() => {
      expect(result.current.availableRides).toHaveLength(1);
    });

    act(() => {
      result.current.onToggleOnline();
    });
    await waitFor(() => {
      expect(result.current.availableRides).toEqual([]);
    });
    expect(result.current.mode).toBe('offline');
  });

  it('onSelectRide navigates to DriverDispatch with the rideId', async () => {
    const setup = await setupSeededState();
    const { result } = renderHook(() => useDriverHomeViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    act(() => {
      result.current.onSelectRide('rideXyz12345678901ab');
    });
    expect(mockNavigate).toHaveBeenCalledWith('DriverDispatch', {
      rideId: 'rideXyz12345678901ab',
    });
  });

  it('redirects to DriverMonitor when the driver has an in-progress ride', async () => {
    const setup = await setupSeededState();
    // Build an awaiting ride, dispatch it to this driver, and seed it.
    const driverSnap = unwrap(
      DriverSnapshot.create({
        id: setup.uid,
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
    const dispatched = unwrap(
      makeAwaitingRide({ id: 'rideInProgress12345ab' }).dispatch({
        driver: driverSnap,
        pickupDirections: route,
        at: new Date(),
      }),
    );
    setup.ridesRepo.seed(dispatched);

    renderHook(() => useDriverHomeViewModel(), {
      wrapper: withTestContainer(setup),
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('DriverMonitor', {
        rideId: 'rideInProgress12345ab',
      });
    });
  });
});
