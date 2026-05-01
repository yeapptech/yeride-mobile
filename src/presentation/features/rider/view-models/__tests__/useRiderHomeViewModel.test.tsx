import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Coordinates } from '@domain/entities/Coordinates';
import { Email } from '@domain/entities/Email';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { ServiceArea } from '@domain/entities/ServiceArea';
import { ServiceAreaId } from '@domain/entities/ServiceAreaId';
import { makeRider } from '@domain/entities/User';
import type { UserId } from '@domain/entities/UserId';
import { useServiceAreaStore } from '@presentation/stores/useServiceAreaStore';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import {
  InMemoryAuthRepository,
  InMemoryServiceAreaRepository,
  InMemoryUserRepository,
  TestContainerProvider,
} from '@shared/testing';

import { useRiderHomeViewModel } from '../useRiderHomeViewModel';

// Navigation mock — we assert `replace`, `navigate`, and `reset` shape
// only. The auto-resume path now uses `reset` (not `replace`) to keep
// `RiderTabs` at the base of the stack so RideReceipt's `Done`
// (popToTop) has somewhere to pop to.
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockReset = jest.fn();
const focusCallbacks: (() => void)[] = [];
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    replace: mockReplace,
    reset: mockReset,
  }),
  // useFocusEffect runs the callback immediately (and once) so the
  // auto-redirect behaviour fires deterministically.
  useFocusEffect: (cb: () => void) => {
    focusCallbacks.push(cb);
    cb();
  },
}));

// expo-location mock — return a deterministic location.
// `useCurrentLocation` tries getLastKnownPositionAsync first (cheap,
// returns null instead of throwing on simulators that have a seeded
// GPS point but no fresh fix). Mock both surfaces; the test suite
// resolves to last-known immediately.
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

async function setupSeededState(): Promise<{
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
    savedPlaces: [],
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
}) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider
      auth={opts.authRepo}
      users={opts.usersRepo}
      serviceAreas={opts.serviceAreasRepo}
    >
      {children}
    </TestContainerProvider>
  );
}

describe('useRiderHomeViewModel', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockReplace.mockClear();
    mockReset.mockClear();
    focusCallbacks.length = 0;
    useServiceAreaStore.getState().reset();
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
});
