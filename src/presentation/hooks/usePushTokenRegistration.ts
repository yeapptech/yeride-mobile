import { useCallback, useEffect, useRef } from 'react';

import type { PushPermissionStatus } from '@domain/entities/PushPermissionStatus';
import type { User } from '@domain/entities/User';
import { usePushNotificationService, useUseCases } from '@presentation/di';
import { useNotificationPermissionUiStore } from '@presentation/stores';
import { LOG } from '@shared/logger';

const logger = LOG.extend('PushTokenReg');

/**
 * Single owner of the push-notifications SDK lifecycle.
 *
 * **AppContent-only**. Mount this hook exactly once, at the very top of
 * the React tree, inside `AppContent.tsx`. Screens and view-models read
 * permission state via the `useNotificationPermissionStatus` selector;
 * they never reach into the SDK directly. The soft-ask sheet calls
 * `promptForPermission()` (returned from this hook) to fire the OS
 * prompt after the user accepts the in-app prompt.
 *
 * Responsibilities:
 *
 *   1. **One-shot Android channel setup.** First time the hook mounts,
 *      call `pushService.setupAndroidChannel()` (no-op on iOS).
 *      Required by Android 8+ before any notification can deliver.
 *      Idempotent — safe to call on every app launch.
 *
 *   2. **Permission status read + mirror.** On mount, read
 *      `pushService.getPermissionStatus()` and write the result to
 *      `useNotificationPermissionUiStore.permissionStatus` so the
 *      soft-ask sheet (and any future surface) can read a single
 *      source of truth without re-querying the SDK.
 *
 *   3. **Token registration on permission grant.** When `user` is
 *      signed in AND permission is `'granted'`, fire the
 *      `RegisterPushToken` use case. The use case is idempotent:
 *      if `user.pushToken` already matches the current token, no
 *      Firestore write happens (avoids `updatedAt` churn).
 *
 *   4. **Token-refresh subscription.** While mounted, subscribe to
 *      `pushService.subscribeToTokenChanges`. Each delivered event
 *      re-fires `RegisterPushToken`. FCM rotates tokens periodically;
 *      APNs rotates on app reinstall / device restore. The use case
 *      handles the dedup at the Firestore level.
 *
 *   5. **Soft-ask gate via `promptForPermission`.** Returned from
 *      the hook for the soft-ask sheet to call. Wraps
 *      `pushService.requestPermissions()` and pushes the result back
 *      into the UI store. Re-firing `RegisterPushToken` on
 *      `undetermined → granted` happens automatically via the
 *      registration effect (deps include the mirrored status).
 *
 *   6. **Synchronous cleanup.** React effect cleanup must be
 *      synchronous (no `async function` cleanup — React silently
 *      ignores it). The token subscription's `remove()` is a
 *      synchronous function provided by the adapter.
 *
 * What this hook is NOT:
 *   - The notification-tap handler. That belongs to a separate
 *     `useNotificationResponseHandler` hook (sub-turn 2c).
 *   - The soft-ask UI. The sheet itself is a separate component
 *     mounted at AppContent and reads from this hook + the
 *     `useNotificationPermissionUiStore`.
 *   - A token-write throttle. The use case's idempotency check is
 *     the throttle.
 *
 * Failure handling:
 *   - SDK channel setup or permission read failures are logged and
 *     ignored — the app can boot and function without push.
 *   - `RegisterPushToken` failures are logged. Common case:
 *     `push_get_token_failed` on simulators where APNs isn't
 *     registered. Not surfaced to the UI — the user gets push next
 *     time they launch on a real device.
 */
export function usePushTokenRegistration(user: User | null): {
  /**
   * Trigger the OS permission prompt and refresh the mirrored status.
   * Returns the post-prompt status. Soft-ask sheet calls this when
   * the user taps "Enable".
   *
   * If status is already resolved (granted or denied), the SDK
   * returns the existing status without re-prompting; the OS doesn't
   * surface a duplicate dialog.
   */
  promptForPermission: () => Promise<PushPermissionStatus>;
} {
  const pushService = usePushNotificationService();
  const useCases = useUseCases();
  const setPermissionStatus = useNotificationPermissionUiStore(
    (s) => s.setPermissionStatus,
  );
  // Read permission status as a separate selector so the registration
  // effect's deps include the latest value without re-binding the
  // setter every render (Zustand returns stable setter identities).
  const permissionStatus = useNotificationPermissionUiStore(
    (s) => s.permissionStatus,
  );

  const initializedRef = useRef(false);
  const userIdForLastRegistration = useRef<string | null>(null);

  // Effect 1: One-shot init (Android channel + permission status read).
  // Runs once per JS runtime — initializedRef guards against re-entry
  // on hot-reload.
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    void (async () => {
      const channelR = await pushService.setupAndroidChannel();
      if (!channelR.ok) {
        logger.warn('setupAndroidChannel failed', channelR.error);
      }
      const statusR = await pushService.getPermissionStatus();
      if (!statusR.ok) {
        logger.warn('getPermissionStatus failed', statusR.error);
        return;
      }
      setPermissionStatus(statusR.value);
    })();
  }, [pushService, setPermissionStatus]);

  // Effect 2: Token registration on user-resolved + granted.
  useEffect(() => {
    if (!user) {
      userIdForLastRegistration.current = null;
      return;
    }
    if (permissionStatus !== 'granted') return;

    const currentUserId = String(user.id);
    void (async () => {
      const r = await useCases.registerPushToken.execute();
      if (!r.ok) {
        logger.warn('RegisterPushToken failed', r.error);
        return;
      }
      userIdForLastRegistration.current = currentUserId;
      if (r.value.written) {
        logger.info('RegisterPushToken: token written to user doc', {
          userId: currentUserId,
        });
      } else {
        logger.debug('RegisterPushToken: skipped', {
          reason: r.value.skippedReason,
        });
      }
    })();
  }, [user, permissionStatus, useCases]);

  // Effect 3: Token-refresh subscription. Single SDK listener shared
  // for the lifetime of the hook (i.e. for the lifetime of the app
  // post-mount). Re-firing the use case on each refresh keeps the
  // user doc current.
  useEffect(() => {
    const unsubscribe = pushService.subscribeToTokenChanges(() => {
      // On every token-refresh delivery, re-fire the use case. It's
      // idempotent and self-validating (re-reads from
      // pushService.getCurrentToken so the token argument and the
      // doc-write are consistent).
      void (async () => {
        const r = await useCases.registerPushToken.execute();
        if (!r.ok) {
          logger.warn('RegisterPushToken (refresh) failed', r.error);
          return;
        }
        if (r.value.written) {
          logger.info('RegisterPushToken (refresh): token rotated');
        }
      })();
    });
    return unsubscribe;
  }, [pushService, useCases]);

  const promptForPermission =
    useCallback(async (): Promise<PushPermissionStatus> => {
      const r = await pushService.requestPermissions();
      if (!r.ok) {
        logger.warn('requestPermissions failed', r.error);
        // Re-read the OS state — a request failure may still leave
        // the OS in a known state (e.g. previously-denied).
        const fallbackR = await pushService.getPermissionStatus();
        const status = fallbackR.ok ? fallbackR.value : 'undetermined';
        setPermissionStatus(status);
        return status;
      }
      setPermissionStatus(r.value);
      return r.value;
    }, [pushService, setPermissionStatus]);

  return { promptForPermission };
}
