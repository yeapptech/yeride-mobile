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
import { PaymentFailure } from '@domain/entities/PaymentFailure';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { Ride } from '@domain/entities/Ride';
import { RideId } from '@domain/entities/RideId';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import type { TripEvent } from '@domain/entities/TripEvent';
import { UserId } from '@domain/entities/UserId';
import { UserLocation } from '@domain/entities/UserLocation';
import { NetworkError } from '@domain/errors';
import type { BgGeofenceEvent } from '@domain/services';
import {
  useChatUiStore,
  useGeofenceUiStore,
  useGpsStore,
} from '@presentation/stores';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import {
  InMemoryChatRepository,
  InMemoryLocationRepository,
  InMemoryRideRepository,
  TestContainerProvider,
} from '@shared/testing';

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

// Phase 7 turn 3: the rider VM no longer calls `useCurrentLocation` for
// the geofence path — `useGpsLifecycle` (mounted at AppContent) is the
// producer, and the VM reads via `useGpsLastGeofenceEvent`. No
// `expo-location` mock needed.

// react-native-toast-message: kept mocked because TanStack mutations or
// child components may still trigger toast surfaces via siblings.
// The rider VM no longer fires a chat toast — Phase 10 turn 8 replaced
// the Phase-3.5 stub with the real chat modal flow.
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
      stripeCustomerId: null,
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

/**
 * Build a `'dispatched'` ride directly via `Ride.fromProps` to bypass
 * the entity transitions (which would require a full `DriverSnapshot` +
 * pickup `Route`). The rider geofence banner only cares about
 * `ride.status === 'dispatched'`; constructing the driver snapshot
 * here would add noise.
 */
function makeDispatchedRide(): Ride {
  const awaiting = makeAwaitingRide();
  return unwrap(
    Ride.fromProps({
      id: awaiting.id,
      status: 'dispatched',
      passenger: awaiting.passenger,
      driver: null,
      rideService: awaiting.rideService,
      pickup: awaiting.pickup,
      dropoff: awaiting.dropoff,
      createdAt: awaiting.createdAt,
      pickupTiming: awaiting.pickupTiming,
      dropoffTiming: awaiting.dropoffTiming,
      cancellation: null,
      routePreference: null,
      schedulePickupAt: null,
      paymentFailure: null,
    }),
  );
}

let bgGeofenceTick = 1_000;
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

function withTestContainer(opts: {
  ridesRepo: InMemoryRideRepository;
  locationsRepo?: InMemoryLocationRepository;
  chatsRepo?: InMemoryChatRepository;
}) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider
      rides={opts.ridesRepo}
      {...(opts.locationsRepo ? { locations: opts.locationsRepo } : {})}
      {...(opts.chatsRepo ? { chats: opts.chatsRepo } : {})}
    >
      {children}
    </TestContainerProvider>
  );
}

