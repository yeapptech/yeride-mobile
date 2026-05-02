import { renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { NotificationData, NotificationResponse } from '@domain/services';
import { navigationRef } from '@presentation/navigation/navigationRef';
import {
  FakePushNotificationService,
  TestContainerProvider,
} from '@shared/testing';

import { useNotificationResponseHandler } from '../useNotificationResponseHandler';

function makeResponse(data: NotificationData): NotificationResponse {
  return {
    title: null,
    body: null,
    data,
    receivedAt: new Date('2026-05-02T12:00:00Z'),
  };
}

function withTestContainer(pushService: FakePushNotificationService) {
  return ({ children }: { children: ReactNode }) => (
    <TestContainerProvider pushNotifications={pushService}>
      {children}
    </TestContainerProvider>
  );
}

// Force `navigationRef.isReady()` true so the dispatch path runs
// synchronously instead of waiting on the polling loop. Spy on
// `dispatch` to capture the CommonActions.navigate(...) payload —
// the hook uses `dispatch(CommonActions.navigate({name, params}))`
// rather than the tuple-form `navigate('Foo', {...})` to sidestep
// React Navigation's strict ParamList typing.
const isReadySpy = jest.spyOn(navigationRef, 'isReady');
const dispatchSpy = jest.spyOn(navigationRef, 'dispatch');

function lastNavigateAction(): { name: string; params?: unknown } | null {
  for (let i = dispatchSpy.mock.calls.length - 1; i >= 0; i -= 1) {
    const arg = dispatchSpy.mock.calls[i]?.[0] as
      | { type?: string; payload?: { name?: string; params?: unknown } }
      | undefined;
    if (arg && arg.type === 'NAVIGATE' && arg.payload) {
      const out: { name: string; params?: unknown } = {
        name: String(arg.payload.name),
      };
      if (arg.payload.params !== undefined) out.params = arg.payload.params;
      return out;
    }
  }
  return null;
}

beforeEach(() => {
  isReadySpy.mockReturnValue(true);
  dispatchSpy.mockImplementation(() => {});
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('useNotificationResponseHandler — warm-state subscription', () => {
  it('routes a driver_dispatched tap to RideMonitor', async () => {
    const pushService = new FakePushNotificationService();
    renderHook(() => useNotificationResponseHandler(), {
      wrapper: withTestContainer(pushService),
    });
    pushService.emitNotificationResponse(
      makeResponse({ type: 'driver_dispatched', tripId: 'rideABC123' }),
    );
    await waitFor(() => {
      expect(lastNavigateAction()).toEqual({
        name: 'RideMonitor',
        params: { rideId: 'rideABC123' },
      });
    });
  });

  it('routes a payment_succeeded tap to RideReceipt', async () => {
    const pushService = new FakePushNotificationService();
    renderHook(() => useNotificationResponseHandler(), {
      wrapper: withTestContainer(pushService),
    });
    pushService.emitNotificationResponse(
      makeResponse({ type: 'payment_succeeded', tripId: 'rideXYZ456' }),
    );
    await waitFor(() => {
      expect(lastNavigateAction()).toEqual({
        name: 'RideReceipt',
        params: { rideId: 'rideXYZ456' },
      });
    });
  });

  it('routes an awaiting_driver tap to DriverDispatch', async () => {
    const pushService = new FakePushNotificationService();
    renderHook(() => useNotificationResponseHandler(), {
      wrapper: withTestContainer(pushService),
    });
    pushService.emitNotificationResponse(
      makeResponse({ type: 'awaiting_driver', tripId: 'rideDriver789' }),
    );
    await waitFor(() => {
      expect(lastNavigateAction()).toEqual({
        name: 'DriverDispatch',
        params: { rideId: 'rideDriver789' },
      });
    });
  });

  it('routes a tip_succeeded tap to the DriverTabs Earnings tab', async () => {
    const pushService = new FakePushNotificationService();
    renderHook(() => useNotificationResponseHandler(), {
      wrapper: withTestContainer(pushService),
    });
    pushService.emitNotificationResponse(
      makeResponse({ type: 'tip_succeeded', tripId: 'rideTip001' }),
    );
    await waitFor(() => {
      expect(lastNavigateAction()).toEqual({
        name: 'DriverTabs',
        params: { screen: 'Earnings' },
      });
    });
  });

  it('skips navigation for an unknown payload type (forward-compat)', async () => {
    const pushService = new FakePushNotificationService();
    renderHook(() => useNotificationResponseHandler(), {
      wrapper: withTestContainer(pushService),
    });
    pushService.emitNotificationResponse(
      makeResponse({ type: 'some_future_type', tripId: 'rideABC123' }),
    );
    // Wait a beat to give the routing chain a chance to fire (it
    // shouldn't, but we want to assert the negative deterministically).
    await new Promise((r) => setTimeout(r, 50));
    expect(lastNavigateAction()).toBeNull();
  });

  it('skips navigation for a malformed payload (no type)', async () => {
    const pushService = new FakePushNotificationService();
    renderHook(() => useNotificationResponseHandler(), {
      wrapper: withTestContainer(pushService),
    });
    pushService.emitNotificationResponse(
      makeResponse({ tripId: 'rideABC123' }),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(lastNavigateAction()).toBeNull();
  });
});

describe('useNotificationResponseHandler — cold-start path', () => {
  it('consumes the SDK buffered response on first mount and routes', async () => {
    const pushService = new FakePushNotificationService();
    pushService.seedLastNotificationResponse(
      makeResponse({ type: 'driver_dispatched', tripId: 'coldRide001' }),
    );
    renderHook(() => useNotificationResponseHandler(), {
      wrapper: withTestContainer(pushService),
    });
    await waitFor(() => {
      expect(lastNavigateAction()).toEqual({
        name: 'RideMonitor',
        params: { rideId: 'coldRide001' },
      });
    });
    expect(pushService.spies.getLastNotificationResponseCalls).toBe(1);
  });

  it('does not call getLastNotificationResponse a second time on re-render', async () => {
    const pushService = new FakePushNotificationService();
    pushService.seedLastNotificationResponse(null);
    const { rerender } = renderHook(() => useNotificationResponseHandler(), {
      wrapper: withTestContainer(pushService),
    });
    rerender(undefined);
    rerender(undefined);
    await new Promise((r) => setTimeout(r, 30));
    expect(pushService.spies.getLastNotificationResponseCalls).toBe(1);
  });

  it('no-ops when the SDK has no buffered response (app opened normally)', async () => {
    const pushService = new FakePushNotificationService();
    pushService.seedLastNotificationResponse(null);
    renderHook(() => useNotificationResponseHandler(), {
      wrapper: withTestContainer(pushService),
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(lastNavigateAction()).toBeNull();
  });
});

describe('useNotificationResponseHandler — navigationRef cold-start race', () => {
  it('drops the tap after 3s if navigationRef never becomes ready', async () => {
    isReadySpy.mockReturnValue(false);
    const pushService = new FakePushNotificationService();
    renderHook(() => useNotificationResponseHandler(), {
      wrapper: withTestContainer(pushService),
    });
    pushService.emitNotificationResponse(
      makeResponse({ type: 'driver_dispatched', tripId: 'rideABC123' }),
    );
    // Without faking timers, wait the full 3.5s for the wait-for-ready
    // loop to time out. Worth it for one test — verifies the drop.
    await new Promise((r) => setTimeout(r, 3_300));
    expect(lastNavigateAction()).toBeNull();
  }, 6_000);
});
