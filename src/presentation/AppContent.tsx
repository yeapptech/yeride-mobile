import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { isDriver, isRider, type User } from '@domain/entities/User';
import { NotificationPermissionSheet } from '@presentation/components/notifications/NotificationPermissionSheet';
import { useUseCases } from '@presentation/di';
import {
  useActiveRideForGeofence,
  useCrashReportingLifecycle,
  useForegroundNotificationHandler,
  useGlobalErrorHandler,
  useGpsLifecycle,
  useNotificationResponseHandler,
  usePermissionRefresh,
  usePushTokenRegistration,
} from '@presentation/hooks';
import { useCurrentUserQuery } from '@presentation/queries';
import {
  useGpsStore,
  useNotificationPermissionStatus,
  useNotificationPermissionUiStore,
  useNotificationSoftDismissedAt,
  useSessionStatus,
  useSessionStore,
} from '@presentation/stores';
import { ENV } from '@shared/env';
import { LOG } from '@shared/logger';

const logger = LOG.extend('AppContent');

const SAFETY_TIMEOUT_MS = 5_000;

/**
 * Subscribes to auth-state changes and drives the session store. Wraps the
 * UI tree, which mounts inside this component so screens render after the
 * listener is attached.
 *
 * Routing rules (status comes from the listener payload):
 *   - state === null              → setSignedOut() → AuthNavigator
 *   - state.emailVerified === false → setNeedsVerification(uid) →
 *     VerifyEmailNavigator (single-screen stack)
 *   - state.emailVerified === true  → setSignedIn(uid) → MainNavigator
 *
 * Carries the legacy app's lessons:
 *   - `initializing` blocks the UI until we hear from auth at least once.
 *   - A 5-second safety timeout flips to `unauthenticated` if Auth never
 *     responds (e.g. cold network), so the app doesn't hang on a splash
 *     forever.
 *   - The auth listener is owned here exactly once. Screens never call
 *     `getAuth()` or subscribe themselves.
 *
 * Phase 7 turn 2 additions:
 *   - Mounts `useGpsLifecycle` once at the AppContent level. The
 *     `enabled` predicate mirrors the legacy `gpsStart(200)` gate from
 *     `yeride/AppContent.js`: signed-in + email-verified + (rider with
 *     a default payment method OR driver with Stripe Connect charges
 *     and payouts both enabled). View-models read GPS state via the
 *     `useGpsStore` selector hooks — they never call into the SDK
 *     directly.
 *   - Resolves the active ride for pickup-geofence registration via
 *     `useActiveRideForGeofence(user)`. When the user has an
 *     `'dispatched'` ride, the lifecycle hook (re-)registers a
 *     pickup geofence; on any other status (or no active ride), it
 *     deregisters. The single registration site mirrors legacy
 *     behaviour and matches the kickoff Decision 5.
 *   - Resets `useGpsStore` on transition to `'unauthenticated'` so a
 *     subsequent sign-in starts with a clean slate (no stale
 *     coordinates / odometer / geofence state from the previous user).
 */
