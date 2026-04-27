import { useNavigation } from '@react-navigation/native';
import { useCallback, useState } from 'react';

import { useUseCases } from '@presentation/di';
import type { AuthStackNavigation } from '@presentation/navigation/types';
import { formatDomainError } from '@shared/errors';

interface LogInForm {
  email: string;
  password: string;
}

/**
 * View-model for `LogInScreen`. Owns the form's submitting/error state and
 * dispatches to the `LogInUser` use case. Navigation on success is handled
 * by AppContent's auth listener — this view-model never calls `navigate`
 * for the happy path.
 */
export function useLogInViewModel() {
  const { logInUser } = useUseCases();
  const navigation = useNavigation<AuthStackNavigation>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (input: LogInForm) => {
      setSubmitting(true);
      setError(null);
      const r = await logInUser.execute(input);
      setSubmitting(false);
      if (!r.ok) {
        setError(formatDomainError(r.error));
        return;
      }
      // Success: AppContent's onAuthStateChanged fires, session store flips,
      // RootNavigator swaps to MainNavigator. No explicit navigation here.
    },
    [logInUser],
  );

  const goToRegister = useCallback(() => {
    navigation.navigate('Register');
  }, [navigation]);

  const goToForgotPassword = useCallback(() => {
    navigation.navigate('ForgotPassword');
  }, [navigation]);

  return { submit, submitting, error, goToRegister, goToForgotPassword };
}
