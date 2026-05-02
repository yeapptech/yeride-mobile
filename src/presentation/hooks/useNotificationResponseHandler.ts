import { useEffect, useRef } from 'react';

import type { NavigationIntent, NotificationResponse } from '@domain/services';
import { usePushNotificationService, useUseCases } from '@presentation/di';
import { navigationRef } from '@presentation/navigation/navigationRef';
import { LOG } from '@shared/logger';

const logger = LOG.extend('NotifTapHandler');

/**
 * Single owner of the notification-tap routing pipeline.
 *
 * **AppContent-only**. Mount this hook exactly once, at the very top of
 * the React tree, inside `AppContent.tsx`. It does NOT read user state
 * or gate on registration — taps should always route, even before
 * registration completes (a deep-link from a prior tap should still
 * land the user on the right screen).
 *
 * Responsibilities:
 *
 *   1. **Warm-state subscription.** Subscribe to
 *      `pushService.subscribeToNotificationResponse` for taps that
 *      arrive while the JS runtime is alive. Each delivery passes
 *      through `HandleNotificationResponse` and dispatches via the
 *      shared `navigationRef`. Synchronous unsubscribe.
 *
 *   2. **Cold-start path.** First time the hook mounts (per `useRef`
 *      guard), call `pushService.getLastNotificationResponse()` once
 *      to read the SDK's buffered launching tap. The SDK delivers
 *      exactly one buffered response (the one that actually launched
 *      the app), so re-firing on every render would burn it. The
 *      handler waits for `navigationRef.isReady()` to flip true via a
 *      short polling loop — the navigator tree typically mounts within
 *      a few hundred ms of AppContent mount, but we don't want to
 *      drop a tap on a slow boot.
 *
 *   3. **`'unknown'` arm is a no-op.** A payload with a `type` the use
 *      case doesn't recognize routes to `target: 'unknown'`; the hook
 *      logs and skips the navigation. Forward-compatible with future
 *      Cloud Function payload types.
 *
 * Routing details:
 *
 *   - `rider_ride_monitor`  → `navigate('RideMonitor', {rideId})`
 *   - `rider_ride_receipt`  → `navigate('RideReceipt', {rideId})`
 *   - `driver_dispatch`     → `navigate('DriverDispatch', {rideId})`
 *   - `driver_earnings`     → `navigate('DriverTabs', {screen: 'Earnings'})`
 *   - `unknown`             → no-op (logged at debug)
 *
 * If the active navigator doesn't contain the target screen (e.g. a
 * driver receives a `rider_ride_monitor` tap because they were
 * mid-role-switch), React Navigation will silently no-op — no crash,
 * no incorrect navigation. Same for taps that arrive before sign-in.
 *
 * Cold-start race handling: `navigationRef.isReady()` returns false
 * for a brief window between AppContent mount and the first
 * `<Stack.Screen/>` render. We poll up to ~3 seconds (30 checks at
 * 100ms) before giving up — enough budget to absorb a slow Firestore
 * fetch on the auth path without dropping the tap.
 */
export function useNotificationResponseHandler(): void {
  const pushService = usePushNotificationService();
  const useCases = useUseCases();

  // Effect 1: warm-state subscription.
  useEffect(() => {
    const unsubscribe = pushService.subscribeToNotificationResponse(
      (response) => {
        routeResponse(response, useCases.handleNotificationResponse);
      },
    );
    return unsubscribe;
  }, [pushService, useCases]);

  // Effect 2: cold-start path. `useRef` guard ensures we only consume
  // the SDK's buffered tap once per app launch.
  const coldStartHandledRef = useRef(false);
  useEffect(() => {
    if (coldStartHandledRef.current) return;
    coldStartHandledRef.current = true;
    void (async () => {
      const r = await pushService.getLastNotificationResponse();
      if (!r.ok) {
        logger.warn('getLastNotificationResponse failed', r.error);
        return;
      }
      if (r.value === null) return; // app was opened normally, not via tap
      routeResponse(r.value, useCases.handleNotificationResponse);
    })();
  }, [pushService, useCases]);
}

/**
 * Run a normalized `NotificationResponse` through the use case and
 * dispatch the resulting intent via the shared `navigationRef`. Top-
 * level helper (not closure-captured) so it's straightforward to
 * unit-test the routing rules in isolation.
 *
 * Polls `navigationRef.isReady()` for up to ~3 seconds before giving
 * up — covers the cold-start race where the SDK delivers a buffered
 * tap before the navigator tree has mounted its first screen.
 */
function routeResponse(
  response: NotificationResponse,
  handleNotificationResponse: ReturnType<
    typeof useUseCases
  >['handleNotificationResponse'],
): void {
  const intentR = handleNotificationResponse.execute(response);
  if (!intentR.ok) {
    logger.warn('HandleNotificationResponse rejected payload', {
      code: intentR.error.code,
    });
    return;
  }
  const intent = intentR.value;
  if (intent.target === 'unknown') {
    logger.debug('notification tap routed to unknown — skipping navigation', {
      type: response.data['type'],
    });
    return;
  }

  void waitForNavigationReady(3_000).then((ready) => {
    if (!ready) {
      logger.warn(
        'navigationRef not ready after 3s — dropping notification tap',
        { target: intent.target },
      );
      return;
    }
    dispatchIntent(intent);
  });
}

async function waitForNavigationReady(timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  // Already ready? Fast path.
  if (navigationRef.isReady()) return true;
  // Poll at 100ms intervals.
  while (Date.now() - start < timeoutMs) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
    if (navigationRef.isReady()) return true;
  }
  return false;
}

/**
 * Build a NAVIGATE action manually so the typing matches
 * `navigationRef.dispatch`'s signature under `exactOptionalPropertyTypes`.
 *
 * Why not `CommonActions.navigate({name, params})`: it returns an
 * `Action` whose `payload` is `ResetState | undefined`, but
 * `navigationRef.dispatch` expects `payload?: object` (optional, but
 * if present, must be `object` — not `undefined`). The mismatch is
 * cosmetic and rejected only because of `exactOptionalPropertyTypes`.
 * Building the action shape inline sidesteps it without a cast.
 *
 * Why not the tuple form `navigationRef.navigate(name, params)`: the
 * navigationRef's generic defaults to `ParamListBase`, which makes
 * the params arg infer as `never` — TS rejects every typed call.
 */
function navigateAction(name: string, params?: object) {
  return {
    type: 'NAVIGATE',
    payload: params === undefined ? { name } : { name, params },
  };
}

function dispatchIntent(intent: NavigationIntent): void {
  switch (intent.target) {
    case 'rider_ride_monitor':
      navigationRef.dispatch(
        navigateAction('RideMonitor', { rideId: String(intent.rideId) }),
      );
      return;
    case 'rider_ride_receipt':
      navigationRef.dispatch(
        navigateAction('RideReceipt', { rideId: String(intent.rideId) }),
      );
      return;
    case 'driver_dispatch':
      navigationRef.dispatch(
        navigateAction('DriverDispatch', { rideId: String(intent.rideId) }),
      );
      return;
    case 'driver_earnings':
      // Earnings lives under the DriverTabs nested navigator. The
      // `params: { screen: 'Earnings' }` form is React Navigation's
      // canonical "navigate to a screen inside a nested navigator"
      // shape — RN unwraps it and switches the active tab.
      navigationRef.dispatch(
        navigateAction('DriverTabs', { screen: 'Earnings' }),
      );
      return;
    case 'unknown':
      return;
  }
}
