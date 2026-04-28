import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { CancellationReason } from '@domain/entities/CancellationReason';
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
import type { TripEvent } from '@domain/entities/TripEvent';
import { UserId } from '@domain/entities/UserId';
import { NetworkError } from '@domain/errors';
import { InMemoryRideRepository, TestContainerProvider } from '@shared/testing';

import { useRideMonitorViewModel } from '../useRideMonitorViewModel';

const mockNavigate = jest.fn();
const mockReset = jest.fn();
const mockReplace = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    reset: mockReset,
    replace: mockReplace,
  }),
}));

// expo-location: mock the foreground read used by useCurrentLocation,
// which the view-model composes for the geofence tick. Default returns
// a coordinate inside the pickup geofence so tests don't accidentally
// trigger the exit-warning side effect.
const mockLocationRef = { current: { latitude: 25.7617, longitude: -80.1918 } };
jest.mock('expo-location', () => ({
  __esModule: true,
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({
    status: 'granted',
  })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: mockLocationRef.current,
  })),
}));

// react-native-toast-message: mock so the chat-stub doesn't throw when
// the global Toast host isn't mounted in tests. The library exports a
// default React component with static `.show` / `.hide` methods. Use
// `jest.fn()` directly inside the factory (no outer-scope variable
// references — babel's mock hoisting forbids that) and grab a handle
// to the spy via `jest.requireMock` after the mock applies.
jest.mock('react-native-toast-message', () => {
  const show = jest.fn();
  const hide = jest.fn();
  function ToastComponent() {
    return null;
  }
  ToastComponent.show = show;
  ToastComponent.hide = hide;
  return {
    __esModule: true,
    default: ToastComponent,
  };
});

const mockToast = jest.requireMock('react-native-toast-message') as {
  default: { show: jest.Mock; hide: jest.Mock };
};
const mockToastShow = mockToast.default.show;

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

function usd(m: number) {
  return unwrap(Money.fromMajor(m, 'USD'));
}

const RIDE_ID = unwrap(RideId.create('rideAbcDef1234567890ab'));
const PASSENGER_ID = unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa'));

function makeAwaitingRide(): Ride {
  const passenger = unwrap(
    PassengerSnapshot.create({
      id: PASSENGER_ID,
      name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
      email: unwrap(Email.create('ada@yeapp.tech')),
      phoneNumber: unwrap(PhoneNumber.create('+14155551111')),
      pushToken: null,
      avatarUrl: null,
      defaultPaymentMethod: null,
    }),
  );
  const tier = unwrap(
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
  return unwrap(
    Ride.create({
      id: RIDE_ID,
      passenger,
      rideService: tier,
      pickup: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(25.7617, -80.1918)),
          address: 'Bayfront Park',
          placeName: 'Bayfront Park',
          directions: null,
        }),
      ),
      dropoff: unwrap(
        Endpoint.create({
          location: unwrap(Coordinates.create(26.1224, -80.1373)),
          address: '1 Las Olas Blvd',
          placeName: null,
          directions: null,
        }),
      ),
      createdAt: new Date('2026-04-28T10:00:00Z'),
    }),
  );
}

function withTestContainer(opts: { ridesRepo: InMemoryRideRepository }) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider rides={opts.ridesRepo}>
      {children}
    </TestContainerProvider>
  );
}

