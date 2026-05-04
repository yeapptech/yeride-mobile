import { useCallback } from 'react';
import { Linking } from 'react-native';

import { LOG } from '@shared/logger';

const logger = LOG.extend('OpenSettings');

/**
 * Returns a stable callback that opens the host OS's app-settings page
 * for the current app. Wraps `Linking.openSettings()` so:
 *
 *   - Tests mock at one well-known seam
 *     (`jest.spyOn(Linking, 'openSettings')`) instead of every call
 *     site.
 *   - The async/Promise plumbing stays out of consumer code — the
 *     returned callback is `() => void`, fire-and-forget. We log on
 *     rejection but don't surface the failure to the user; the only
 *     plausible failure modes (Linking unavailable, OS denied the
 *     deep-link) aren't actionable mid-tap.
 *
 * Used by Phase 9 turn 10's `<PermissionDeniedBanner/>` and any future
 * surface that needs to escort the user to OS Settings (notification-
 * permission recovery is the obvious next consumer — see
 * `<NotificationPermissionSheet/>`'s "Not now" branch).
 *
 * `Linking.openSettings()` works on both iOS and Android out of the
 * box — no permission strings, no plugin changes, no native rebuild.
 * On iOS it opens the app's Settings page; on Android it opens the
 * app's per-app settings activity. A more granular deep-link to a
 * specific Settings sub-pane is iOS-only and brittle across versions
 * (kickoff scope-out).
 */
export function useOpenSettings(): () => void {
  return useCallback(() => {
    Linking.openSettings().catch((e: unknown) => {
      // Best-effort. The user can navigate to Settings manually if the
      // deep-link fails, and there's nothing actionable to surface
      // mid-tap.
      logger.warn('Linking.openSettings failed', e);
    });
  }, []);
}
