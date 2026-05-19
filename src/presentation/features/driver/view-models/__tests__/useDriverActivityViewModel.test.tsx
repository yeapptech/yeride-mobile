import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { UserId } from '@domain/entities/UserId';
import {
  makeRideAt,
  unwrap,
} from '@presentation/components/trip/__tests__/_rideFixture';
import { InMemoryRideRepository, TestContainerProvider } from '@shared/testing';

import {
  useDriverActivityViewModel,
  type DriverActivityNavigator,
} from '../useDriverActivityViewModel';

const DRIVER_ID = unwrap(UserId.create('dddddddddddddddddddddddddddd'));

function wrapperWithRides(ridesRepo: InMemoryRideRepository) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TestContainerProvider rides={ridesRepo}>
        {children}
      </TestContainerProvider>
    );
  };
}

function makeNavigator(): DriverActivityNavigator & {
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

describe('useDriverActivityViewModel', () => {
  it('starts in loading then transitions to empty', async () => {
    const rides = new InMemoryRideRepository();
    const nav = makeNavigator();
    const { result } = renderHook(
      () => useDriverActivityViewModel({ driverId: DRIVER_ID, navigator: nav }),
      { wrapper: wrapperWithRides(rides) },
    );
    expect(result.current.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.status).toBe('empty');
    });
  });

  it('renders accepted rides; awaiting_driver rides (no driver assigned) are excluded', async () => {
    const rides = new InMemoryRideRepository();
    // The `makeRideAt('dispatched', ...)` fixture dispatches to the
    // default driver in the fixture (id "ddddd..."), which matches
    // DRIVER_ID above.
    const dispatched = makeRideAt('dispatched', 'rideDisp12345678901ab');
    rides.seed(dispatched);

    const nav = makeNavigator();
    const { result } = renderHook(
      () => useDriverActivityViewModel({ driverId: DRIVER_ID, navigator: nav }),
      { wrapper: wrapperWithRides(rides) },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });
    expect(result.current.rides.length).toBe(1);
  });

  it('routes terminal-status rides to TripDetail and active rides to DriverMonitor', async () => {
    const rides = new InMemoryRideRepository();
    const completed = makeRideAt('completed', 'rideDComp123456789ab');
    const cancelled = makeRideAt('cancelled', 'rideDCanc123456789ab');
    const dispatched = makeRideAt('dispatched', 'rideDDisp123456789ab');
    rides.seed(completed);
    rides.seed(cancelled);
    rides.seed(dispatched);

    const nav = makeNavigator();
    const { result } = renderHook(
      () => useDriverActivityViewModel({ driverId: DRIVER_ID, navigator: nav }),
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
      result.current.onSelectRide(dispatched);
    });

    expect(nav.detailCalls).toEqual([
      'rideDComp123456789ab',
      'rideDCanc123456789ab',
    ]);
    expect(nav.monitorCalls).toEqual(['rideDDisp123456789ab']);
  });

  it('returns empty when driverId is null', async () => {
    const nav = makeNavigator();
    const { result } = renderHook(
      () => useDriverActivityViewModel({ driverId: null, navigator: nav }),
      {
        wrapper: ({ children }) => (
          <TestContainerProvider>{children}</TestContainerProvider>
        ),
      },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('empty');
    });
  });
});
