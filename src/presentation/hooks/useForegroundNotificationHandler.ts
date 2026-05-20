import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';

import { useChatUiStore } from '@presentation/stores';
import { LOG } from '@shared/logger';

type NotificationBehavior = Notifications.NotificationBehavior;

const logger = LOG.extend('ForegroundNotif');

/**
 * Register a single `expo-notifications` foreground handler that
 * decides whether to show an OS-level banner / sound / list entry
 * when a push arrives while the app is foregrounded.
 *
 * Rules (Phase 10 turn 8):
 *   - `chat_message` push for the currently-open chat thread (the
 *     thread whose `tripId` matches `useChatUiStore.openRideId`) is
 *     SUPPRESSED — banner, sound, list, badge all off. The user is
 *     already looking at the thread; an OS banner would be redundant
 *     and annoying.
 *   - Every other push (including `chat_message` for a different
 *     trip, dispatch notifications, payment receipts, etc.) shows
 *     the banner + list + sound. Badge stays off (rewrite parity
 *     with legacy `yeride/AppContent.js:45-69`).
 *
 * The handler is registered ONCE per app lifetime via
 * `Notifications.setNotificationHandler`. Re-registering on every
 * mount would replace the previous handler, which is harmless but
 * wasteful. The hook fires the registration in a `useEffect` that
 * runs once at mount and never re-fires.
 *
 * The handler reads `useChatUiStore.getState().openRideId` lazily on
 * every push delivery — the Zustand store is a module-scoped
 * singleton so the read sees the current value without any
 * subscription wiring inside the handler itself.
 *
 * Note: the SDK 53+ surface uses `shouldShowBanner` / `shouldShowList`
 * (the deprecated `shouldShowAlert` is gone). Pre-checklist item 6
 * confirmed legacy `yeride/AppContent.js:55-66` uses the same names —
 * Expo SDK 55 contract.
 */
export function useForegroundNotificationHandler(): void {
  useEffect(() => {
    // `expo-notifications` is statically imported at module top —
    // sibling hooks (`usePushTokenRegistration`) already do the same,
    // and the jest manual mock for the package covers any unit-test
    // surface that imports this file transitively.

    const showBehavior: NotificationBehavior = {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    };
    const suppressBehavior: NotificationBehavior = {
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    };

    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        try {
          const data = notification.request.content.data as
            | { type?: string; tripId?: string }
            | null
            | undefined;
          if (data?.type === 'chat_message' && data.tripId !== undefined) {
            const openRideId = useChatUiStore.getState().openRideId;
            if (
              openRideId !== null &&
              String(openRideId) === String(data.tripId)
            ) {
              return suppressBehavior;
            }
          }
        } catch (e) {
          // Defensive — handler errors silently swallow the notification
          // otherwise. Surface as a warn so the breadcrumb captures it
          // (cleanup-best-effort path; not Crashlytics-worthy).
          logger.warn('foreground handler error', e);
        }
        return showBehavior;
      },
    });
    // setNotificationHandler returns void and is a single global
    // singleton — no cleanup to wire. If the hook unmounts we leave
    // the handler in place; mounting it again will replace it.
  }, []);
}
