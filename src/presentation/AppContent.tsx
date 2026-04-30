import { useEffect, useMemo, useRef, type ReactNode } from 'react';

import { isDriver, isRider, type User } from '@domain/entities/User';
import { useUseCases } from '@presentation/di';
import { useActiveRideForGeofence, useGpsLifecycle } from '@presentation/hooks';
import { useCurrentUserQuery } from '@presentation/queries';
import {
  useGpsStore,
  useSessionStatus,
  useSessionStore,
} from '@presentation/stores';
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

  // Wipe transient GPS state when the user signs out so the next sign-
  // in starts fresh. The `useGpsLifecycle` hook stops the SDK on
  // `enabled === false`, but it deliberately leaves the store in place
  // (so a brief `enabled` flicker doesn't drop the user's last known
  // location). Sign-out is the canonical reset point.
  useEffect(() => {
    if (sessionStatus === 'unauthenticated') {
      useGpsStore.getState().reset();
    }
  }, [sessionStatus]);

  return <>{children}</>;
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
