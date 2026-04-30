import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { buildContainer, type Container, type UseCases } from './container';

const ContainerContext = createContext<Container | null>(null);

interface ContainerProviderProps {
  /**
   * Override the container — used by tests to inject in-memory fakes.
   * In production, omit this prop and the provider builds the real container.
   */
  container?: Container;
  children: ReactNode;
}

/**
 * Provides the DI container to the React tree. Wrap the app root in this once.
 */
export function ContainerProvider({
  container,
  children,
}: ContainerProviderProps) {
  const value = useMemo(() => container ?? buildContainer(), [container]);
  return (
    <ContainerContext.Provider value={value}>
      {children}
    </ContainerContext.Provider>
  );
}

/**
 * Hook returning the use-case map. Throws if used outside of a
 * ContainerProvider — that's a programming error, not a domain error.
 */
export function useUseCases(): UseCases {
  const ctx = useContext(ContainerContext);
  if (ctx === null) {
    throw new Error(
      'useUseCases() called outside <ContainerProvider/>. Wrap your tree in <ContainerProvider/>.',
    );
  }
  return ctx.useCases;
}

/**
 * Hook returning the background-geolocation seam. Sibling of
 * `useUseCases()` because `useGpsLifecycle` (Phase 7 turn 2) drives the
 * SDK lifecycle directly — its responsibilities (permission flow,
 * listener-level dedup, geofence registration) don't fit the
 * stateless-use-case shape used by every other domain.
 *
 * Throws if used outside of a ContainerProvider — same contract as
 * `useUseCases()`.
 *
 * Mounting rule:
 *   - This hook is consumed exclusively by `useGpsLifecycle`. Screens
 *     and view-models read GPS state via `useGpsStore`'s selector hooks
 *     (`useGpsCurrentLocation`, `useGpsCurrentOdometer`, …) — they
 *     never reach into the SDK directly.
 */
export function useBackgroundGeolocation(): Container['bgGeolocation'] {
  const ctx = useContext(ContainerContext);
  if (ctx === null) {
    throw new Error(
      'useBackgroundGeolocation() called outside <ContainerProvider/>. Wrap your tree in <ContainerProvider/>.',
    );
  }
  return ctx.bgGeolocation;
}
