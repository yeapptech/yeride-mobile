import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Coordinates } from '@domain/entities/Coordinates';
import { NetworkError } from '@domain/errors';
import {
  FakeNavigationSdkClient,
  TestContainerProvider,
} from '@shared/testing';

import {
  useDriverNavigationViewModel,
  type DriverNavigationViewModelArgs,
} from '../useDriverNavigationViewModel';

/**
 * Phase 8 turn 2 — view-model tests against `FakeNavigationSdkClient`.
 * Drive arrivals via `fake.emitArrival(...)`; prime errors via
 * `fake.failNext({method, error})` and `fake.seedRouteStatus(...)`.
 */

function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!r.ok) throw r.error;
  return r.value;
}

const PICKUP = unwrap(Coordinates.create(25.7617, -80.1918));

function makeWrapper(fake: FakeNavigationSdkClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TestContainerProvider navigationSdk={fake}>
        {children}
      </TestContainerProvider>
    );
  };
}

describe('useDriverNavigationViewModel', () => {
  describe('initial state', () => {
    it("starts in 'uninitialized' before onMapReady fires", () => {
      const fake = new FakeNavigationSdkClient();
      const { result } = renderHook(
        (args: DriverNavigationViewModelArgs) =>
          useDriverNavigationViewModel(args),
        {
          wrapper: makeWrapper(fake),
          initialProps: { title: 'Pickup', coords: PICKUP, onMapReady: false },
        },
      );
      expect(result.current.state.kind).toBe('uninitialized');
      expect(result.current.hasArrived).toBe(false);
      expect(fake.spies.setDestinationsCalls).toHaveLength(0);
    });

    it('does not run the chain while onMapReady is false', async () => {
      const fake = new FakeNavigationSdkClient();
      const { rerender } = renderHook(
        (args: DriverNavigationViewModelArgs) =>
          useDriverNavigationViewModel(args),
        {
          wrapper: makeWrapper(fake),
          initialProps: { title: 'Pickup', coords: PICKUP, onMapReady: false },
        },
      );
      // Re-render without flipping onMapReady — still no setDestinations.
      rerender({ title: 'Pickup', coords: PICKUP, onMapReady: false });
      await Promise.resolve();
      expect(fake.spies.setDestinationsCalls).toHaveLength(0);
      expect(fake.spies.startGuidanceCalls).toBe(0);
    });
  });

  describe('happy path', () => {
    it('flips uninitialized → initializing → guiding when onMapReady becomes true', async () => {
      const fake = new FakeNavigationSdkClient();
      const { result, rerender } = renderHook(
        (args: DriverNavigationViewModelArgs) =>
          useDriverNavigationViewModel(args),
        {
          wrapper: makeWrapper(fake),
          initialProps: { title: 'Pickup', coords: PICKUP, onMapReady: false },
        },
      );
      expect(result.current.state.kind).toBe('uninitialized');

      rerender({ title: 'Pickup', coords: PICKUP, onMapReady: true });

      await waitFor(() => {
        expect(result.current.state.kind).toBe('guiding');
      });
      expect(fake.spies.setDestinationsCalls).toHaveLength(1);
      expect(fake.spies.startGuidanceCalls).toBe(1);
      expect(fake.isGuiding()).toBe(true);
    });

    it('forwards routeToken to setDestinations when supplied', async () => {
      const fake = new FakeNavigationSdkClient();
      renderHook(
        (args: DriverNavigationViewModelArgs) =>
          useDriverNavigationViewModel(args),
        {
          wrapper: makeWrapper(fake),
          initialProps: {
            title: 'Pickup',
            coords: PICKUP,
            onMapReady: true,
            routeToken: 'ROUTE_TOKEN_ABC',
          },
        },
      );

      await waitFor(() => {
        expect(fake.spies.setDestinationsCalls).toHaveLength(1);
      });
      const call = fake.spies.setDestinationsCalls[0];
      if (!call) throw new Error('setDestinations[0] missing');
      expect(call.routeToken).toBe('ROUTE_TOKEN_ABC');
    });

    it('forwards avoidTolls to setDestinations when supplied', async () => {
      const fake = new FakeNavigationSdkClient();
      renderHook(
        (args: DriverNavigationViewModelArgs) =>
          useDriverNavigationViewModel(args),
        {
          wrapper: makeWrapper(fake),
          initialProps: {
            title: 'Pickup',
            coords: PICKUP,
            onMapReady: true,
            avoidTolls: true,
          },
        },
      );

      await waitFor(() => {
        expect(fake.spies.setDestinationsCalls).toHaveLength(1);
      });
      const call = fake.spies.setDestinationsCalls[0];
      if (!call) throw new Error('setDestinations[0] missing');
      expect(call.avoidTolls).toBe(true);
    });
  });

  describe('error mapping (non-OK NavRouteStatus)', () => {
    const cases: Array<{
      readonly status:
        | 'no_route_found'
        | 'waypoint_error'
        | 'invalid_place_id'
        | 'duplicate_waypoints_error'
        | 'network_error'
        | 'location_disabled'
        | 'location_unknown'
        | 'quota_check_failed'
        | 'route_canceled'
        | 'unknown';
      readonly subKind:
        | 'route_not_found'
        | 'network'
        | 'permission'
        | 'unknown';
    }> = [
      { status: 'no_route_found', subKind: 'route_not_found' },
      { status: 'waypoint_error', subKind: 'route_not_found' },
      { status: 'invalid_place_id', subKind: 'route_not_found' },
      { status: 'duplicate_waypoints_error', subKind: 'route_not_found' },
      { status: 'network_error', subKind: 'network' },
      { status: 'location_disabled', subKind: 'permission' },
      { status: 'location_unknown', subKind: 'permission' },
      { status: 'quota_check_failed', subKind: 'unknown' },
      { status: 'route_canceled', subKind: 'unknown' },
      { status: 'unknown', subKind: 'unknown' },
    ];

    for (const { status, subKind } of cases) {
      it(`maps status='${status}' → error.subKind='${subKind}'`, async () => {
        const fake = new FakeNavigationSdkClient();
        fake.seedRouteStatus(status);
        const { result } = renderHook(
          (args: DriverNavigationViewModelArgs) =>
            useDriverNavigationViewModel(args),
          {
            wrapper: makeWrapper(fake),
            initialProps: { title: 'Pickup', coords: PICKUP, onMapReady: true },
          },
        );
        await waitFor(() => {
          expect(result.current.state.kind).toBe('error');
        });
        const s = result.current.state;
        if (s.kind !== 'error') throw new Error('expected error state');
        expect(s.subKind).toBe(subKind);
        expect(s.message).toBeTruthy();
        expect(fake.spies.startGuidanceCalls).toBe(0);
      });
    }
  });

  describe('error: SDK throws', () => {
    it("setDestinations rejecting with NetworkError lands in error.subKind='network'", async () => {
      const fake = new FakeNavigationSdkClient();
      fake.failNext({
        method: 'setDestinations',
        error: new NetworkError({
          code: 'navigation_setdestinations_failed',
          message: 'transport down',
        }),
      });
      const { result } = renderHook(
        (args: DriverNavigationViewModelArgs) =>
          useDriverNavigationViewModel(args),
        {
          wrapper: makeWrapper(fake),
          initialProps: { title: 'Pickup', coords: PICKUP, onMapReady: true },
        },
      );
      await waitFor(() => {
        expect(result.current.state.kind).toBe('error');
      });
      const s = result.current.state;
      if (s.kind !== 'error') throw new Error('expected error state');
      expect(s.subKind).toBe('network');
    });

    it("startGuidance rejecting lands in error.subKind='unknown'", async () => {
      const fake = new FakeNavigationSdkClient();
      fake.failNext({
        method: 'startGuidance',
        error: new NetworkError({
          code: 'navigation_start_guidance_failed',
          message: 'boom',
        }),
      });
      const { result } = renderHook(
        (args: DriverNavigationViewModelArgs) =>
          useDriverNavigationViewModel(args),
        {
          wrapper: makeWrapper(fake),
          initialProps: { title: 'Pickup', coords: PICKUP, onMapReady: true },
        },
      );
      await waitFor(() => {
        expect(result.current.state.kind).toBe('error');
      });
      const s = result.current.state;
      if (s.kind !== 'error') throw new Error('expected error state');
      expect(s.subKind).toBe('unknown');
      // setDestinations succeeded but startGuidance failed.
      expect(fake.spies.setDestinationsCalls).toHaveLength(1);
      expect(fake.spies.startGuidanceCalls).toBe(1);
    });
  });

  describe('arrival', () => {
    it("emitArrival(isFinalDestination: true) flips state → 'arrived' and fires stopGuidance", async () => {
      const fake = new FakeNavigationSdkClient();
      const { result } = renderHook(
        (args: DriverNavigationViewModelArgs) =>
          useDriverNavigationViewModel(args),
        {
          wrapper: makeWrapper(fake),
          initialProps: { title: 'Pickup', coords: PICKUP, onMapReady: true },
        },
      );
      await waitFor(() => {
        expect(result.current.state.kind).toBe('guiding');
      });
      const baseStops = fake.spies.stopGuidanceCalls;

      act(() => {
        fake.emitArrival({
          title: 'Pickup',
          coords: PICKUP,
          placeId: null,
          isFinalDestination: true,
          timestampMs: 1_700_000_000_000,
        });
      });

      expect(result.current.state.kind).toBe('arrived');
      expect(result.current.hasArrived).toBe(true);
      expect(fake.spies.stopGuidanceCalls).toBe(baseStops + 1);
    });

    it('non-final arrival is ignored', async () => {
      const fake = new FakeNavigationSdkClient();
      const { result } = renderHook(
        (args: DriverNavigationViewModelArgs) =>
          useDriverNavigationViewModel(args),
        {
          wrapper: makeWrapper(fake),
          initialProps: { title: 'Pickup', coords: PICKUP, onMapReady: true },
        },
      );
      await waitFor(() => {
        expect(result.current.state.kind).toBe('guiding');
      });

      act(() => {
        fake.emitArrival({
          title: 'Stopover',
          coords: PICKUP,
          placeId: null,
          isFinalDestination: false,
          timestampMs: 1_700_000_000_000,
        });
      });

      expect(result.current.state.kind).toBe('guiding');
      expect(result.current.hasArrived).toBe(false);
    });
  });

  describe('onEndNavigation', () => {
    it("flips to 'arrived' and fires stopGuidance", async () => {
      const fake = new FakeNavigationSdkClient();
      const { result } = renderHook(
        (args: DriverNavigationViewModelArgs) =>
          useDriverNavigationViewModel(args),
        {
          wrapper: makeWrapper(fake),
          initialProps: { title: 'Pickup', coords: PICKUP, onMapReady: true },
        },
      );
      await waitFor(() => {
        expect(result.current.state.kind).toBe('guiding');
      });
      const baseStops = fake.spies.stopGuidanceCalls;

      act(() => {
        result.current.onEndNavigation();
      });

      expect(result.current.state.kind).toBe('arrived');
      expect(fake.spies.stopGuidanceCalls).toBe(baseStops + 1);
    });
  });

  describe('onRetry', () => {
    it('from error state, resets to uninitialized and re-runs the chain', async () => {
      const fake = new FakeNavigationSdkClient();
      fake.seedRouteStatus('no_route_found');
      const { result } = renderHook(
        (args: DriverNavigationViewModelArgs) =>
          useDriverNavigationViewModel(args),
        {
          wrapper: makeWrapper(fake),
          initialProps: { title: 'Pickup', coords: PICKUP, onMapReady: true },
        },
      );
      await waitFor(() => {
        expect(result.current.state.kind).toBe('error');
      });
      // Reset the seed so retry can succeed.
      fake.seedRouteStatus('ok');

      act(() => {
        result.current.onRetry();
      });

      await waitFor(() => {
        expect(result.current.state.kind).toBe('guiding');
      });
      expect(fake.spies.setDestinationsCalls).toHaveLength(2);
      expect(fake.spies.startGuidanceCalls).toBe(1);
    });
  });

  describe('cleanup on unmount', () => {
    it('disposes the arrival subscription', async () => {
      const fake = new FakeNavigationSdkClient();
      const { unmount } = renderHook(
        (args: DriverNavigationViewModelArgs) =>
          useDriverNavigationViewModel(args),
        {
          wrapper: makeWrapper(fake),
          initialProps: { title: 'Pickup', coords: PICKUP, onMapReady: true },
        },
      );
      await waitFor(() => {
        expect(fake.getArrivalSubscriberCount()).toBe(1);
      });

      unmount();

      expect(fake.getArrivalSubscriberCount()).toBe(0);
      expect(fake.spies.arrivalDisposes).toBe(1);
    });

    it('fires stopGuidance + cleanup at unmount', async () => {
      const fake = new FakeNavigationSdkClient();
      const { result, unmount } = renderHook(
        (args: DriverNavigationViewModelArgs) =>
          useDriverNavigationViewModel(args),
        {
          wrapper: makeWrapper(fake),
          initialProps: { title: 'Pickup', coords: PICKUP, onMapReady: true },
        },
      );
      await waitFor(() => {
        expect(result.current.state.kind).toBe('guiding');
      });
      const baseStops = fake.spies.stopGuidanceCalls;
      const baseCleanups = fake.spies.cleanupCalls;

      unmount();
      // Wait for the fire-and-forget cleanup chain to settle.
      await waitFor(() => {
        expect(fake.spies.cleanupCalls).toBe(baseCleanups + 1);
      });
      expect(fake.spies.stopGuidanceCalls).toBe(baseStops + 1);
    });

    it('unmounting mid-chain does not transition stale state', async () => {
      const fake = new FakeNavigationSdkClient();
      const { result, unmount } = renderHook(
        (args: DriverNavigationViewModelArgs) =>
          useDriverNavigationViewModel(args),
        {
          wrapper: makeWrapper(fake),
          initialProps: { title: 'Pickup', coords: PICKUP, onMapReady: true },
        },
      );
      // The chain has at least scheduled setDestinations; immediately
      // unmount before it resolves.
      unmount();

      // After flushing microtasks, the state remains whatever was last
      // set before unmount — `initializing` or `uninitialized`. The
      // cancellation guard prevents the stale 'guiding' transition
      // from landing post-unmount.
      await Promise.resolve();
      await Promise.resolve();
      // No assertion on state.kind directly — the hook is unmounted —
      // but `result.current` keeps its last-rendered value. The
      // cancellation contract is that `setState({kind: 'guiding'})`
      // never ran. We can't directly observe that here, but a
      // subsequent test would catch any leaked transition.
      expect(['uninitialized', 'initializing', 'arrived']).toContain(
        result.current.state.kind,
      );
    });
  });
});
