import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Address } from '@domain/entities/Address';
import { Coordinates } from '@domain/entities/Coordinates';
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
import { SavedPlace, SavedPlaceId } from '@domain/entities/SavedPlace';
import { ServiceArea } from '@domain/entities/ServiceArea';
import { ServiceAreaId } from '@domain/entities/ServiceAreaId';
import { makeRider } from '@domain/entities/User';
import type { UserId } from '@domain/entities/UserId';
import { useGpsStore } from '@presentation/stores/useGpsStore';
import { useServiceAreaStore } from '@presentation/stores/useServiceAreaStore';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import { useTripDraftStore } from '@presentation/stores/useTripDraftStore';
import {
  InMemoryAuthRepository,
  InMemoryRideRepository,
  InMemoryServiceAreaRepository,
  InMemoryUserRepository,
  TestContainerProvider,
} from '@shared/testing';

import { useRiderHomeViewModel } from '../useRiderHomeViewModel';

// Navigation mock — `navigate` is used by the VM for goToRouteSearch and
// resumeRide; `reset` is mocked only so the no-auto-route test can assert
// it was never called.
const mockNavigate = jest.fn();
const mockReset = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    reset: mockReset,
  }),
}));

// expo-location mock — return a deterministic location.
// `useCurrentLocation` tries getLastKnownPositionAsync first (cheap,
// returns null instead of throwing on simulators that have a seeded
// GPS point but no fresh fix). Mock both surfaces; the test suite
// resolves to last-known immediately.
// Captures every `watchPositionAsync` callback so a test can emit a moving
// foreground fix and assert `liveLocation` follows it.
const mockWatchCallbacks: Array<
  (reading: {
    coords: { latitude: number; longitude: number; heading?: number | null };
  }) => void
> = [];

jest.mock('expo-location', () => ({
  __esModule: true,
  Accuracy: { Balanced: 3, Lowest: 1 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({
    status: 'granted',
  })),
  getLastKnownPositionAsync: jest.fn(async () => ({
    coords: { latitude: 25.7617, longitude: -80.1918 },
  })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: 25.7617, longitude: -80.1918 },
  })),
  watchPositionAsync: jest.fn(async (_opts, cb) => {
    mockWatchCallbacks.push(cb);
    return { remove: jest.fn() };
  }),
}));

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const AREA_ID = unwrap(ServiceAreaId.create('miami'));

function makeArea(): ServiceArea {
  return unwrap(
    ServiceArea.create({
      id: AREA_ID,
      identifier: 'miami',
      center: unwrap(Coordinates.create(25.7617, -80.1918)),
      radiusMeters: 50_000,
      notifyOnEntry: true,
      notifyOnDwell: false,
      notifyOnExit: true,
    }),
  );
}

const usd = (major: number) => unwrap(Money.fromMajor(major, 'USD'));

