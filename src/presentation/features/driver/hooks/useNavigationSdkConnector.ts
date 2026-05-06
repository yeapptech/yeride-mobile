import { useNavigation as useSdkNavigation } from '@googlemaps/react-native-navigation-sdk';
import { useEffect } from 'react';

import type { NavigationService } from '@domain/services';
import { useNavigationSdk } from '@presentation/di';
import { LOG } from '@shared/logger';

const logger = LOG.extend('NavConnector');

/**
 * Phase 8 turn 2 — single seam between the SDK's React-context-tied
 * `<NavigationProvider/>` and our class-based `NavigationSdkClient`
 * adapter.
 *
 * The SDK's primary surface is `<NavigationProvider/>` (mounted at App
 * root, see `src/presentation/App.tsx`) which mints a single shared
 * `NavigationController` + listener-setters bag and exposes them via
 * the SDK's `useNavigation()` context hook. Our adapter is class-based
 * (lives in the DI container) and can't call React hooks itself —
 * which is what the `setController({controller, listeners})` seam on
 * the adapter exists for.
 *
 * Mounting rule:
 *
 *   - Mount this hook on `DriverMonitorScreen`. It pushes the
 *     controller into the adapter as soon as DriverMonitor mounts —
 *     well before the driver taps "Open Navigation" — so the legacy
 *     "init in parent before push" pattern (avoids the
 *     `getCurrentActivity()` null inside `<NavigationView/>` quirk)
 *     works through the adapter rather than direct SDK access.
 *
 *   - Don't mount it at AppContent, and don't mount it on the
 *     navigation screen itself. AppContent is too broad (the
 *     controller would be pushed even for unauthenticated users +
 *     riders); the navigation screen is too narrow (init() needs to
 *     have already succeeded by the time `<NavigationView/>` is on
 *     screen).
 *
 *   - Concurrent mounts on multiple screens are tolerated by the
 *     adapter (re-applying the same listeners is idempotent), but the
 *     cleanest pattern is a single mount per session.
 *
 * Lifecycle:
 *
 *   1. Mount: read the SDK's shared `{navigationController,
 *      ...listenerSetters}` via `useSdkNavigation()`, push them into
 *      the adapter via `setController({controller, listeners})`.
 *   2. Unmount: push `setController({controller: null, listeners:
 *      null})` so subsequent adapter calls return
 *      `'navigation_sdk_not_connected'` until the next mount.
 *
 *   The cleanup is synchronous (React effect-cleanup contract). We
 *   deliberately do NOT call `navigationSdk.cleanup()` here — the
 *   navigation screen's view-model owns the
 *   `stopGuidance + cleanup` chain when the user taps End Navigation
 *   or auto-pops on arrival. Pushing `null` here just disconnects the
 *   adapter from the React-tied controller.
 */

type SdkNavigationContext = ReturnType<typeof useSdkNavigation>;

/**
 * Type alias for the navigation seam. The domain interface
 * `NavigationService` covers both the production adapter
 * (`NavigationSdkClient`) and the in-memory fake
 * (`FakeNavigationSdkClient`); both `implements` it.
 */
type NavSdk = NavigationService;

export function useNavigationSdkConnector(): void {
  const navigationSdk: NavSdk = useNavigationSdk();
  const sdkContext: SdkNavigationContext = useSdkNavigation();

  useEffect(() => {
    const { navigationController, ...listenerSetters } = sdkContext;
    // The listener setters bag has the exact `setOnArrival` shape our
    // adapter consumes; everything else (setOnRouteChanged,
    // setOnTrafficUpdated, …) is unused by the adapter today but
    // forwarded for forward-compat.
    navigationSdk.setController({
      controller: navigationController,
      listeners: listenerSetters,
    });
    logger.debug('controller pushed into adapter');

    return () => {
      navigationSdk.setController({ controller: null, listeners: null });
      logger.debug('controller cleared from adapter');
    };
  }, [navigationSdk, sdkContext]);
}