describe('useRideMonitorViewModel', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockReset.mockClear();
    mockReplace.mockClear();
  });

  it('emits null while the ride is still loading', () => {
    const ridesRepo = new InMemoryRideRepository();
    // No seed — `observeById` emits null synchronously for missing docs.
    const { result } = renderHook(
      () => useRideMonitorViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );
    expect(result.current.ride).toBeNull();
    expect(result.current.status).toBeNull();
  });

  it('emits the ride after the repo seeds it', async () => {
    const ridesRepo = new InMemoryRideRepository();
    const ride = makeAwaitingRide();
    await ridesRepo.create(ride);

    const { result } = renderHook(
      () => useRideMonitorViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );

    await waitFor(() => {
      expect(result.current.ride?.id).toBe(RIDE_ID);
    });
    expect(result.current.status).toBe('awaiting_driver');
  });

  it('reflects status transitions via the live subscription', async () => {
    const ridesRepo = new InMemoryRideRepository();
    const initial = makeAwaitingRide();
    await ridesRepo.create(initial);

    const { result } = renderHook(
      () => useRideMonitorViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('awaiting_driver');
    });

    // Cancel via the repo (simulating an admin-side write or the
    // CancelRideByRider mutation).
    const reason = unwrap(
      CancellationReason.create({ code: 'changed_mind', reasonText: null }),
    );
    await ridesRepo.cancel({
      rideId: RIDE_ID,
      by: 'rider',
      reason,
    });

    await waitFor(() => {
      expect(result.current.status).toBe('cancelled');
    });
  });

  it('redirects (navigation.reset) when status flips to cancelled', async () => {
    const ridesRepo = new InMemoryRideRepository();
    const initial = makeAwaitingRide();
    await ridesRepo.create(initial);

    renderHook(() => useRideMonitorViewModel({ rideId: RIDE_ID }), {
      wrapper: withTestContainer({ ridesRepo }),
    });

    const reason = unwrap(
      CancellationReason.create({ code: 'changed_mind', reasonText: null }),
    );
    await ridesRepo.cancel({
      rideId: RIDE_ID,
      by: 'rider',
      reason,
    });

    await waitFor(() => {
      expect(mockReset).toHaveBeenCalledWith({
        index: 0,
        routes: [{ name: 'RiderTabs' }],
      });
    });
  });

  it('cancel() returns true on success and the spy fires', async () => {
    const ridesRepo = new InMemoryRideRepository();
    const initial = makeAwaitingRide();
    await ridesRepo.create(initial);

    const { result } = renderHook(
      () => useRideMonitorViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('awaiting_driver');
    });

    const reason = unwrap(
      CancellationReason.create({ code: 'changed_mind', reasonText: null }),
    );
    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.cancel({ reason });
    });
    expect(outcome).toBe(true);
    expect(ridesRepo.spies.cancel).toBe(1);
    expect(ridesRepo.spies.lastCancelArgs?.by).toBe('rider');
  });

  it('cancel() surfaces a friendly error on mutation failure', async () => {
    const ridesRepo = new InMemoryRideRepository();
    const initial = makeAwaitingRide();
    await ridesRepo.create(initial);

    ridesRepo.mockCancelResult(
      new NetworkError({ code: 'http_500', message: 'fetch fail' }),
    );

    const { result } = renderHook(
      () => useRideMonitorViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('awaiting_driver');
    });

    const reason = unwrap(
      CancellationReason.create({ code: 'changed_mind', reasonText: null }),
    );
    let outcome: boolean | undefined;
    await act(async () => {
      outcome = await result.current.cancel({ reason });
    });
    expect(outcome).toBe(false);
    expect(result.current.cancelError).toBeTruthy();
  });

  it('emits the seeded events list', async () => {
    const ridesRepo = new InMemoryRideRepository();
    const ride = makeAwaitingRide();
    await ridesRepo.create(ride);
    const events: TripEvent[] = [
      {
        id: 'e1',
        type: 'created',
        event: 'Trip requested',
        extras: {},
        createdAt: new Date('2026-04-28T10:00:00Z'),
      },
    ];
    ridesRepo.seedEvents(RIDE_ID, events);

    const { result } = renderHook(
      () => useRideMonitorViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );

    await waitFor(() => {
      expect(result.current.events).toHaveLength(1);
    });
    expect(result.current.events[0]?.type).toBe('created');
  });

  it('redirects to RideReceipt when status flips to completed', async () => {
    const ridesRepo = new InMemoryRideRepository();
    const initial = makeAwaitingRide();
    await ridesRepo.create(initial);

    renderHook(() => useRideMonitorViewModel({ rideId: RIDE_ID }), {
      wrapper: withTestContainer({ ridesRepo }),
    });

    // Walk the entity through awaiting → dispatched → started →
    // payment_requested → completed by seeding fresh state directly.
    // (We bypass the entity transitions because building a full driver
    // snapshot + route here doesn't add coverage — repo.seed lets us
    // jump straight to the terminal state.)
    const completed = unwrap(
      Ride.fromProps({
        id: RIDE_ID,
        status: 'completed',
        passenger: initial.passenger,
        driver: null,
        rideService: initial.rideService,
        pickup: initial.pickup,
        dropoff: initial.dropoff,
        createdAt: initial.createdAt,
        pickupTiming: initial.pickupTiming,
        dropoffTiming: initial.dropoffTiming,
        cancellation: null,
        routePreference: null,
      }),
    );
    await ridesRepo.update(completed);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('RideReceipt', {
        rideId: String(RIDE_ID),
      });
    });
  });

  it('does NOT redirect for payment_failed (rider stays on RideMonitor)', async () => {
    const ridesRepo = new InMemoryRideRepository();
    const initial = makeAwaitingRide();
    await ridesRepo.create(initial);

    renderHook(() => useRideMonitorViewModel({ rideId: RIDE_ID }), {
      wrapper: withTestContainer({ ridesRepo }),
    });

    const failed = unwrap(
      Ride.fromProps({
        id: RIDE_ID,
        status: 'payment_failed',
        passenger: initial.passenger,
        driver: null,
        rideService: initial.rideService,
        pickup: initial.pickup,
        dropoff: initial.dropoff,
        createdAt: initial.createdAt,
        pickupTiming: initial.pickupTiming,
        dropoffTiming: initial.dropoffTiming,
        cancellation: null,
        routePreference: null,
      }),
    );
    await ridesRepo.update(failed);

    // Give the effect a chance to (incorrectly) fire.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('onPressChat shows a "Phase 3.5" toast', async () => {
    mockToastShow.mockClear();
    const ridesRepo = new InMemoryRideRepository();
    await ridesRepo.create(makeAwaitingRide());

    const { result } = renderHook(
      () => useRideMonitorViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('awaiting_driver');
    });

    act(() => {
      result.current.onPressChat();
    });
    expect(mockToastShow).toHaveBeenCalledTimes(1);
    expect(mockToastShow.mock.calls[0]?.[0]?.text1).toMatch(/messaging/i);
  });
});
