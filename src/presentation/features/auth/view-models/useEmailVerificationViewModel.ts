import { useCallback, useEffect, useRef, useState } from 'react';

import { useUseCases } from '@presentation/di';
import { useSessionStore } from '@presentation/stores';
import { formatDomainError } from '@shared/errors';

const POLL_INTERVAL_MS = 5_000;

/**
 * View-model for `EmailVerificationScreen`. Polls auth every 5s while the
 * screen is mounted; flips to "verified" when the user clicks the link in
 * their email. Also exposes a "resend" action.
 *
 * Why this view-model nudges the session store directly:
 *   Firebase Auth's `onAuthStateChanged` does NOT re-fire when
 *   `emailVerified` flips on the same user (e.g. after `user.reload()`),
 *   which is what `checkEmailVerified` does under the hood. Without an
 *   explicit nudge, the app would stay on this screen forever even after
 *   verification. So when the poll observes verification, we also call
 *   `setSignedIn(uid)` on the session store so `RootNavigator` swaps from
 *   `VerifyEmailNavigator` → `MainNavigator`.
 *   The InMemoryAuthRepository's `markCurrentVerified` follows the same
 *   pattern: it notifies observers, so the AppContent listener takes the
 *   verified path naturally.
 */
export function useEmailVerificationViewModel() {
  const { sendEmailVerification, checkEmailVerified, logOutUser } =
    useUseCases();
  const setSignedIn = useSessionStore((s) => s.setSignedIn);
  const userId = useSessionStore((s) => s.userId);
  const [verified, setVerified] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  // Poll for verification status while mounted.
  useEffect(() => {
    cancelledRef.current = false;
    const tick = async () => {
      const r = await checkEmailVerified.execute();
      if (cancelledRef.current) return;
      if (r.ok && r.value.verified) {
        setVerified(true);
        // Manual session flip — see the JSDoc above for why this is needed.
        // Using getState() instead of the captured userId/setSignedIn ensures
        // we always read the latest store state, and we no-op if the user
        // signed out in the meantime.
        const current = useSessionStore.getState();
        if (current.status === 'needs-verification' && current.userId) {
          setSignedIn(current.userId);
        }
      }
    };
    void tick();
    const handle = setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(handle);
    };
  }, [checkEmailVerified, setSignedIn]);

  const resend = useCallback(async () => {
    setResending(true);
    setError(null);
    const r = await sendEmailVerification.execute();
    setResending(false);
    if (!r.ok) {
      setError(formatDomainError(r.error));
    }
  }, [sendEmailVerification]);

  const signOut = useCallback(async () => {
    await logOutUser.execute();
  }, [logOutUser]);

  return { verified, resend, resending, error, signOut, userId };
}