export function AppContent({ children }: { children: ReactNode }) {
  const { observeAuthState } = useUseCases();
  const setInitializing = useSessionStore((s) => s.setInitializing);
  const setNeedsVerification = useSessionStore((s) => s.setNeedsVerification);
  const setSignedIn = useSessionStore((s) => s.setSignedIn);
  const setSignedOut = useSessionStore((s) => s.setSignedOut);

  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setInitializing();
    safetyTimerRef.current = setTimeout(() => {
      const status = useSessionStore.getState().status;
      if (status === 'initializing') {
        logger.warn(
          `Safety timeout (${String(SAFETY_TIMEOUT_MS)}ms) hit; falling back to unauthenticated`,
        );
        setSignedOut();
      }
    }, SAFETY_TIMEOUT_MS);

    const unsubscribe = observeAuthState.execute((state) => {
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
      if (state === null) {
        setSignedOut();
        return;
      }
      if (!state.emailVerified) {
        setNeedsVerification(state.userId);
        return;
      }
      setSignedIn(state.userId);
    });

    return () => {
      unsubscribe();
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
    };
  }, [
    observeAuthState,
    setInitializing,
    setNeedsVerification,
    setSignedIn,
    setSignedOut,
  ]);

  /* ──────────── Phase 7 turn 2: GPS lifecycle ──────────── */

  const sessionStatus = useSessionStatus();
  const userQuery = useCurrentUserQuery();
  const user = userQuery.data ?? null;

  const enabled = useMemo(
    () => sessionStatus === 'authenticated' && isRegistrationComplete(user),
    [sessionStatus, user],
  );

  const activeRideForGeofence = useActiveRideForGeofence(user);

  useGpsLifecycle({
    enabled,
    userId: user?.id ?? null,
    activeRideForGeofence,
  });

  // Phase 9 turn 10 — recover from a Settings-driven permission grant.
  // Listens on `AppState 'change' → 'active'`, re-polls the SDK, writes
  // the latest status to `useGpsStore`, and on a `denied → granted` edge
  // (a) fires a success toast and (b) calls `bgGeolocation.start()`
  // when `enabled === true` (useGpsLifecycle's effect deps don't
  // include `permissionStatus`, so a store-only flip won't restart the
  // SDK on its own — adding the dep would create a feedback loop since
  // the effect itself writes the field). Mounted as a sibling so the
  // existing useGpsLifecycle tests stay untouched.
  usePermissionRefresh({ enabled });

  // Wipe transient GPS state when the user signs out so the next sign-
  // in starts fresh. The `useGpsLifecycle` hook stops the SDK on
  // `enabled === false`, but it deliberately leaves the store in place
  // (so a brief `enabled` flicker doesn't drop the user's last known
  // location). Sign-out is the canonical reset point.
  useEffect(() => {
    if (sessionStatus === 'unauthenticated') {
      useGpsStore.getState().reset();
      useNotificationPermissionUiStore.getState().reset();
    }
  }, [sessionStatus]);

  /* ──────────── Phase 9 turn 3 sub-turn 3b: Crashlytics ──────────── */

  // Configure the Crashlytics SDK: collection toggle on first mount,
  // setUserId + setAttributes({role, env}) after auth resolves, clear
  // identity on sign-out. Mirrors the legacy
  // `yeride/AppContent.js` post-userSubscribe block (lines ~380-390)
  // and sign-out clear (line ~547). The `CrashlyticsLogTransport`
  // attached from `<ContainerProvider/>` covers the breadcrumb +
  // non-fatal-error stream.
  useCrashReportingLifecycle({ user, env: ENV.EXPO_PUBLIC_APP_ENV });

  // Wrap RN's global JS error handler so uncaught throws are recorded
  // to Crashlytics before the red-box / silent crash. Mounted as a
  // sibling hook (kickoff decision (c)) for cleaner test boundary +
  // ESLint scoping.
  useGlobalErrorHandler();

  /* ──────────── Phase 9 turn 2: push-notification registration ──────────── */

  // Mount the push-token registration hook once, here at AppContent.
  // The hook owns the SDK lifecycle (Android channel setup,
  // permission-status mirror into Zustand, token registration on grant,
  // token-refresh subscription). View-models read permission state via
  // `useNotificationPermissionStatus()` selector.
  //
  // Pass the user only when registration is complete — same gate as
  // GPS lifecycle. There's no point asking for notification permission
  // before the user even has a Stripe customer / vehicle on file
  // (legacy parity).
  const userForPush = enabled ? user : null;
  const { promptForPermission } = usePushTokenRegistration(userForPush);

  // Notification-tap routing (Phase 9 turn 2 sub-turn 2c). Mounted
  // unconditionally — taps should always route, even before
  // registration completes (a deep-link from a prior tap should still
  // land the user on the right screen). The hook reads
  // `pushService.subscribeToNotificationResponse` for warm-state taps
  // and `pushService.getLastNotificationResponse()` for the cold-start
  // path. Routes via the shared `navigationRef` from
  // `@presentation/navigation/navigationRef`.
  useNotificationResponseHandler();

  // Foreground notification handler (Phase 10 turn 8). Decides
  // whether to show the OS-level banner / sound / list entry when a
  // push arrives while the app is foregrounded. Suppresses
  // `chat_message` banners for the currently-open chat thread so the
  // user isn't notified about a message they're already reading.
  // Mounted unconditionally — the handler reads
  // `useChatUiStore.getState().openRideId` lazily on every delivery.
  useForegroundNotificationHandler();

  // Soft-ask sheet: visible when the user is fully registered, the OS
  // permission is undetermined, and the user hasn't tapped "Not now"
  // this session. Once the user dismisses, the sheet stays hidden
  // until a sign-out / sign-in cycle resets the UI store.
  const permissionStatus = useNotificationPermissionStatus();
  const softDismissedAt = useNotificationSoftDismissedAt();
  const setSoftDismissed = useNotificationPermissionUiStore(
    (s) => s.setSoftDismissed,
  );
  const sheetVisible =
    enabled && permissionStatus === 'undetermined' && softDismissedAt === null;
  const promptingRef = useRef(false);

  const handleEnable = useCallback((): void => {
    if (promptingRef.current) return;
    promptingRef.current = true;
    void (async () => {
      try {
        await promptForPermission();
      } finally {
        promptingRef.current = false;
      }
    })();
  }, [promptForPermission]);

  const handleDismiss = useCallback((): void => {
    setSoftDismissed(Date.now());
  }, [setSoftDismissed]);

  return (
    <>
      {children}
      <NotificationPermissionSheet
        visible={sheetVisible}
        onEnable={handleEnable}
        onDismiss={handleDismiss}
      />
    </>
  );
}

/**
 * Mirrors the legacy `computeTargetRoute` predicate: a rider has
 * "completed registration" when they have a default payment method on
 * file; a driver when their Stripe Connect account has both
 * `chargesEnabled` and `payoutsEnabled`. Riders / drivers in mid-
 * onboarding don't get GPS yet — same gate the legacy app applied
 * before calling `gpsStart(200)`.
 */
function isRegistrationComplete(user: User | null): boolean {
  if (!user) return false;
  if (isRider(user)) {
    return user.defaultPaymentMethodId !== null;
  }
  if (isDriver(user)) {
    return user.stripeChargesEnabled && user.stripePayoutsEnabled;
  }
  return false;
}
