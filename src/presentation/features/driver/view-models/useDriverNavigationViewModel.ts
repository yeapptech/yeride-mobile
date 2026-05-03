import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  NavArrivalEvent,
  NavigationSdkClient,
  NavRouteStatus,
  NavSetDestinationsArgs,
  NavWaypoint,
} from '@data/services/NavigationSdkClient';
import type { Coordinates } from '@domain/entities/Coordinates';
import { useNavigationSdk } from '@presentation/di';
import { LOG } from '@shared/logger';
import type { FakeNavigationSdkClient } from '@shared/testing';

const logger = LOG.extend('DriverNavigationVM');

/**
 * Phase 8 turn 2 — view-model for `DriverNavigationScreen`. Drives the
 * setDestinations → startGuidance chain after the SDK's
 * `<NavigationView/>` reports `onMapReady`, surfaces a tagged-union
 * state machine to the screen, and auto-flips the screen into a
 * `goBack()` via `hasArrived` on final-destination arrival.
 *
 * Pre-mount invariant: DriverMonitor's `onLaunchNavigation` already
 * ran the `init()` (+ terms dialog if first launch) chain BEFORE
 * navigating here (legacy-faithful pattern; sidesteps the
 * `getCurrentActivity()` null quirk inside `<NavigationView/>` on
 * Android). The VM therefore does NOT call `init()` itself.
 *
 * State machine:
 *
 *   uninitialized  → waiting for the screen to flip `onMapReady` true.
 *                    Initial state on every mount and after `onRetry`.
 *   initializing   → setDestinations() / startGuidance() in flight.
 *                    Either resolves into `guiding` or `error`.
 *   guiding        → turn-by-turn live. The arrival subscription is
 *                    armed; `onEndNavigation` is callable.
 *   arrived        → final-destination arrival fired OR onEndNavigation
 *                    tapped. Terminal in this VM; the screen reads
 *                    `hasArrived` and calls `navigation.goBack()`.
 *   error          → setDestinations / startGuidance failed. Carries a
 *                    sub-kind discriminator for distinct UX copy
 *                    + a user-facing message. `onRetry` resets to
 *                    `uninitialized` (which retriggers the chain
 *                    against the still-true `onMapReady`).
 *
 * Effect topology:
 *
 *   1. Arrival subscription (mount-once): subscribe to
 *      `navigationSdk.subscribeToArrival(...)`. Synchronous unsubscribe
 *      on unmount. Non-final arrivals are ignored (multi-stop trips
 *      out of scope). Final arrivals flip state to `arrived` AND fire
 *      a fire-and-forget `stopGuidance()`.
 *
 *   2. Run-chain effect (keyed on state.kind + onMapReady): when
 *      state is `uninitialized` AND `onMapReady === true`, sequence
 *      setDestinations → startGuidance and transition into `guiding`
 *      or `error`. Cancellation guarded by a local `cancelled` flag
 *      so a quick unmount mid-chain doesn't transition stale state.
 *
 *   3. Cleanup-on-unmount: synchronous fire-and-forget chain.
 *      `stopGuidance()` first (best effort), then `cleanup()`.
 *      Both are tolerant of the no-controller path (the connector
 *      hook clears the controller AFTER this VM's cleanup runs at
 *      DriverMonitor's unmount; if the SDK session was already torn
 *      down by an earlier `onEndNavigation`, both calls are no-ops).
 */

type NavSdk = NavigationSdkClient | FakeNavigationSdkClient;

export type DriverNavigationVMState =
  | { readonly kind: 'uninitialized' }
  | { readonly kind: 'initializing' }
  | { readonly kind: 'guiding' }
  | { readonly kind: 'arrived' }
  | {
      readonly kind: 'error';
      readonly subKind: DriverNavigationErrorKind;
      readonly message: string;
    };

export type DriverNavigationErrorKind =
  | 'route_not_found'
  | 'network'
  | 'permission'
  | 'location_unknown'
  | 'api_not_authorized'
  | 'unknown';

/**
 * Public args. Primitives only — the screen consumes these as plain
 * values (title + coordinates) and the VM constructs the data-layer
 * `NavWaypoint` internally so the boundaries rule stays satisfied at
 * the screen boundary.
 */
