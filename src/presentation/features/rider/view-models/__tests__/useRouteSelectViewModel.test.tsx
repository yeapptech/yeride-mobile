import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Coordinates } from '@domain/entities/Coordinates';
import { Endpoint } from '@domain/entities/Endpoint';
import { Money } from '@domain/entities/Money';
import { RideService } from '@domain/entities/RideService';
import { RideServiceId } from '@domain/entities/RideServiceId';
import { Route } from '@domain/entities/Route';
import { ServiceArea } from '@domain/entities/ServiceArea';
import { ServiceAreaId } from '@domain/entities/ServiceAreaId';
import { NetworkError, NotFoundError } from '@domain/errors';
import { useServiceAreaStore } from '@presentation/stores/useServiceAreaStore';
import { useTripDraftStore } from '@presentation/stores/useTripDraftStore';
import {
  FakeRoutesService,
  InMemoryServiceAreaRepository,
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
}) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider
      serviceAreas={opts.serviceAreasRepo}
      routes={opts.routesService}
    >
      {children}
    </TestContainerProvider>
  );
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