describe('useRideMonitorViewModel', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockReset.mockClear();
    mockReplace.mockClear();
    // Module-scoped Zustand stores need an explicit per-test reset so
    // the rider geofence path starts clean.
    useGpsStore.getState().reset();
    useGeofenceUiStore.getState().reset();
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
        schedulePickupAt: null,
        paymentFailure: null,
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
        schedulePickupAt: null,
        paymentFailure: null,
      }),
    );
    await ridesRepo.update(failed);

    // Give the effect a chance to (incorrectly) fire.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockReset).not.toHaveBeenCalled();
  });

  /**
   * Phase 10 Turn 10.5 — when a `payment_failed` ride carries a
   * `paymentFailure` (synchronous-error path), the view-model passes
   * it straight through on `vm.ride`. The screen-level status-router
   * picks the `PaymentFailedView`, which renders code-driven copy.
   * No transform here — just a smoke that the field survives the
   * Firestore-subscription → state plumbing.
   */
  it('surfaces ride.paymentFailure to consumers (sync-error path)', async () => {
    const ridesRepo = new InMemoryRideRepository();
    const initial = makeAwaitingRide();
    await ridesRepo.create(initial);

    const { result } = renderHook(
      () => useRideMonitorViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo }) },
    );

    const failureR = PaymentFailure.create({
      code: 'trip_missing_payment_method',
      message: 'passenger.defaultPaymentMethod.id is missing',
      occurredAt: new Date('2026-05-26T12:00:00Z'),
    });
    if (!failureR.ok) throw failureR.error;

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
        schedulePickupAt: null,
        paymentFailure: failureR.value,
      }),
    );
    await ridesRepo.update(failed);

    await waitFor(() => {
      expect(result.current.status).toBe('payment_failed');
    });
    expect(result.current.ride?.paymentFailure?.code).toBe(
      'trip_missing_payment_method',
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('onPressChat opens the chat modal, sets openRideId, and fires markMessagesRead', async () => {
    useChatUiStore.getState().reset();
    const ridesRepo = new InMemoryRideRepository();
    await ridesRepo.create(makeAwaitingRide());
    const chatsRepo = new InMemoryChatRepository();

    const { result } = renderHook(
      () => useRideMonitorViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo, chatsRepo }) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('awaiting_driver');
    });

    expect(result.current.chatOpen).toBe(false);

    act(() => {
      result.current.onPressChat();
    });

    expect(result.current.chatOpen).toBe(true);
    expect(String(useChatUiStore.getState().openRideId)).toBe(String(RIDE_ID));
    // Per-ride lastReadAt stamped under this ride's key.
    expect(
      useChatUiStore.getState().lastReadAtByRide[String(RIDE_ID)],
    ).toBeInstanceOf(Date);
    // markMessagesRead fired with role='rider' (async; let it settle).
    await waitFor(() => {
      expect(chatsRepo.getMarkReadCallsFor(RIDE_ID, 'rider')).toBe(1);
    });

    // closeChat tears it down + clears the store-side flag.
    act(() => {
      result.current.closeChat();
    });
    expect(result.current.chatOpen).toBe(false);
    expect(useChatUiStore.getState().openRideId).toBe(null);
  });

  it('hasUnreadMessages is true for a peer-sent latestMessage', async () => {
    useChatUiStore.getState().reset();
    useSessionStore.getState().setSignedIn(PASSENGER_ID);
    const ridesRepo = new InMemoryRideRepository();
    await ridesRepo.create(makeAwaitingRide());
    const chatsRepo = new InMemoryChatRepository();
    const { result } = renderHook(
      () => useRideMonitorViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo, chatsRepo }) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('awaiting_driver');
    });
    const driverUid = unwrap(UserId.create('driverxxxxxxxxxxxxxxxxxxxxxx'));
    const driverName = unwrap(
      PersonName.create({ first: 'Grace', last: 'Hopper' }),
    );
    await act(async () => {
      await chatsRepo.send({
        rideId: RIDE_ID,
        sender: { id: driverUid, name: driverName },
        text: 'on my way',
      });
    });
    await waitFor(() => {
      expect(result.current.latestMessage).not.toBeNull();
    });
    expect(result.current.hasUnreadMessages).toBe(true);
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  it('hasUnreadMessages is FALSE when the latest message is the local rider’s own send (Critical #1)', async () => {
    useChatUiStore.getState().reset();
    useSessionStore.getState().setSignedIn(PASSENGER_ID);
    const ridesRepo = new InMemoryRideRepository();
    await ridesRepo.create(makeAwaitingRide());
    const chatsRepo = new InMemoryChatRepository();
    const { result } = renderHook(
      () => useRideMonitorViewModel({ rideId: RIDE_ID }),
      { wrapper: withTestContainer({ ridesRepo, chatsRepo }) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('awaiting_driver');
    });
    const riderName = unwrap(
      PersonName.create({ first: 'Ada', last: 'Lovelace' }),
    );
    await act(async () => {
      await chatsRepo.send({
        rideId: RIDE_ID,
        sender: { id: PASSENGER_ID, name: riderName },
        text: 'be there in 2',
      });
    });
    await waitFor(() => {
      expect(result.current.latestMessage).not.toBeNull();
    });
    expect(result.current.hasUnreadMessages).toBe(false);
    useSessionStore.setState({ status: 'initializing', userId: null });
  });

  describe('pickup geofence banner (Phase 7 turn 3)', () => {
    it('EXIT event during dispatched flips pickupExitWarningVisible to true', async () => {
      const ridesRepo = new InMemoryRideRepository();
      ridesRepo.seed(makeDispatchedRide());

      const { result } = renderHook(
        () => useRideMonitorViewModel({ rideId: RIDE_ID }),
        { wrapper: withTestContainer({ ridesRepo }) },
      );
      await waitFor(() => {
        expect(result.current.status).toBe('dispatched');
      });
      // Sanity: banner starts hidden after store reset.
      expect(useGeofenceUiStore.getState().pickupExitWarningVisible).toBe(
        false,
      );

      act(() => {
        useGpsStore.getState().setGeofenceEvent(bgGeofenceEvent('EXIT'));
      });

      await waitFor(() => {
        expect(useGeofenceUiStore.getState().pickupExitWarningVisible).toBe(
          true,
        );
      });
    });

    it('ENTER event after EXIT dismisses the banner', async () => {
      const ridesRepo = new InMemoryRideRepository();
      ridesRepo.seed(makeDispatchedRide());

      const { result } = renderHook(
        () => useRideMonitorViewModel({ rideId: RIDE_ID }),
        { wrapper: withTestContainer({ ridesRepo }) },
      );
      await waitFor(() => {
        expect(result.current.status).toBe('dispatched');
      });

      act(() => {
        useGpsStore.getState().setGeofenceEvent(bgGeofenceEvent('EXIT'));
      });
      await waitFor(() => {
        expect(useGeofenceUiStore.getState().pickupExitWarningVisible).toBe(
          true,
        );
      });

      act(() => {
        useGpsStore.getState().setGeofenceEvent(bgGeofenceEvent('ENTER'));
      });
      await waitFor(() => {
        expect(useGeofenceUiStore.getState().pickupExitWarningVisible).toBe(
          false,
        );
      });
    });

    it('EXIT event during awaiting_driver does NOT show the banner (status gate)', async () => {
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
        useGpsStore.getState().setGeofenceEvent(bgGeofenceEvent('EXIT'));
      });

      // Give the effect a tick to (incorrectly) fire.
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      expect(useGeofenceUiStore.getState().pickupExitWarningVisible).toBe(
        false,
      );
    });

    it('status leaving dispatched dismisses a visible banner', async () => {
      const ridesRepo = new InMemoryRideRepository();
      const dispatched = makeDispatchedRide();
      ridesRepo.seed(dispatched);

      const { result } = renderHook(
        () => useRideMonitorViewModel({ rideId: RIDE_ID }),
        { wrapper: withTestContainer({ ridesRepo }) },
      );
      await waitFor(() => {
        expect(result.current.status).toBe('dispatched');
      });

      act(() => {
        useGpsStore.getState().setGeofenceEvent(bgGeofenceEvent('EXIT'));
      });
      await waitFor(() => {
        expect(useGeofenceUiStore.getState().pickupExitWarningVisible).toBe(
          true,
        );
      });

      // Server-side flip into 'started' (rider boarded). The banner is
      // irrelevant from this point — defensive dismiss.
      const started = unwrap(
        Ride.fromProps({
          id: dispatched.id,
          status: 'started',
          passenger: dispatched.passenger,
          driver: null,
          rideService: dispatched.rideService,
          pickup: dispatched.pickup,
          dropoff: dispatched.dropoff,
          createdAt: dispatched.createdAt,
          pickupTiming: dispatched.pickupTiming,
          dropoffTiming: dispatched.dropoffTiming,
          cancellation: null,
          routePreference: null,
          schedulePickupAt: null,
          paymentFailure: null,
        }),
      );
      await ridesRepo.update(started);

      await waitFor(() => {
        expect(result.current.status).toBe('started');
      });
      expect(useGeofenceUiStore.getState().pickupExitWarningVisible).toBe(
        false,
      );
    });

    it('non-pickup identifier event is ignored', async () => {
      const ridesRepo = new InMemoryRideRepository();
      ridesRepo.seed(makeDispatchedRide());

      const { result } = renderHook(
        () => useRideMonitorViewModel({ rideId: RIDE_ID }),
        { wrapper: withTestContainer({ ridesRepo }) },
      );
      await waitFor(() => {
        expect(result.current.status).toBe('dispatched');
      });

      act(() => {
        // Future-proof: a 'dropoff' geofence we might register in a
        // later phase shouldn't drive the pickup banner.
        useGpsStore
          .getState()
          .setGeofenceEvent(bgGeofenceEvent('EXIT', 'dropoff'));
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      expect(useGeofenceUiStore.getState().pickupExitWarningVisible).toBe(
        false,
      );
    });
  });

  describe('bgPermissionDenied (Phase 9 turn 10)', () => {
    it('false when permission is granted regardless of status', async () => {
      const ridesRepo = new InMemoryRideRepository();
      ridesRepo.seed(makeDispatchedRide());
      // Pre-flip the store to a granted state so the read is clean.
      act(() => {
        useGpsStore.getState().setPermissionStatus('always');
      });

      const { result } = renderHook(
        () => useRideMonitorViewModel({ rideId: RIDE_ID }),
        { wrapper: withTestContainer({ ridesRepo }) },
      );
      await waitFor(() => {
        expect(result.current.status).toBe('dispatched');
      });
      expect(result.current.bgPermissionDenied).toBe(false);
    });

    it('true when permission is denied AND status is dispatched', async () => {
      const ridesRepo = new InMemoryRideRepository();
      ridesRepo.seed(makeDispatchedRide());
      act(() => {
        useGpsStore.getState().setPermissionStatus('denied');
      });

      const { result } = renderHook(
        () => useRideMonitorViewModel({ rideId: RIDE_ID }),
        { wrapper: withTestContainer({ ridesRepo }) },
      );
      await waitFor(() => {
        expect(result.current.status).toBe('dispatched');
      });
      expect(result.current.bgPermissionDenied).toBe(true);
    });

    it("false when permission is 'undetermined' (pre-OS-dialog window)", async () => {
      const ridesRepo = new InMemoryRideRepository();
      ridesRepo.seed(makeDispatchedRide());
      // Default INITIAL is 'undetermined' after reset; assert explicitly
      // for clarity.
      expect(useGpsStore.getState().permissionStatus).toBe('undetermined');

      const { result } = renderHook(
        () => useRideMonitorViewModel({ rideId: RIDE_ID }),
        { wrapper: withTestContainer({ ridesRepo }) },
      );
      await waitFor(() => {
        expect(result.current.status).toBe('dispatched');
      });
      expect(result.current.bgPermissionDenied).toBe(false);
    });

    it('false when permission is denied but status is awaiting_driver', async () => {
      const ridesRepo = new InMemoryRideRepository();
      await ridesRepo.create(makeAwaitingRide());
      act(() => {
        useGpsStore.getState().setPermissionStatus('denied');
      });

      const { result } = renderHook(
        () => useRideMonitorViewModel({ rideId: RIDE_ID }),
        { wrapper: withTestContainer({ ridesRepo }) },
      );
      await waitFor(() => {
        expect(result.current.status).toBe('awaiting_driver');
      });
      // Pre-trip status — banner shouldn't surface (legacy parity:
      // degraded ETA on a not-yet-dispatched ride isn't actionable).
      expect(result.current.bgPermissionDenied).toBe(false);
    });

    it('exposes onOpenSettings as a stable callback', async () => {
      const ridesRepo = new InMemoryRideRepository();
      ridesRepo.seed(makeDispatchedRide());

      const { result } = renderHook(
        () => useRideMonitorViewModel({ rideId: RIDE_ID }),
        { wrapper: withTestContainer({ ridesRepo }) },
      );
      await waitFor(() => {
        expect(result.current.status).toBe('dispatched');
      });
      expect(typeof result.current.onOpenSettings).toBe('function');
    });
  });

  /**
   * Phase 10 turn 5 — live ETA consumption. The VM subscribes to the
   * driver's `users/{uid}.location` doc via `SubscribeToUserLocation`
   * keyed on `ride.driver?.id`. The two surfaced fields
   * (`liveDurationSeconds` / `liveDistanceMeters`) read directly
   * from `UserLocation.tripTracking`.
   */
  describe('liveDurationSeconds / liveDistanceMeters (Phase 10 turn 5)', () => {
    const DRIVER_ID = unwrap(UserId.create('driverxxxxxxxxxxxxxxxxxxxxxx'));

    function makeDriverSnapshot(): DriverSnapshot {
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

    function makeDispatchedRideWithDriver(): Ride {
      const awaiting = makeAwaitingRide();
      return unwrap(
        Ride.fromProps({
          id: awaiting.id,
          status: 'dispatched',
          passenger: awaiting.passenger,
          driver: makeDriverSnapshot(),
          rideService: awaiting.rideService,
          pickup: awaiting.pickup,
          dropoff: awaiting.dropoff,
          createdAt: awaiting.createdAt,
          pickupTiming: awaiting.pickupTiming,
          dropoffTiming: awaiting.dropoffTiming,
          cancellation: null,
          routePreference: null,
          schedulePickupAt: null,
          paymentFailure: null,
        }),
      );
    }

    function makeDriverLocationWithLiveEta(args: {
      readonly distanceMeters: number | null;
      readonly durationSeconds: number | null;
    }): UserLocation {
      return unwrap(
        UserLocation.create({
          userId: DRIVER_ID,
          location: unwrap(Coordinates.create(25.79, -80.2)),
          speed: 12,
          updatedAt: new Date('2026-04-28T10:01:00Z'),
          tripTracking: {
            tripId: RIDE_ID,
            tripStatus: 'dispatched',
            destination: {
              type: 'pickup',
              location: unwrap(Coordinates.create(25.7617, -80.1918)),
            },
            distanceMeters: args.distanceMeters,
            durationSeconds: args.durationSeconds,
            updatedAt: new Date('2026-04-28T10:01:00Z'),
          },
        }),
      );
    }

    it('emits null until a driver-location with telemetry arrives', async () => {
      const ridesRepo = new InMemoryRideRepository();
      const locationsRepo = new InMemoryLocationRepository();
      ridesRepo.seed(makeDispatchedRideWithDriver());

      const { result } = renderHook(
        () => useRideMonitorViewModel({ rideId: RIDE_ID }),
        {
          wrapper: withTestContainer({ ridesRepo, locationsRepo }),
        },
      );
      await waitFor(() => {
        expect(result.current.status).toBe('dispatched');
      });
      // No driver-location doc yet — both live fields null.
      expect(result.current.liveDurationSeconds).toBeNull();
      expect(result.current.liveDistanceMeters).toBeNull();
    });

    it('surfaces live ETA values once the driver doc is written', async () => {
      const ridesRepo = new InMemoryRideRepository();
      const locationsRepo = new InMemoryLocationRepository();
      ridesRepo.seed(makeDispatchedRideWithDriver());

      const { result } = renderHook(
        () => useRideMonitorViewModel({ rideId: RIDE_ID }),
        {
          wrapper: withTestContainer({ ridesRepo, locationsRepo }),
        },
      );
      await waitFor(() => {
        expect(result.current.status).toBe('dispatched');
      });

      // Driver pipeline writes its location doc with tripTracking.
      await act(async () => {
        await locationsRepo.updateLocation(
          makeDriverLocationWithLiveEta({
            distanceMeters: 2500,
            durationSeconds: 300,
          }),
        );
      });
      await waitFor(() => {
        expect(result.current.liveDurationSeconds).toBe(300);
      });
      expect(result.current.liveDistanceMeters).toBe(2500);
    });

    it('keeps live fields null when tripTracking is route-metadata-only (pre-first-telemetry)', async () => {
      const ridesRepo = new InMemoryRideRepository();
      const locationsRepo = new InMemoryLocationRepository();
      ridesRepo.seed(makeDispatchedRideWithDriver());

      const { result } = renderHook(
        () => useRideMonitorViewModel({ rideId: RIDE_ID }),
        {
          wrapper: withTestContainer({ ridesRepo, locationsRepo }),
        },
      );
      await waitFor(() => {
        expect(result.current.status).toBe('dispatched');
      });

      await act(async () => {
        await locationsRepo.updateLocation(
          makeDriverLocationWithLiveEta({
            distanceMeters: null,
            durationSeconds: null,
          }),
        );
      });
      // Doc arrived but no live telemetry yet — VM keeps both as null
      // so the views can fall back to static `ride.pickup.directions`.
      await new Promise((r) => setTimeout(r, 20));
      expect(result.current.liveDurationSeconds).toBeNull();
      expect(result.current.liveDistanceMeters).toBeNull();
    });

    it('does NOT subscribe when no driver is assigned', async () => {
      const ridesRepo = new InMemoryRideRepository();
      const locationsRepo = new InMemoryLocationRepository();
      const ride = makeAwaitingRide(); // status: awaiting_driver, driver: null
      await ridesRepo.create(ride);

      const { result } = renderHook(
        () => useRideMonitorViewModel({ rideId: RIDE_ID }),
        {
          wrapper: withTestContainer({ ridesRepo, locationsRepo }),
        },
      );
      await waitFor(() => {
        expect(result.current.status).toBe('awaiting_driver');
      });
      // Live fields stay null; no subscribeToLocation calls.
      expect(result.current.liveDurationSeconds).toBeNull();
      expect(result.current.liveDistanceMeters).toBeNull();
    });

    it('ignores stale tripTracking from a previous trip (tripId mismatch)', async () => {
      // Regression — Phase 10 turn 5 review fix. Nothing clears
      // `users/{driverId}.location.tripTracking` at trip end, so a
      // driver's location doc can carry the previous ride's
      // tripTracking when they're dispatched for a new ride. The VM
      // must NOT surface those values on the new ride — gate on
      // `tripTracking.tripId === ride.id`.
      const ridesRepo = new InMemoryRideRepository();
      const locationsRepo = new InMemoryLocationRepository();
      ridesRepo.seed(makeDispatchedRideWithDriver());

      const { result } = renderHook(
        () => useRideMonitorViewModel({ rideId: RIDE_ID }),
        {
          wrapper: withTestContainer({ ridesRepo, locationsRepo }),
        },
      );
      await waitFor(() => {
        expect(result.current.status).toBe('dispatched');
      });

      // Seed a driver-location doc whose tripTracking points at a
      // DIFFERENT, terminated ride. Same driver id, same location
      // shape, just a stale tripId.
      const otherRideId = unwrap(RideId.create('rideZyxWvu0987654321zy'));
      const stalePayload = unwrap(
        UserLocation.create({
          userId: DRIVER_ID,
          location: unwrap(Coordinates.create(25.79, -80.2)),
          speed: 12,
          updatedAt: new Date('2026-04-28T10:01:00Z'),
          tripTracking: {
            tripId: otherRideId,
            tripStatus: 'dispatched',
            destination: {
              type: 'pickup',
              location: unwrap(Coordinates.create(25.7617, -80.1918)),
            },
            distanceMeters: 9999,
            durationSeconds: 1234,
            updatedAt: new Date('2026-04-28T10:01:00Z'),
          },
        }),
      );
      await act(async () => {
        await locationsRepo.updateLocation(stalePayload);
      });
      // Give the subscription a tick to deliver the emission, then
      // assert the stale telemetry is filtered out.
      await new Promise((r) => setTimeout(r, 20));
      expect(result.current.liveDurationSeconds).toBeNull();
      expect(result.current.liveDistanceMeters).toBeNull();

      // Sanity check the gate flips open when the driver writes for
      // the CURRENT ride.
      await act(async () => {
        await locationsRepo.updateLocation(
          makeDriverLocationWithLiveEta({
            distanceMeters: 2500,
            durationSeconds: 300,
          }),
        );
      });
      await waitFor(() => {
        expect(result.current.liveDurationSeconds).toBe(300);
      });
      expect(result.current.liveDistanceMeters).toBe(2500);
    });
  });
});
