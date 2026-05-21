import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Coordinates } from '@domain/entities/Coordinates';
import { Email } from '@domain/entities/Email';
import { Endpoint } from '@domain/entities/Endpoint';
import { Money } from '@domain/entities/Money';
import { PaymentMethodId } from '@domain/entities/PaymentMethodId';
import { PersonName } from '@domain/entities/PersonName';
import { PhoneNumber } from '@domain/entities/PhoneNumber';
import { RideService } from '@domain/entities/RideService';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { Route } from '@domain/entities/Route';
import { ServiceArea } from '@domain/entities/ServiceArea';
import { ServiceAreaId } from '@domain/entities/ServiceAreaId';
import { StripeCustomerId } from '@domain/entities/StripeCustomerId';
import { makeRider } from '@domain/entities/User';
import type { UserId } from '@domain/entities/UserId';
import { NetworkError, NotFoundError } from '@domain/errors';
import { useServiceAreaStore } from '@presentation/stores/useServiceAreaStore';
import { useSessionStore } from '@presentation/stores/useSessionStore';
import { useTripDraftStore } from '@presentation/stores/useTripDraftStore';
import {
  FakeRoutesService,
  InMemoryAuthRepository,
  InMemoryRideRepository,
  InMemoryServiceAreaRepository,
  InMemoryUserRepository,
  TestContainerProvider,
} from '@shared/testing';

import { useRouteSelectViewModel } from '../useRouteSelectViewModel';

// Navigation mock — only `navigate` is read by the VM.
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
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

const PICKUP = unwrap(
  Endpoint.create({
    location: MIAMI,
    address: 'Bayfront Park, Miami, FL',
    placeName: 'Bayfront Park',
    directions: null,
  }),
);

const DROPOFF = unwrap(
  Endpoint.create({
    location: FORT_LAUDERDALE,
    address: '1 Las Olas Blvd, Fort Lauderdale, FL',
    placeName: null,
    directions: null,
  }),
);

const AREA_ID = unwrap(ServiceAreaId.create('miami'));
const ECONOMY_ID = unwrap(RideServiceId.create('economy'));
const PREMIUM_ID = unwrap(RideServiceId.create('premium'));

function makeService(
  id: RideServiceId,
  name: string,
  pricing?: Partial<{
    baseFare: number;
    minimumFare: number;
    costPerKm: number;
    costPerMinute: number;
  }>,
): RideService {
  return unwrap(
    RideService.create({
      id,
      areaId: AREA_ID,
      name,
      description: '',
      baseFare: usd(pricing?.baseFare ?? 2.5),
      minimumFare: usd(pricing?.minimumFare ?? 5),
      cancelationFee: usd(2),
      seatCapacity: 4,
      costPerKm: usd(pricing?.costPerKm ?? 1.25),
      costPerMinute: usd(pricing?.costPerMinute ?? 0.2),
    }),
  );
}

function makeRoute(args: {
  distanceMeters: number;
  durationSeconds: number;
  routeToken?: string;
}): Route {
  return unwrap(
    Route.create({
      distanceMeters: args.distanceMeters,
      durationSeconds: args.durationSeconds,
      distanceText: '',
      durationText: '',
      encodedPolyline: '',
      startLocation: MIAMI,
      endLocation: FORT_LAUDERDALE,
      routeLabels: [],
      tollPrice: null,
      routeToken: args.routeToken ?? 'tk',
      description: '',
    }),
  );
}

function withTestContainer(opts: {
  serviceAreasRepo: InMemoryServiceAreaRepository;
  routesService: FakeRoutesService;
  authRepo?: InMemoryAuthRepository;
  usersRepo?: InMemoryUserRepository;
  ridesRepo?: InMemoryRideRepository;
}) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider
      serviceAreas={opts.serviceAreasRepo}
      routes={opts.routesService}
      {...(opts.authRepo ? { auth: opts.authRepo } : {})}
      {...(opts.usersRepo ? { users: opts.usersRepo } : {})}
      {...(opts.ridesRepo ? { rides: opts.ridesRepo } : {})}
    >
      {children}
    </TestContainerProvider>
  );
}

