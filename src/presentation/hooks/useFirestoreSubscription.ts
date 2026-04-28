import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';

/**
 * Generic subscription hook for "subscribe → callback → unsubscribe"-shaped
 * use cases.
 *
 * The Phase 2 / Phase 3 use cases that observe Firestore docs and
 * subcollections (`ObserveRide`, `ObserveTripEvents`, `ObserveAuthState`,
 * `ObserveLatestMessage`, `SubscribeToUserLocation`, future driver-side
 * `subscribeAvailableRides`) all share the same shape:
 *
 *   const unsubscribe = useCase.execute({ ...args, callback: (value) => ... });
 *   // later:
 *   unsubscribe();
 *
 * This hook adapts that shape into React's `useSyncExternalStore` so the
 * subscribed value:
 *
 *   1. is consistent within a single render (no torn reads under React 19
 *      concurrent rendering)
 *   2. unsubscribes synchronously in the effect cleanup (legacy CLAUDE.md
 *      flagged async cleanup as a footgun — `useSyncExternalStore` enforces
 *      synchronous cleanup by design)
 *   3. is replay-safe across StrictMode double-mount (subscribe is called
 *      once per real mount, not per render)
 *
 * Generic over the value type. The caller supplies a `subscribe(callback) =>
 * unsubscribe` function — typically a closure over a use case + its args:
 *
 *   const ride = useFirestoreSubscription<Ride | null>(
 *     useCallback(
 *       (cb) => useCases.observeRide.execute({ rideId, callback: cb }),
 *       [useCases, rideId],
 *     ),
 *     null, // initial value before the source emits
 *   );
 *
 * IMPORTANT: the `subscribe` callback identity drives re-subscription. Wrap
 * it in `useCallback` with the full dependency list so a re-render with the
 * same logical args doesn't tear down + rebuild the Firestore listener.
 *
 * `initialValue` is what the hook returns BEFORE the source has emitted
 * anything. Most repository implementations emit the cached value
 * synchronously when `subscribe` is called, in which case `initialValue` is
 * only seen during SSR or on the very first synchronous render before the
 * source's initial emission lands.
 */
export function useFirestoreSubscription<T>(
  subscribe: (callback: (value: T) => void) => () => void,
  initialValue: T,
): T {
  // Latest snapshot lives in a ref so `getSnapshot` returns a
  // referentially-stable value across re-renders for the same emission.
  // `useSyncExternalStore` requires that — re-renders with a new object
  // identity from `getSnapshot` cause infinite render loops.
  const snapshotRef = useRef<T>(initialValue);

  // Adapter: when React's store machinery wants to subscribe, hand it our
  // source's subscribe(), translating each emission into a snapshot update
  // + `reactListener()` notification.
  //
  // React calls this once per stable `subscribe` identity. When `subscribe`
  // changes (e.g. the rideId arg changed), React tears down the previous
  // subscription via the returned cleanup and immediately resubscribes.
  const reactSubscribe = useCallback(
    (reactListener: () => void): (() => void) => {
      const unsubscribe = subscribe((value) => {
        snapshotRef.current = value;
        reactListener();
      });
      return unsubscribe;
    },
    [subscribe],
  );

  const getSnapshot = useCallback(() => snapshotRef.current, []);

  // `getServerSnapshot` is required for SSR but RN doesn't run server
  // rendering. Returning the same value as `getSnapshot` keeps the contract
  // honest if anyone tries.
  return useSyncExternalStore(reactSubscribe, getSnapshot, getSnapshot);
}

/**
 * Convenience wrapper for use cases that follow the
 * `execute({ ...args, callback })` shape directly. Memoizes the subscribe
 * closure for you; pass the dependencies that should retrigger subscription
 * in `deps` as you would for `useEffect`.
 *
 *   const ride = useUseCaseSubscription<Ride | null, { rideId: RideId }>({
 *     useCase: useCases.observeRide,
 *     args: { rideId },
 *     deps: [useCases, rideId],
 *     initialValue: null,
 *   });
 *
 * The `useCase` field is the use case object itself (with an `execute`
 * method that accepts `{ ...args, callback }` and returns an unsubscribe).
 * `args` is the input payload minus the `callback` field — the hook
 * supplies that.
 */
export function useUseCaseSubscription<T, A extends object>(opts: {
  readonly useCase: {
    execute: (args: A & { callback: (value: T) => void }) => () => void;
  };
  readonly args: A;
  readonly deps: readonly unknown[];
  readonly initialValue: T;
}): T {
  const { useCase, args, deps, initialValue } = opts;
  // Memoize on the dep list, not on `args` identity — callers pass fresh
  // object literals every render, but if the primitive deps didn't change
  // we don't want to re-subscribe.
  const subscribe = useMemo(
    () => (callback: (value: T) => void) =>
      useCase.execute({ ...args, callback }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );
  return useFirestoreSubscription(subscribe, initialValue);
}
