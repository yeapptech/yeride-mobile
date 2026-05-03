import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';

import { CrashlyticsLogTransport, LOG } from '@shared/logger';

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
 *
 * Phase 9 turn 3 sub-turn 3b: also attaches the `CrashlyticsLogTransport`
 * to the singleton `LOG` once the container resolves, and detaches on
 * unmount. Keyed on the resolved container reference so a rare prop-swap
 * (tests) re-wires cleanly. The transport is always attached — even in
 * dev / fakes-only builds where `crashReporting` is the in-memory fake;
 * the fake silently records breadcrumbs to memory, so the runtime
 * behavior of every consumer of `LOG.*` is unchanged whether or not
 * Firebase is configured.
 */
export function ContainerProvider({
  container,
  children,
}: ContainerProviderProps) {
  const value = useMemo(() => container ?? buildContainer(), [container]);

  // Phase 9 turn 3 sub-turn 3b — runtime attachment hop. The
  // `CrashlyticsLogTransport` can't be attached at logger module-load
  // because the SDK isn't available until the DI container resolves.
  // Mounting it here ties the transport's lifetime to the provider's,
  // so a test that mounts + unmounts the provider doesn't leak the
  // transport across tests.
  useEffect(() => {
    const transport = new CrashlyticsLogTransport(value.crashReporting);
    LOG.addTransport(transport);
    return () => {
      LOG.removeTransport(transport);
    };
  }, [value]);

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

/**
 * Hook returning the Google Navigation SDK seam (Phase 8 turn 1).
 * Sibling of `useUseCases()` and `useBackgroundGeolocation()` for the
 * same reason: the SDK's `useNavigationController` hook is React-tied,
 * and the `useDriverNavigationViewModel` (Turn 2) drives the session
 * lifecycle directly through this adapter rather than through a
 * stateless use case.
 *
 * Throws if used outside of a ContainerProvider — same contract as
 * `useUseCases()`.
 *
 * Mounting rule:
 *   - This hook is consumed exclusively by the Phase 8 Turn 2
 *     `DriverNavigationScreen`'s connector hook (which calls
 *     `useNavigationController` from the SDK and pushes the controller
 *     into the adapter via `setController`). Other view-models / screens
 *     never reach into the SDK directly.
 */
export function useNavigationSdk(): Container['navigationSdk'] {
  const ctx = useContext(ContainerContext);
  if (ctx === null) {
    throw new Error(
      'useNavigationSdk() called outside <ContainerProvider/>. Wrap your tree in <ContainerProvider/>.',
    );
  }
  return ctx.navigationSdk;
}

/**
 * Hook returning the push-notifications SDK seam (Phase 9 turn 2 sub-turn 2b).
 * Sibling of `useUseCases()` and `useBackgroundGeolocation()` because
 * `usePushTokenRegistration` drives the SDK lifecycle directly
 * (permission flow, token-refresh subscription, Android-channel setup
 * at boot) and its responsibilities don't fit the stateless-use-case
 * shape used by every other domain.
 *
 * Throws if used outside of a ContainerProvider — same contract as
 * `useUseCases()`.
 *
 * Mounting rule:
 *   - This hook is consumed exclusively by `usePushTokenRegistration`,
 *     which mounts once at AppContent. Screens and view-models never
 *     reach into the SDK directly; they read permission state via
 *     `useNotificationPermissionStatus()` and trigger the OS prompt
 *     via the soft-ask sheet's CTA.
 */
export function usePushNotificationService(): Container['pushNotifications'] {
  const ctx = useContext(ContainerContext);
  if (ctx === null) {
    throw new Error(
      'usePushNotificationService() called outside <ContainerProvider/>. Wrap your tree in <ContainerProvider/>.',
    );
  }
  return ctx.pushNotifications;
}

/**
 * Hook returning the Crashlytics seam (Phase 9 turn 3 sub-turn 3a).
 * Sibling of `useUseCases()` and the other SDK-seam hooks because the
 * lifecycle hook (`useCrashReportingLifecycle` — sub-turn 3b) and the
 * logger transport (`CrashlyticsLogTransport` — sub-turn 3a) both drive
 * the SDK directly rather than through a stateless use case.
 *
 * Throws if used outside of a ContainerProvider — same contract as
 * `useUseCases()`.
 *
 * Mounting rule:
 *   - The lifecycle hook (sub-turn 3b) consumes this once, mounted at
 *     AppContent. It calls `setCollectionEnabled(__DEV__ ? false : true)`
 *     on first mount, `setUserId(uid)` after auth resolves, and
 *     `setAttributes({role, env})` to tag reports for triage.
 *   - The logger transport setup (sub-turn 3a, run from the
 *     `<ContainerProvider/>` body itself) consumes this to attach the
 *     Crashlytics breadcrumb / non-fatal-error transport to the
 *     singleton `LOG`.
 *   - Screens and view-models DO NOT consume this directly.
 */
export function useCrashReporting(): Container['crashReporting'] {
  const ctx = useContext(ContainerContext);
  if (ctx === null) {
    throw new Error(
      'useCrashReporting() called outside <ContainerProvider/>. Wrap your tree in <ContainerProvider/>.',
    );
  }
  return ctx.crashReporting;
}