/**
 * Seed a rider into the auth/users repos with an optional default payment
 * method, and set the session-store userId so `useCurrentUserQuery`'s
 * `enabled` gate fires. Used by the confirm()-flow tests.
 */
async function seedRider(opts: {
  authRepo: InMemoryAuthRepository;
  usersRepo: InMemoryUserRepository;
  defaultPaymentMethodId: PaymentMethodId | null;
}): Promise<UserId> {
  const email = 'rider@yeapp.tech';
  opts.authRepo.seedAccount({ email, password: 'hunter22' });
  await opts.authRepo.signIn({
    email: unwrap(Email.create(email)),
    password: 'hunter22',
  });
  const uid = (await opts.authRepo.currentUserId()) as UserId;
  opts.usersRepo.seed(
    makeRider({
      id: uid,
      email: unwrap(Email.create(email)),
      name: unwrap(PersonName.create({ first: 'Ada', last: 'Lovelace' })),
      phone: unwrap(PhoneNumber.create('+13055551234')),
      createdAt: new Date('2026-04-29T12:00:00Z'),
      updatedAt: new Date('2026-04-29T12:00:00Z'),
      stripeCustomerId: unwrap(StripeCustomerId.create('cus_RiderTest001')),
      defaultPaymentMethodId: opts.defaultPaymentMethodId,
    }),
  );
  useSessionStore.getState().setSignedIn(uid);
  return uid;
}