export interface DriverNavigationViewModelArgs {
  /** Human-readable destination label shown in the SDK UI. */
  readonly title: string;
  /** Destination coordinates for this leg. */
  readonly coords: Coordinates;
  /**
   * Rider-selected route token from the Routes API, when present. Set
   * for the dropoff leg if `ride.dropoff.directions.routeToken` was
   * available; falls through to `routingOptions` on the pickup leg.
   */
  readonly routeToken?: string;
  readonly avoidTolls?: boolean;
  /**
   * Flipped `true` by the screen when `<NavigationView onMapReady/>`
   * fires. The chain is gated on this so we don't try to set
   * destinations before the native view is alive.
   */
  readonly onMapReady: boolean;
}

export interface UseDriverNavigationViewModel {
  readonly state: DriverNavigationVMState;
  /** Mirror of `state.kind === 'arrived'`. Screen useEffect-keys on it to call `navigation.goBack()`. */
  readonly hasArrived: boolean;
  /** Manual end of navigation. Stops guidance, flips state to `arrived`. */
  onEndNavigation: () => void;
  /** Re-runs setDestinations + startGuidance from an `error` state. */
  onRetry: () => void;
}

export function useDriverNavigationViewModel(
  args: DriverNavigationViewModelArgs,
): UseDriverNavigationViewModel {
  const { title, coords, routeToken, avoidTolls, onMapReady } = args;
  const navigationSdk: NavSdk = useNavigationSdk();

  const [state, setState] = useState<DriverNavigationVMState>({
    kind: 'uninitialized',
  });

  /**
   * Bumped by `onRetry` to re-trigger the run-chain effect after an
   * `error` state has already consumed the initial `onMapReady`
   * transition. Excluded from the chain effect's gate via the
   * stateRef — we use `retryNonce` purely as a dependency tick.
   */
  const [retryNonce, setRetryNonce] = useState(0);

  // Carry the latest SDK adapter in a ref so the unmount-cleanup
  // effect (which runs once on unmount with empty deps) reads the
  // current adapter instance. Same trick `useGpsLifecycle` uses to
  // avoid a re-subscribe on every mutation-identity churn.
  const navigationSdkRef = useRef<NavSdk>(navigationSdk);
  navigationSdkRef.current = navigationSdk;

  /* ── Arrival subscription (mount-once) ──────────────────────────── */

  useEffect(() => {
    const unsubscribe = navigationSdk.subscribeToArrival(
      (event: NavArrivalEvent) => {
        if (!event.isFinalDestination) {
          // Multi-stop trips are out of Phase 8 scope — ignore non-
          // final arrivals defensively.
          logger.debug('non-final arrival ignored', { title: event.title });
          return;
        }
        logger.info('arrived at final destination', { title: event.title });
        // Fire-and-forget stopGuidance — the screen-level cleanup
        // will fire `cleanup()` on unmount anyway, but stopping
        // guidance immediately keeps voice prompts from continuing
        // through the auto-pop animation.
        void navigationSdk.stopGuidance();
        setState({ kind: 'arrived' });
      },
    );
    return unsubscribe;
  }, [navigationSdk]);

  /* ── Run-chain (setDestinations + startGuidance) ────────────────── */

  // Latest state in a ref so the chain effect can gate on
  // `state.kind === 'uninitialized'` without listing `state.kind` as
  // a dep — including it in the dep list creates a self-cancelling
  // race where the synchronous `setState({kind: 'initializing'})`
  // immediately re-fires the effect, which sets `cancelled = true`
  // on the in-flight chain via the previous effect's cleanup.
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!onMapReady) return;
    if (stateRef.current.kind !== 'uninitialized') return;

    let cancelled = false;
    setState({ kind: 'initializing' });

    void (async () => {
      const waypoint: NavWaypoint = { title, coords };
      const setArgs: NavSetDestinationsArgs = {
        waypoints: [waypoint],
        ...(routeToken !== undefined ? { routeToken } : {}),
        ...(avoidTolls !== undefined ? { avoidTolls } : {}),
      };
      const setR = await navigationSdk.setDestinations(setArgs);
      if (cancelled) return;
      if (!setR.ok) {
        logger.warn('setDestinations failed', setR.error);
        setState({
          kind: 'error',
          subKind: 'network',
          message: defaultMessageFor('network'),
        });
        return;
      }
      const status: NavRouteStatus = setR.value;
      if (status !== 'ok') {
        const subKind = mapRouteStatusToErrorKind(status);
        logger.warn('non-OK route status', { status, subKind });
        setState({
          kind: 'error',
          subKind,
          message: defaultMessageFor(subKind),
        });
        return;
      }

      const startR = await navigationSdk.startGuidance();
      if (cancelled) return;
      if (!startR.ok) {
        logger.warn('startGuidance failed', startR.error);
        setState({
          kind: 'error',
          subKind: 'unknown',
          message: defaultMessageFor('unknown'),
        });
        return;
      }
      logger.info('guidance started');
      setState({ kind: 'guiding' });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    onMapReady,
    retryNonce,
    title,
    coords,
    routeToken,
    avoidTolls,
    navigationSdk,
  ]);

  /* ── onEndNavigation / onRetry ──────────────────────────────────── */

  const onEndNavigation = useCallback(() => {
    // Fire-and-forget stopGuidance — the screen-level unmount cleanup
    // fires `cleanup()` afterwards.
    void navigationSdk.stopGuidance();
    setState({ kind: 'arrived' });
  }, [navigationSdk]);

  const onRetry = useCallback(() => {
    // Reset to uninitialized AND bump the retry tick — the chain
    // effect's gate (`stateRef.current.kind === 'uninitialized'`)
    // satisfies once the state flush lands, and the dep change on
    // `retryNonce` schedules a re-fire so the effect actually
    // re-runs (state.kind is intentionally not a dep, see comment
    // on the chain effect).
    setState({ kind: 'uninitialized' });
    setRetryNonce((n) => n + 1);
  }, []);

  /* ── Unmount cleanup (synchronous; fire-and-forget chain) ──────── */

  useEffect(() => {
    return () => {
      const sdk = navigationSdkRef.current;
      void (async () => {
        const stopR = await sdk.stopGuidance();
        if (!stopR.ok) {
          logger.warn('teardown stopGuidance error', stopR.error);
        }
        const cleanupR = await sdk.cleanup();
        if (!cleanupR.ok) {
          logger.warn('teardown cleanup error', cleanupR.error);
        }
      })();
    };
    // Deliberately empty: cleanup runs once at unmount. Other effects
    // handle prop-driven churn.
  }, []);

  return {
    state,
    hasArrived: state.kind === 'arrived',
    onEndNavigation,
    onRetry,
  };
}

