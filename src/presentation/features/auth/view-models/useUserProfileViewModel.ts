import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';

import type { User } from '@domain/entities/User';
import { useUseCases } from '@presentation/di';
import type { RiderStackNavigation } from '@presentation/navigation/types';
import { formatDomainError } from '@shared/errors';

interface ProfileForm {
  firstName: string;
  lastName: string;
  phone: string;
}

export function useUserProfileViewModel() {
  const { getCurrentUser, updateProfile, logOutUser } = useUseCases();
  const navigation = useNavigation<RiderStackNavigation>();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await getCurrentUser.execute();
    setLoading(false);
    if (r.ok) {
      setUser(r.value.user);
      setError(null);
      return;
    }
    setError(formatDomainError(r.error));
  }, [getCurrentUser]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = useCallback(
    async (form: ProfileForm) => {
      setSubmitting(true);
      setError(null);
      const r = await updateProfile.execute(form);
      setSubmitting(false);
      if (!r.ok) {
        setError(formatDomainError(r.error));
        return;
      }
      setUser(r.value.user);
      if (navigation.canGoBack()) navigation.goBack();
    },
    [updateProfile, navigation],
  );

  const signOut = useCallback(async () => {
    await logOutUser.execute();
  }, [logOutUser]);

  return { user, loading, submitting, error, submit, signOut };
}