function makeAwaitingRiderRide(uid: UserId, id: string): Ride {
  const passenger = unwrap(
    PassengerSnapshot.create({
      id: uid,
      name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
      email: unwrap(Email.create('rider2@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
      pushToken: null,
      avatarUrl: null,
      stripeCustomerId: null,
      defaultPaymentMethod: null,
    }),
  );
  const service = unwrap(
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
  const miami = unwrap(Coordinates.create(25.7617, -80.1918));
  const lauderdale = unwrap(Coordinates.create(26.1224, -80.1373));
  return unwrap(
    Ride.create({
      id: unwrap(RideId.create(id)),
      passenger,
      rideService: service,
      pickup: unwrap(
        Endpoint.create({
          location: miami,
          address: 'pickup',
          placeName: null,
          directions: null,
        }),
      ),
      dropoff: unwrap(
        Endpoint.create({
          location: lauderdale,
          address: 'dropoff',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: new Date(),
    }),
  );
}

function makeScheduledRiderRide(uid: UserId, id: string): Ride {
  const base = makeAwaitingRiderRide(uid, id);
  return unwrap(
    Ride.createScheduled({
      id: base.id,
      passenger: base.passenger,
      rideService: base.rideService,
      pickup: base.pickup,
      dropoff: base.dropoff,
      createdAt: base.createdAt,
      schedulePickupAt: new Date(base.createdAt.getTime() + 60 * 60_000),
    }),
  );
}

function makeSavedPlace(label: string, id: string): SavedPlace {
  return unwrap(
    SavedPlace.create({
      id: unwrap(SavedPlaceId.create(id)),
      label,
      address: unwrap(
        Address.create({
          label: `${label} address`,
          coordinates: unwrap(Coordinates.create(25.77, -80.19)),
          placeId: `place_${id}`,
        }),
      ),
    }),
  );
}

async function setupSeededState(opts?: {
  savedPlaces?: readonly SavedPlace[];
}): Promise<{
  authRepo: InMemoryAuthRepository;
  usersRepo: InMemoryUserRepository;
  serviceAreasRepo: InMemoryServiceAreaRepository;
  uid: UserId;
}> {
  const authRepo = new InMemoryAuthRepository();
  await authRepo.signIn({
    email: unwrap(Email.create('rider@yeapp.tech')),
    password: 'pw1234',
  });
  // The InMemoryAuthRepository's signIn creates a user when the email is
  // unknown; for these tests we don't care about credentials so we'll
  // skip and seed userId directly via signUp instead.
  const signUpR = await authRepo.signUp({
    email: unwrap(Email.create('rider2@yeapp.tech')),
    password: 'pw1234',
  });
  const uid = unwrap(signUpR);

  const usersRepo = new InMemoryUserRepository();
  const rider = makeRider({
    id: uid,
    email: unwrap(Email.create('rider2@yeapp.tech')),
    emailVerified: true,
    name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
    phone: unwrap(PhoneNumber.create('+14155551111')),
    avatarUrl: null,
    savedPlaces: opts?.savedPlaces ?? [],
    createdAt: new Date(),
    updatedAt: new Date(),
    stripeCustomerId: null,
  });
  await usersRepo.create(rider);

  const serviceAreasRepo = new InMemoryServiceAreaRepository();
  serviceAreasRepo.reset({
    areas: [makeArea()],
    services: { [String(AREA_ID)]: [] },
  });

  // Production wires this in AppContent's auth observer; the test
  // emulates that by setting the session store directly so the
  // user-query is enabled.
  useSessionStore.getState().setSignedIn(uid);

  return { authRepo, usersRepo, serviceAreasRepo, uid };
}

function withTestContainer(opts: {
  authRepo: InMemoryAuthRepository;
  usersRepo: InMemoryUserRepository;
  serviceAreasRepo: InMemoryServiceAreaRepository;
  ridesRepo?: InMemoryRideRepository;
}) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider
      auth={opts.authRepo}
      users={opts.usersRepo}
      serviceAreas={opts.serviceAreasRepo}
      {...(opts.ridesRepo !== undefined ? { rides: opts.ridesRepo } : {})}
    >
      {children}
    </TestContainerProvider>
  );
}

describe('useRiderHomeViewModel', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockReset.mockClear();
    mockWatchCallbacks.length = 0;
    useGpsStore.getState().reset();
    useServiceAreaStore.getState().reset();
    useTripDraftStore.getState().reset();
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it('reaches "ready" status with location + active area resolved', async () => {
    const setup = await setupSeededState();
    const { result } = renderHook(() => useRiderHomeViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.activeServiceArea?.identifier).toBe('miami');
    expect(result.current.user?.email.value).toBe('rider2@yeapp.tech');
  });

  it('liveLocation prefers the live BG-geolocation stream, falling back to the foreground read before it emits', async () => {
    const fortLauderdale = unwrap(Coordinates.create(26.1224, -80.1373));
    const setup = await setupSeededState();
    const { result } = renderHook(() => useRiderHomeViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    // Before any BG fix: the one-shot foreground read (mocked → Miami)
    // drives the camera + "you are here" pin.
    expect(result.current.liveLocation?.latitude).toBeCloseTo(25.7617);
    expect(result.current.liveLocation?.longitude).toBeCloseTo(-80.1918);

    // A fresh BG fix must win so the map follows the rider as they move.
    act(() => {
      useGpsStore.getState().setLocation({
        coords: fortLauderdale,
        speed: null,
        heading: null,
        odometerMeters: 0,
        timestampMs: 1,
        isMoving: true,
      });
    });
    expect(result.current.liveLocation).toBe(fortLauderdale);
  });

  it('liveLocation follows the foreground watch when the BG stream stays silent (emulator case)', async () => {
    const setup = await setupSeededState();
    const { result } = renderHook(() => useRiderHomeViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    await waitFor(() => {
      expect(mockWatchCallbacks.length).toBeGreaterThan(0);
    });

    act(() => {
      mockWatchCallbacks.forEach((cb) =>
        cb({ coords: { latitude: 26.2, longitude: -80.3, heading: null } }),
      );
    });

    expect(result.current.liveLocation?.latitude).toBeCloseTo(26.2);
    expect(result.current.liveLocation?.longitude).toBeCloseTo(-80.3);
  });

  it('writes the resolved active area into the service-area store', async () => {
    const setup = await setupSeededState();
    renderHook(() => useRiderHomeViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(useServiceAreaStore.getState().activeAreaId).toBe(AREA_ID);
    });
  });

  it('goToRouteSearch navigates to RouteSearch', async () => {
    const setup = await setupSeededState();
    const { result } = renderHook(() => useRiderHomeViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    act(() => {
      result.current.goToRouteSearch();
    });
    expect(mockNavigate).toHaveBeenCalledWith('RouteSearch');
  });

  it('resumeRide navigates to RideMonitor with the given rideId', async () => {
    const setup = await setupSeededState();
    const { result } = renderHook(() => useRiderHomeViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    act(() => {
      result.current.resumeRide('rideAbc1234567890ab');
    });
    expect(mockNavigate).toHaveBeenCalledWith('RideMonitor', {
      rideId: 'rideAbc1234567890ab',
    });
  });

  it('exposes in-progress rides from the live subscription', async () => {
    const setup = await setupSeededState();
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeAwaitingRiderRide(setup.uid, 'riderLive000000001ab'));

    const { result } = renderHook(() => useRiderHomeViewModel(), {
      wrapper: withTestContainer({ ...setup, ridesRepo }),
    });

    await waitFor(() => {
      expect(result.current.inProgressRides).toHaveLength(1);
    });
    expect(String(result.current.inProgressRides[0]?.id)).toBe(
      'riderLive000000001ab',
    );
  });

  it('exposes scheduled rides from the live subscription', async () => {
    const setup = await setupSeededState();
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeScheduledRiderRide(setup.uid, 'riderSched00000001ab'));

    const { result } = renderHook(() => useRiderHomeViewModel(), {
      wrapper: withTestContainer({ ...setup, ridesRepo }),
    });

    await waitFor(() => {
      expect(result.current.scheduledRides).toHaveLength(1);
    });
  });

  it('exposes the user saved places (Home / Work)', async () => {
    const places = [
      makeSavedPlace('Home', 'home000000000001'),
      makeSavedPlace('Work', 'work000000000001'),
    ];
    const setup = await setupSeededState({ savedPlaces: places });
    const { result } = renderHook(() => useRiderHomeViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.savedPlaces.map((p) => p.label)).toEqual([
      'Home',
      'Work',
    ]);
  });

  it('goToSavedPlace prefills the draft dropoff and opens RouteSearch', async () => {
    const home = makeSavedPlace('Home', 'home000000000001');
    const setup = await setupSeededState({ savedPlaces: [home] });
    const { result } = renderHook(() => useRiderHomeViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.savedPlaces).toHaveLength(1);
    });

    act(() => {
      result.current.goToSavedPlace(home);
    });

    const dropoff = useTripDraftStore.getState().dropoff;
    expect(dropoff?.placeName).toBe('Home');
    expect(dropoff?.address).toBe('Home address');
    expect(mockNavigate).toHaveBeenCalledWith('RouteSearch');
  });

  it('does NOT auto-route to RideMonitor when an in-progress ride exists', async () => {
    const setup = await setupSeededState();
    const ridesRepo = new InMemoryRideRepository();
    ridesRepo.seed(makeAwaitingRiderRide(setup.uid, 'riderNoRoute0001ab12'));

    const { result } = renderHook(() => useRiderHomeViewModel(), {
      wrapper: withTestContainer({ ...setup, ridesRepo }),
    });

    await waitFor(() => {
      expect(result.current.inProgressRides).toHaveLength(1);
    });
    expect(mockReset).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalledWith(
      'RideMonitor',
      expect.anything(),
    );
  });
});
