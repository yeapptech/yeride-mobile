import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { UserId } from '@domain/entities/UserId';
import {
  makeAwaitingRide,
  makeRideAt,
  unwrap,
} from '@presentation/components/trip/__tests__/_rideFixture';
import { InMemoryRideRepository, TestContainerProvider } from '@shared/testing';

import {
  useActivityViewModel,
  type ActivityNavigator,
} from '../useActivityViewModel';

const PASSENGER_ID = unwrap(UserId.create('aaaaaaaaaaaaaaaaaaaaaaaaaaaa'));

function wrapperWithRides(ridesRepo: InMemoryRideRepository) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TestContainerProvider rides={ridesRepo}>
        {children}
      </TestContainerProvider>
    );
  };
}

function makeNavigator(): ActivityNavigator & {
  monitorCalls: string[];
  detailCalls: string[];
} {
  const monitorCalls: string[] = [];
  const detailCalls: string[] = [];
  return {
    navigateToMonitor: (rideId: string) => {
      monitorCalls.push(rideId);
    },
    navigateToDetail: (rideId: string) => {
      detailCalls.push(rideId);
    },
    monitorCalls,
    detailCalls,
  };
}

describe('useActivityViewModel', () => {
  it('starts in loading then transitions to empty when there are no rides', async () => {
    const rides = new InMemoryRideRepository();
    const nav = makeNavigator();
    const { result } = renderHook(
      () =>
        useActivityViewModel({
          passengerId: PASSENGER_ID,
          navigator: nav,
        }),
      { wrapper: wrapperWithRides(rides) },
    );
    expect(result.current.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.status).toBe('empty');
    });
    expect(result.current.rides).toEqual([]);
  });

  it('renders ride rows newest-first', async () => {
    const rides = new InMemoryRideRepository();
    rides.seed(
      makeAwaitingRide({
        id: 'rideOld123456789012abc',
        passengerId: String(PASSENGER_ID),
        createdAt: new Date('2026-04-01T00:00:00Z'),
      }),
    );
    rides.seed(
      makeAwaitingRide({
        id: 'rideNew123456789012abc',
        passengerId: String(PASSENGER_ID),
        createdAt: new Date('2026-05-01T00:00:00Z'),
      }),
    );

    const nav = makeNavigator();
    const { result } = renderHook(
      () =>
        useActivityViewModel({
          passengerId: PASSENGER_ID,
          navigator: nav,
        }),
      { wrapper: wrapperWithRides(rides) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.rides.map((r) => String(r.id))).toEqual([
      'rideNew123456789012abc',
      'rideOld123456789012abc',
    ]);
    expect(result.current.canLoadMore).toBe(false);
  });

  it('routes terminal-status rides to TripDetail and active rides to RideMonitor', async () => {
    const rides = new InMemoryRideRepository();
    const completed = makeRideAt('completed', 'rideCompl123456789ab');
    const cancelled = makeRideAt('cancelled', 'rideCancl123456789ab');
    const awaiting = makeAwaitingRide({
      id: 'rideAwait123456789abc',
      passengerId: String(PASSENGER_ID),
    });
    rides.seed(completed);
    rides.seed(cancelled);
    rides.seed(awaiting);

    const nav = makeNavigator();
    const { result } = renderHook(
      () =>
        useActivityViewModel({
          passengerId: PASSENGER_ID,
          navigator: nav,
        }),
      { wrapper: wrapperWithRides(rides) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    act(() => {
      result.current.onSelectRide(completed);
    });
    act(() => {
      result.current.onSelectRide(cancelled);
    });
    act(() => {
      result.current.onSelectRide(awaiting);
    });

    expect(nav.detailCalls).toEqual([
      'rideCompl123456789ab',
      'rideCancl123456789ab',
    ]);
    expect(nav.monitorCalls).toEqual(['rideAwait123456789abc']);
  });

  it('exposes canLoadMore when the first page filled the limit', async () => {
    const rides = new InMemoryRideRepository();
    // Seed 11 rides so the first page-of-10 surfaces a cursor.
    for (let i = 0; i < 11; i++) {
      rides.seed(
        makeAwaitingRide({
          id: `ride${String(i).padStart(2, '0')}xxxxx12345abc`,
          passengerId: String(PASSENGER_ID),
          createdAt: new Date(2026, 0, 1, 0, 0, i),
        }),
      );
    }

    const nav = makeNavigator();
    const { result } = renderHook(
      () =>
        useActivityViewModel({
          passengerId: PASSENGER_ID,
          navigator: nav,
        }),
      { wrapper: wrapperWithRides(rides) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.rides.length).toBe(10);
    expect(result.current.canLoadMore).toBe(true);

    await act(async () => {
      result.current.onLoadMore();
      // Wait for the second page to land.
      await waitFor(() => {
        expect(result.current.rides.length).toBe(11);
      });
    });
    expect(result.current.canLoadMore).toBe(false);
  });

  it('returns empty + no error when passengerId is null', async () => {
    const nav = makeNavigator();
    const { result } = renderHook(
      () =>
        useActivityViewModel({
          passengerId: null,
          navigator: nav,
        }),
      {
        wrapper: ({ children }) => (
          <TestContainerProvider>{children}</TestContainerProvider>
        ),
      },
    );
    // With passengerId === null the query is disabled; status starts at
    // empty (no rides) and never enters loading.
    await waitFor(() => {
      expect(result.current.status).toBe('empty');
    });
    expect(result.current.rides).toEqual([]);
  });
});
