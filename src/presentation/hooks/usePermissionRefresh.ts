import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import Toast from 'react-native-toast-message';

import type {
  BackgroundGeolocationService,
  BgPermissionStatus,
} from '@domain/services';
import { useBackgroundGeolocation } from '@presentation/di';
import { useGpsStore } from '@presentation/stores';
import { LOG } from '@shared/logger';

const logger = LOG.extend('PermissionRefresh');

/**
 * AppState-driven re-poll of the OS location-permission grant.
 *
 * The problem: `useGpsLifecycle` calls
 * `bgGeolocation.requestAuthorizationIfNeeded()` exactly once per
 * mount (a `useRef` guard makes the request idempotent). If the user
 * declines, `permissionStatus` lands at `'denied'` and the SDK never
 * starts. The user has no path to recover short of the legacy
 * "kill the app, change Settings, re-open" — even after they grant
 * permission via Settings and return to the app, the store still
 * reflects the stale `'denied'` AND the lifecycle hook's effect deps
 * (`[bgGeolocation, enabled, setPermissionStatus]`) don't include
 * `permissionStatus`, so the effect won't re-run to call `start()`.
 *
 * The fix: this hook listens on `AppState 'change'`. When the app
 * returns to foreground (`'active'`), it:
 *
 *   1. Re-polls `bgGeolocation.requestAuthorizationIfNeeded()`. Note:
 *      after the first prompt the OS dialog never re-appears; this
 *      call returns the cached granted level synchronously.
 *   2. Pushes the result into `useGpsStore.permissionStatus` so view-
 *      models / banners see it via the `useGpsPermissionStatus()`
 *      selector and re-render automatically.
 *   3. On a `'denied' | 'undetermined' → 'always' | 'when_in_use'`
 *      transition AND when `enabled === true` (signed-in + registration
 *      complete — same gate `useGpsLifecycle` uses), calls
 *      `bgGeolocation.start()` directly. This is necessary because
 *      adding `permissionStatus` to `useGpsLifecycle`'s effect deps
 *      would create a feedback loop: the effect itself sets
 *      `permissionStatus`, so listing it would cause infinite
 *      re-runs. Calling `start()` here is the cleanest decoupling.
 *   4. Fires a one-shot success Toast on the same edge so the user
 *      knows the recovery worked. Mirrors the
 *      `useStripeConnectOnboarding` `pending → enabled` toast pattern
 *      from Phase 6 turn 4.
 *
 * The previous status is tracked in a ref (not state) so the edge-
 * detection doesn't trigger re-renders. The ref is initialised to
 * `null` so the first poll doesn't fire the toast (a fresh launch
 * with a granted permission shouldn't toast).
 *
 * Mounting rule: AppContent-only (sibling to `useGpsLifecycle`).
 * Mounting from a screen would (a) re-bind the listener on every
 * navigation, leaking subscriptions, and (b) miss the case where the
 * user is on a non-mounting screen when they return from Settings.
 *
 * Caveats:
 *   - The SDK's `requestPermission()` returning the cached `'denied'`
 *     is the canonical "did the user grant via Settings?" probe — no
 *     OS API exists to query without potentially prompting. The cost
 *     is one tiny native bridge call per `'active'` transition.
 *   - The `enabled` gate prevents calling `start()` while signed-out
 *     or pre-registration-completion (matches the `useGpsLifecycle`
 *     contract). If the user grants while signed-out, the next
 *     sign-in → `useGpsLifecycle` mount with `enabled === true` does
 *     the start.
 */

type GeolocationClient = BackgroundGeolocationService;

export interface UsePermissionRefreshArgs {
  /**
   * Same `enabled` predicate `useGpsLifecycle` uses (signed-in + role-
   * appropriate registration complete). When `false`, the refresh
   * still re-polls + writes the store + fires the toast on the grant
   * edge, but skips calling `start()` — matches the lifecycle hook's
   * "do nothing while disabled" contract.
   */
  readonly enabled: boolean;
}

function isGranted(status: BgPermissionStatus): boolean {
  return status === 'always' || status === 'when_in_use';
}

export function usePermissionRefresh(args: UsePermissionRefreshArgs): void {
  const { enabled } = args;
  const bgGeolocation: GeolocationClient = useBackgroundGeolocation();
  const setPermissionStatus = useGpsStore((s) => s.setPermissionStatus);

  // Track the previous status in a ref so the edge-detection for the
  // grant-success toast doesn't trigger re-renders. Initialised to
  // null so the first poll doesn't fire the toast.
  const previousStatusRef = useRef<BgPermissionStatus | null>(null);
  // Latest `enabled` carried in a ref so the long-lived AppState
  // listener doesn't tear down on every prop change.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') return;
      void (async () => {
        const r = await bgGeolocation.requestAuthorizationIfNeeded();
        if (!r.ok) {
          // Stays warn — this is a probe, not a chain-fatal path.
          // The next AppState 'active' or the lifecycle hook's own
          // request-on-enable will retry.
          logger.warn('requestAuthorizationIfNeeded failed', r.error);
          return;
        }
        const newStatus = r.value;
        const prev = previousStatusRef.current;
        previousStatusRef.current = newStatus;

        // Push to the store unconditionally so view-models always
        // see the latest. Zustand bails on `===` per field, so a
        // no-op write is free.
        setPermissionStatus(newStatus);

        // Edge-detection: only act on a transition from a
        // non-granted state to a granted state. Skip the
        // initial-mount poll (prev === null) so a fresh launch
        // doesn't surface a toast for a permission the user
        // granted in a prior session.
        const flippedToGranted =
          prev !== null && !isGranted(prev) && isGranted(newStatus);
        if (!flippedToGranted) return;

        Toast.show({
          type: 'success',
          text1: 'Location access enabled — thanks!',
          visibilityTime: 2500,
        });

        if (enabledRef.current) {
          // Start the SDK now — useGpsLifecycle's effect won't
          // re-fire on a store-only permissionStatus change (its
          // deps don't include permissionStatus, and adding it
          // would create a feedback loop since the effect itself
          // writes the field). Adapter's `start()` is idempotent —
          // a no-op if already running.
          const startR = await bgGeolocation.start();
          if (!startR.ok) {
            logger.warn('start after grant failed', startR.error);
          }
        }
      })();
    });
    // Synchronous cleanup (RN ignores async cleanups). The
    // subscription's `.remove()` is itself synchronous — no Promise
    // gotchas.
    return () => {
      sub.remove();
    };
  }, [bgGeolocation, setPermissionStatus]);
}
