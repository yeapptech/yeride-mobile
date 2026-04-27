import { useEffect, useRef, type ReactNode } from 'react';

import { useUseCases } from '@presentation/di';
import { useSessionStore } from '@presentation/stores';
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

  return <>{children}</>;
}