/* ───── Helpers ───── */

/**
 * The Google Navigation SDK reports two distinct flavours of "no
 * location" via two separate `RouteStatus` values; we surface them as
 * distinct error sub-kinds so the UX copy can be actionable in each
 * case.
 *
 *   - `LOCATION_DISABLED` → `'permission'`. CoreLocation reports the
 *     app is not authorized OR Location Services is system-disabled.
 *     Recovery: user opens Settings → YeRide → Location → grant.
 *
 *   - `LOCATION_UNKNOWN`  → `'location_unknown'`. App IS authorized
 *     but no fix is currently available (cold-start GPS, indoor, weak
 *     signal, or — frequently in dev — iOS Simulator without a
 *     `Features → Location` selection). Recovery: wait, move outside,
 *     or set a simulator location.
 */
function mapRouteStatusToErrorKind(
  status: NavRouteStatus,
): DriverNavigationErrorKind {
  switch (status) {
    case 'no_route_found':
    case 'waypoint_error':
    case 'invalid_place_id':
    case 'duplicate_waypoints_error':
      return 'route_not_found';
    case 'network_error':
      return 'network';
    case 'location_disabled':
      return 'permission';
    case 'location_unknown':
      return 'location_unknown';
    case 'quota_check_failed':
    case 'route_canceled':
    case 'unknown':
      return 'unknown';
    case 'ok':
      // Type-system-only branch; 'ok' never reaches this mapper.
      return 'unknown';
    default:
      // Forward-compat: a future SDK enum value we haven't enumerated.
      return 'unknown';
  }
}

function defaultMessageFor(subKind: DriverNavigationErrorKind): string {
  switch (subKind) {
    case 'route_not_found':
      return 'Could not calculate a route. Try again or use another navigation app.';
    case 'network':
      return 'Navigation network error. Check your connection and try again.';
    case 'permission':
      return 'Location permission is off. Grant access in Settings → YeRide → Location to start navigation.';
    case 'location_unknown':
      return 'Waiting for a GPS fix. Move outdoors or check your signal, then tap Try again.';
    case 'api_not_authorized':
      return 'Navigation is not authorized for this app. Please contact support.';
    case 'unknown':
      return 'Something went wrong starting navigation. Please try again.';
  }
}
