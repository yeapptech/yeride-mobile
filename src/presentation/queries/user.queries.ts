import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { User } from '@domain/entities/User';
import type { AuthorizationError, NotFoundError } from '@domain/errors';
import { useUseCases } from '@presentation/di';
import { useCurrentUserId } from '@presentation/stores';

import { queryKeys } from './keys';

/**
 * One-shot read of the currently signed-in user's profile.
 *
 * The session store carries the userId; this query resolves the full
 * `User` aggregate (role, profile, saved places, defaultPaymentMethod,
 * etc.) needed by `RootNavigator` for role-based routing and by
 * `useRiderHomeViewModel`.
 *
 * Why not always-on subscription instead of a query? The user doc is
 * mostly static — name, phone, avatar update via explicit user actions
 * which we can `invalidateQueries` from the corresponding mutation.
 * `payment_methods` and `inProgressTrip` aren't fields on the user doc
 * (the rewrite separates them into Stripe + the trips collection).
 *
 * Returns `AuthorizationError` when no one is signed in. The query is
 * `enabled: false` in that case, so `data` stays `undefined` and the
 * RootNavigator falls back to the AuthStack.
 *
 * Returns `NotFoundError` when the auth session exists but the
 * Firestore user doc is missing — a rare race after sign-up. Surfaces
 * as a friendly retry on the host screen.
 */
export function useCurrentUserQuery(): UseQueryResult<
  User,
  AuthorizationError | NotFoundError
> {
  const useCases = useUseCases();
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: queryKeys.user.current(),
    queryFn: async (): Promise<User> => {
      const r = await useCases.getCurrentUser.execute();
      if (!r.ok) throw r.error;
      return r.value.user;
    },
    enabled: userId !== null,
  });
}
