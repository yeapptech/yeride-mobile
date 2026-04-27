import { useNavigation } from '@react-navigation/native';
import { useCallback, useState } from 'react';

import { useUseCases } from '@presentation/di';
import type { AuthStackNavigation } from '@presentation/navigation/types';
import { formatDomainError } from '@shared/errors';

export function useForgotPasswordViewModel() {
  const { resetPassword } = useUseCases();
  const navigation = useNavigation<AuthStackNavigation>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = useCallback(
    async (email: string) => {
      setSubmitting(true);
      setError(null);
      const r = await resetPassword.execute({ email });
      setSubmitting(false);
      if (!r.ok) {
        setError(formatDomainError(r.error));
        return;
      }
      setSent(true);
    },
    [resetPassword],
  );

  const goBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('LogIn');
  }, [navigation]);

  return { submit, submitting, error, sent, goBack };
}
