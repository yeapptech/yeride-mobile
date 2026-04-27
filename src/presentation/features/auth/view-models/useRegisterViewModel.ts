import { useNavigation } from '@react-navigation/native';
import { useCallback, useState } from 'react';

import type { Role } from '@domain/entities/Role';
import { useUseCases } from '@presentation/di';
import type { AuthStackNavigation } from '@presentation/navigation/types';
import { formatDomainError } from '@shared/errors';

interface RegisterForm {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  role: Role;
}

/**
 * View-model for `RegisterScreen`. After successful registration the auth
 * adapter signs the new user in as a side effect; `AppContent`'s listener
 * picks that up and the session store flips, which causes `RootNavigator`
 * to mount the next screen. The view-model does NOT navigate on success —
 * see the comment in `submit` for why navigating eagerly causes a "NAVIGATE
 * was not handled" error and why routing is fully reactive instead.
 */
export function useRegisterViewModel() {
  const { registerUser } = useUseCases();
  const navigation = useNavigation<AuthStackNavigation>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (form: RegisterForm) => {
      setSubmitting(true);
      setError(null);
      const r = await registerUser.execute(form);
      setSubmitting(false);
      if (!r.ok) {
        setError(formatDomainError(r.error));
        return;
      }
      // Routing is reactive — `AppContent`'s auth listener picks up the new
      // signed-in user and the session store flips status, which causes
      // `RootNavigator` to mount the appropriate next screen. We deliberately
      // do NOT call `navigation.navigate('EmailVerification', …)` here:
      // by the time `registerUser.execute()` resolves, the listener has
      // already unmounted `AuthNavigator`, so the navigate call would hit
      // a navigator that no longer exists and React Navigation would log
      // "action 'NAVIGATE' was not handled by any navigator".
      //
      // KNOWN GAP — email verification gating: with the in-memory fakes the
      // user lands directly on the placeholder home. Once real Firebase is
      // wired, an unverified user should land on `EmailVerificationScreen`
      // until they confirm their email. That requires extending the session
      // store with a 'needs-verification' status and routing in
      // `RootNavigator`. Tracked for Phase 2 prep.
    },
    [registerUser],
  );

  const goToLogIn = useCallback(() => {
    navigation.navigate('LogIn');
  }, [navigation]);

  return { submit, submitting, error, goToLogIn };
}