async function setupSeededState(): Promise<{
  serviceAreasRepo: InMemoryServiceAreaRepository;
  routesService: FakeRoutesService;
}> {
  const area = unwrap(
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
  const economy = makeService(ECONOMY_ID, 'Economy');
  const premium = makeService(PREMIUM_ID, 'Premium', {
    baseFare: 5,
    costPerKm: 2.5,
    costPerMinute: 0.4,
  });

  const serviceAreasRepo = new InMemoryServiceAreaRepository();
  serviceAreasRepo.reset({
    areas: [area],
    services: { [String(AREA_ID)]: [economy, premium] },
  });
  const routesService = new FakeRoutesService();

  // The view-model reads the active area from the store, which is what
  // RiderHome will populate in turn 3.3. For the test, prime it directly.
  useServiceAreaStore.getState().setReady([area]);
  useServiceAreaStore.getState().setActiveArea(AREA_ID);

  // Pickup / dropoff come from the trip-draft store.
  useTripDraftStore.getState().setPickup(PICKUP);
  useTripDraftStore.getState().setDropoff(DROPOFF);

  return { serviceAreasRepo, routesService };
}

describe('useRouteSelectViewModel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useTripDraftStore.getState().reset();
    useServiceAreaStore.getState().reset();
    // Reset session-store between tests so seedRider() in one test
    // doesn't leak into another that doesn't seed a user.
    useSessionStore.setState({ status: 'initializing', userId: null });
    mockNavigate.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('redirects to RouteSearch when pickup is missing', () => {
    const setup = makeSetupWithoutEndpoints();
    renderHook(() => useRouteSelectViewModel(), {
      wrapper: withTestContainer(setup),
    });
    expect(mockNavigate).toHaveBeenCalledWith('RouteSearch');
  });

  it('loads ride-services from the active area', async () => {
    const setup = await setupSeededState();
    const { result } = renderHook(() => useRouteSelectViewModel(), {
      wrapper: withTestContainer(setup),
    });
    await waitFor(() => {
      expect(result.current.services).toHaveLength(2);
    });
    expect(result.current.services.map((s) => s.name)).toEqual([
      'Economy',
      'Premium',
    ]);
  });

  it('computes route alternatives after a debounce', async () => {
    const setup = await setupSeededState();
    const route1 = makeRoute({
      distanceMeters: 30_000,
      durationSeconds: 1_500,
      routeToken: 'r1',
    });
    const route2 = makeRoute({
      distanceMeters: 35_000,
      durationSeconds: 1_400,
      routeToken: 'r2',
    });
    setup.routesService.seed([route1, route2]);

    const { result } = renderHook(() => useRouteSelectViewModel(), {
      wrapper: withTestContainer(setup),
    });

    expect(result.current.status).toBe('loading');
    // Advance the debounce.
    act(() => {
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.routes).toHaveLength(2);
  });

  it('exposes per-service fare for the selected route', async () => {
    const setup = await setupSeededState();
    const route = makeRoute({ distanceMeters: 10_000, durationSeconds: 900 });
    setup.routesService.seed([route]);

    const { result } = renderHook(() => useRouteSelectViewModel(), {
      wrapper: withTestContainer(setup),
    });
    act(() => {
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    const economyFare = result.current.fareById.get(String(ECONOMY_ID));
    const premiumFare = result.current.fareById.get(String(PREMIUM_ID));
    expect(economyFare).not.toBeNull();
    expect(premiumFare).not.toBeNull();
    if (economyFare && premiumFare) {
      expect(premiumFare.minorUnits).toBeGreaterThan(economyFare.minorUnits);
    }
  });

  it('refetches when avoidTolls flips', async () => {
    const setup = await setupSeededState();
    const route1 = makeRoute({
      distanceMeters: 30_000,
      durationSeconds: 1_500,
      routeToken: 'with-tolls',
    });
    const route2 = makeRoute({
      distanceMeters: 32_000,
      durationSeconds: 1_700,
      routeToken: 'no-tolls',
    });
    setup.routesService.seed([route1]);

    const { result } = renderHook(() => useRouteSelectViewModel(), {
      wrapper: withTestContainer(setup),
    });
    act(() => {
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => {
      expect(result.current.routes[0]?.routeToken).toBe('with-tolls');
    });

    // Re-seed before flipping avoidTolls — `seed()` is one-shot.
    setup.routesService.seed([route2]);
    act(() => {
      result.current.setAvoidTolls(true);
    });
    act(() => {
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => {
      expect(result.current.routes[0]?.routeToken).toBe('no-tolls');
    });
  });

  it('surfaces NotFound as a friendly error', async () => {
    const setup = await setupSeededState();
    setup.routesService.seedError(
      new NotFoundError({
        code: 'no_route',
        message: 'no drivable route',
        resource: 'route',
      }),
    );

    const { result } = renderHook(() => useRouteSelectViewModel(), {
      wrapper: withTestContainer(setup),
    });
    act(() => {
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error).toContain("couldn't find");
  });

  it('surfaces NetworkError as a friendly error', async () => {
    const setup = await setupSeededState();
    setup.routesService.seedError(
      new NetworkError({ code: 'http_500', message: 'fetch fail' }),
    );

    const { result } = renderHook(() => useRouteSelectViewModel(), {
      wrapper: withTestContainer(setup),
    });
    act(() => {
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error).toContain('Network');
  });

  it('canConfirm requires pickup, dropoff, a route, and a ride-service', async () => {
    const setup = await setupSeededState();
    const route = makeRoute({ distanceMeters: 10_000, durationSeconds: 900 });
    setup.routesService.seed([route]);

    const { result } = renderHook(() => useRouteSelectViewModel(), {
      wrapper: withTestContainer(setup),
    });
    act(() => {
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    expect(result.current.canConfirm).toBe(false);
    act(() => {
      result.current.selectRideService(ECONOMY_ID);
    });
    expect(result.current.canConfirm).toBe(true);
  });

  // Phase 10 turn 7 — scheduled-pickup state and the tagged
  // confirm() return shape.
  it('scheduledPickupAt starts null; setScheduledPickupAt(Date) updates the formatter', async () => {
    const setup = await setupSeededState();
    const { result } = renderHook(() => useRouteSelectViewModel(), {
      wrapper: withTestContainer(setup),
    });
    expect(result.current.scheduledPickupAt).toBeNull();
    expect(result.current.formattedSchedulePickupAt).toBeNull();

    const future = new Date(Date.now() + 60 * 60_000);
    act(() => {
      result.current.setScheduledPickupAt(future);
    });
    expect(result.current.scheduledPickupAt).toEqual(future);
    expect(result.current.formattedSchedulePickupAt).not.toBeNull();
  });

  it('setScheduledPickupAt(null) clears the schedule', async () => {
    const setup = await setupSeededState();
    const { result } = renderHook(() => useRouteSelectViewModel(), {
      wrapper: withTestContainer(setup),
    });
    const future = new Date(Date.now() + 60 * 60_000);
    act(() => {
      result.current.setScheduledPickupAt(future);
    });
    expect(result.current.scheduledPickupAt).toEqual(future);

    act(() => {
      result.current.setScheduledPickupAt(null);
    });
    expect(result.current.scheduledPickupAt).toBeNull();
    expect(result.current.formattedSchedulePickupAt).toBeNull();
  });

  // Phase 10 turn 10 — confirm() hard-blocks when the rider has no default
  // payment method. Without this gate the trip persists with
  // `passenger.defaultPaymentMethod: null` and the server-side
  // `processPaymentForTrip` rejects the fare/tip charge with an opaque
  // `cf_*_internal` NetworkError the rider can't act on.
  it('confirm() blocks when the rider has no default payment method', async () => {
    const setup = await setupSeededState();
    const authRepo = new InMemoryAuthRepository();
    const usersRepo = new InMemoryUserRepository();
    const ridesRepo = new InMemoryRideRepository();
    await seedRider({
      authRepo,
      usersRepo,
      defaultPaymentMethodId: null,
    });
    const route = makeRoute({ distanceMeters: 10_000, durationSeconds: 900 });
    setup.routesService.seed([route]);

    const { result } = renderHook(() => useRouteSelectViewModel(), {
      wrapper: withTestContainer({
        ...setup,
        authRepo,
        usersRepo,
        ridesRepo,
      }),
    });
    act(() => {
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    act(() => {
      result.current.selectRideService(ECONOMY_ID);
    });
    expect(result.current.canConfirm).toBe(true);

    let outcome: unknown = 'unset';
    await act(async () => {
      outcome = await result.current.confirm();
    });

    expect(outcome).toBeNull();
    expect(result.current.submitError).toMatch(/payment method/i);
    // No ride should have been persisted — the gate is the only thing
    // that prevented the create call.
    expect(ridesRepo.spies.create).toBe(0);
  });

  it('confirm() proceeds when the rider has a default payment method', async () => {
    const setup = await setupSeededState();
    const authRepo = new InMemoryAuthRepository();
    const usersRepo = new InMemoryUserRepository();
    const ridesRepo = new InMemoryRideRepository();
    await seedRider({
      authRepo,
      usersRepo,
      defaultPaymentMethodId: unwrap(PaymentMethodId.create('pm_RiderPM01')),
    });
    const route = makeRoute({ distanceMeters: 10_000, durationSeconds: 900 });
    setup.routesService.seed([route]);

    const { result } = renderHook(() => useRouteSelectViewModel(), {
      wrapper: withTestContainer({
        ...setup,
        authRepo,
        usersRepo,
        ridesRepo,
      }),
    });
    act(() => {
      jest.advanceTimersByTime(400);
    });
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    act(() => {
      result.current.selectRideService(ECONOMY_ID);
    });

    let outcome: unknown = 'unset';
    await act(async () => {
      outcome = await result.current.confirm();
    });

    expect(result.current.submitError).toBeNull();
    expect(outcome).not.toBeNull();
    expect(ridesRepo.spies.create).toBe(1);
  });
});

function makeSetupWithoutEndpoints(): {
  serviceAreasRepo: InMemoryServiceAreaRepository;
  routesService: FakeRoutesService;
} {
  // Trip-draft store is intentionally empty here.
  const area = unwrap(
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
  const serviceAreasRepo = new InMemoryServiceAreaRepository();
  serviceAreasRepo.reset({ areas: [area], services: {} });
  const routesService = new FakeRoutesService();
  return { serviceAreasRepo, routesService };
}
