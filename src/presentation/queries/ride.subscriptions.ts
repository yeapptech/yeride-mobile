import { useMemo } from 'react';

import type { Ride } from '@domain/entities/Ride';
import type { UserId } from '@domain/entities/UserId';
import { useUseCases } from '@presentation/di';
import { useUseCaseSubscription } from '@presentation/hooks/useFirestoreSubscription';

/**
 * Live list of the user's in-progress rides for the Home In-progress
 * section, sorted newest-first. Wraps `useUseCaseSubscription` (same
 * approach as `useAvailableRidesQuery`) — these push continuously, so
 * they live outside TanStack Query. Empty while `userId` is null or the
 * subscription is initializing.
 *
 * Rules of Hooks: the hook is always called unconditionally. A
 * `canSubscribe` flag gates the real subscription; when false the
 * inline execute wrapper emits `[]` once and returns a no-op unsubscribe.
 */
export function useInProgressRidesSubscription(
  userId: UserId | null,
  role: 'rider' | 'driver',
): readonly Ride[] {
  const useCases = useUseCases();
  const canSubscribe = userId !== null;
  const rides = useUseCaseSubscription<
    readonly Ride[],
    { userId: UserId; role: 'rider' | 'driver' }
  >({
    useCase: {
      execute: (
        execArgs: {
          userId: UserId;
          role: 'rider' | 'driver';
        } & { callback: (rides: readonly Ride[]) => void },
      ) => {
        if (!canSubscribe) {
          execArgs.callback([]);
          return () => undefined;
        }
        return useCases.observeInProgressRides.execute(execArgs);
      },
    },
    args: { userId: userId as UserId, role },
    deps: [
      useCases,
      canSubscribe,
      userId === null ? null : String(userId),
      role,
    ],
    initialValue: [],
  });
  return useMemo(
    () =>
      [...rides].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    [rides],
  );
}

/**
 * Live list of the rider's scheduled rides, sorted next-soonest-first.
 * Factored out of the Activity VM so the rider Home + Activity tab share
 * one implementation. Wraps `useUseCaseSubscription` (same approach as
 * `useAvailableRidesQuery`).
 *
 * Rules of Hooks: the hook is always called unconditionally. A
 * `canSubscribe` flag gates the real subscription; when false the
 * inline execute wrapper emits `[]` once and returns a no-op unsubscribe.
 */
export function useScheduledRidesSubscription(
  passengerId: UserId | null,
): readonly Ride[] {
  const useCases = useUseCases();
  const canSubscribe = passengerId !== null;
  const rides = useUseCaseSubscription<
    readonly Ride[],
    { passengerId: UserId }
  >({
    useCase: {
      execute: (
        execArgs: { passengerId: UserId } & {
          callback: (rides: readonly Ride[]) => void;
        },
      ) => {
        if (!canSubscribe) {
          execArgs.callback([]);
          return () => undefined;
        }
        return useCases.observeScheduledRides.execute(execArgs);
      },
    },
    args: { passengerId: passengerId as UserId },
    deps: [
      useCases,
      canSubscribe,
      passengerId === null ? null : String(passengerId),
    ],
    initialValue: [],
  });
  return useMemo(
    () =>
      [...rides].sort((a, b) => {
        const aT = a.schedulePickupAt?.getTime() ?? Number.POSITIVE_INFINITY;
        const bT = b.schedulePickupAt?.getTime() ?? Number.POSITIVE_INFINITY;
        return aT - bT;
      }),
    [rides],
  );
}
