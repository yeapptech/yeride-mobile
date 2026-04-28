import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import type { UserLocation } from '@domain/entities/UserLocation';
import type { NetworkError } from '@domain/errors';
import { useUseCases } from '@presentation/di';

/**
 * Mutation: write a UserLocation snapshot to Firestore.
 *
 * Most callers fire-and-forget this — the legacy app does, and Phase 4
 * will too. Wrapping it in a TanStack mutation gives us:
 *   - automatic retry semantics (the adapter already does 3-retry backoff;
 *     `useMutation`'s `retry` config layers on top if we want)
 *   - the same error-channel hooks (`onError`, `useMutationState`) we use
 *     elsewhere — useful for surface-level "couldn't save your location"
 *     toasts in development
 *   - mutationStateKey if we ever want to dedupe in-flight writes
 *
 * No `onSuccess` cache invalidation: the location is push-only. Other
 * users observe it via Firestore subscription (Phase 4 driver pipeline).
 */
export function useUpdateLocationMutation(): UseMutationResult<
  true,
  NetworkError,
  UserLocation
> {
  const useCases = useUseCases();
  return useMutation<true, NetworkError, UserLocation>({
    mutationFn: async (location: UserLocation): Promise<true> => {
      const r = await useCases.updateUserLocation.execute(location);
      if (!r.ok) throw r.error;
      return true;
    },
    // Adapter does 3-retry backoff already; don't double-retry.
    retry: false,
  });
}
