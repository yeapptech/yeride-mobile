import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { PushPermissionStatus } from '@domain/entities/PushPermissionStatus';
import { PushToken } from '@domain/entities/PushToken';
import {
  AuthorizationError,
  NetworkError,
  type ValidationError,
} from '@domain/errors';
import type {
  NotificationData,
  NotificationResponse,
  PushNotificationService,
} from '@domain/services';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

const logger = LOG.extend('Notifications');

/**
 * Single seam between the rewrite and `expo-notifications`.
 *
 * Why an adapter instead of importing `expo-notifications` directly:
 *
 *   - The SDK API is callback-flavored (`addPushTokenListener`,
 *     `addNotificationResponseReceivedListener`) and async-flavored
 *     (`getExpoPushTokenAsync`, `requestPermissionsAsync`). Wrapping
 *     it in a domain-shaped facade keeps `usePushTokenRegistration`
 *     and the use cases (`RegisterPushToken`,
 *     `HandleNotificationResponse`) thin and SDK-agnostic.
 *
 *   - The SDK throws on permission denial in some platform/version
 *     combinations and resolves with `{status: 'denied'}` in others.
 *     This adapter normalizes both into `Result.ok('denied')` (the
 *     domain treats "user said no" as a valid outcome, not an error).
 *
 *   - Token shape (Expo wrapped vs. raw FCM/APNs) is a domain concern.
 *     Phase 9 turn 2 picks Expo wrapped to match legacy yeride's
 *     `users/{uid}.pushToken` shape exactly. The deployed
 *     `yeride-functions/lib/notifications.js`'s `sendNotification` is
 *     shape-agnostic via `Expo.isExpoPushToken()`, so the rewrite can
 *     plug in alongside legacy without server changes.
 *
 * Project id resolution:
 *
 *   `getExpoPushTokenAsync({projectId})` requires the EAS project id.
 *   We read it from `Constants.expoConfig?.extra?.eas?.projectId`,
 *   which is set in `app.config.ts.extra.eas.projectId`. If the field
 *   is missing (e.g. dev build before EAS project linkage), the
 *   adapter returns `Result.err(NetworkError({code: 'no_eas_project_id'}))`
 *   from `getCurrentToken` rather than crashing — the use case logs
 *   loudly and skips the write.
 *
 * Listener semantics:
 *
 *   - `subscribeToTokenChanges` and `subscribeToNotificationResponse`
 *     return synchronous unsubscribe functions (calling twice is a
 *     no-op). This matches the project's React-effect-cleanup
 *     contract.
 *
 *   - `addNotificationResponseReceivedListener` does NOT fire for
 *     cold-start taps (the app was killed when the user tapped the
 *     notification). For that, use `getLastNotificationResponse()`
 *     once on AppContent mount; the SDK buffers exactly one response
 *     (the launching tap).
 *
 * Android channel:
 *
 *   `setupAndroidChannel()` registers a single `'default'` channel
 *   with MAX importance — Android 8+ requires a channel registration
 *   BEFORE the first notification delivers, or the OS silently drops
 *   the message. iOS has no concept of channels, so we no-op there.
 *
 *   The channel id `'default'` matches what the deployed Cloud
 *   Functions implicitly target (FCM's default channel). A future
 *   phase can add per-trip / per-event channels if user-controlled
 *   importance becomes a thing.
 *
 * Error mapping at the boundary:
 *
 *   - SDK throw on `getExpoPushTokenAsync` / `setNotificationChannelAsync`
 *     → `NetworkError` with `cause` carrying the original. The
 *     "device hasn't registered with APNs/FCM yet" error code from
 *     `getExpoPushTokenAsync` is a frequent offender on simulators
 *     and offline devices.
 *
 *   - SDK throw on `requestPermissionsAsync` / `getPermissionsAsync`
 *     → `AuthorizationError`. This is rare in practice; the SDK
 *     usually resolves with `{status: 'denied'}` instead.
 *
 *   - SDK returns a token string the `PushToken` value object
 *     rejects (shape failure) → `ValidationError`. This is mostly a
 *     defensive code path; the SDK's contract guarantees the wrapped
 *     `ExponentPushToken[...]` format.
 */

/* ───── Helpers ───── */

function readEasProjectId(): string | null {
  const Constants = require('expo-constants') as {
    default?: {
      expoConfig?: {
        extra?: {
          eas?: { projectId?: string };
        };
      };
    };
  };
  const id = Constants.default?.expoConfig?.extra?.eas?.projectId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Normalize the SDK's permission-status enum into the domain's 3-arm
 * union. iOS's `provisional` (delivered-quiet without prompt) is
 * collapsed to `'granted'` per the kickoff decision (domain stays
 * small).
 */
function mapPermissionStatus(raw: string): PushPermissionStatus {
  switch (raw) {
    case 'granted':
    case 'provisional': // iOS: delivered-quiet, treat as granted
      return 'granted';
    case 'denied':
      return 'denied';
    case 'undetermined':
    default:
      return 'undetermined';
  }
}

/* ───── Adapter ───── */

export class ExpoNotificationsAdapter implements PushNotificationService {
  /** Most-recent token from `addPushTokenListener` — used for dedup so
   *  consecutive identical refresh deliveries don't churn user-doc writes. */
  private lastTokenString: string | null = null;

  /** Single underlying SDK push-token listener, shared by all subscribers. */
  private tokenCallbacks = new Set<(token: PushToken | null) => void>();
  private tokenSubscription: { remove: () => void } | null = null;

  /** Single underlying SDK notification-response listener, shared by all subscribers. */
  private responseCallbacks = new Set<(r: NotificationResponse) => void>();
  private responseSubscription: { remove: () => void } | null = null;

  async getPermissionStatus(): Promise<
    Result<PushPermissionStatus, NetworkError | AuthorizationError>
  > {
    try {
      const r = await Notifications.getPermissionsAsync();
      return Result.ok(mapPermissionStatus(r.status));
    } catch (e) {
      logger.error('getPermissionStatus failed', e);
      return Result.err(
        new AuthorizationError({
          code: 'push_get_permission_failed',
          message: 'expo-notifications threw while reading permission status',
          cause: e instanceof Error ? e : undefined,
        }),
      );
    }
  }

  async requestPermissions(): Promise<
    Result<PushPermissionStatus, NetworkError | AuthorizationError>
  > {
    try {
      const r = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
          // `allowAnnouncements` was deprecated in iOS 15+ and dropped
          // from the typed surface in expo-notifications SDK 55. Same
          // for `provisional` — replaced by `allowProvisional` (defaults
          // to false, which is what we want — we never want quiet
          // delivery; ride alerts are time-critical).
        },
      });
      return Result.ok(mapPermissionStatus(r.status));
    } catch (e) {
      logger.error('requestPermissions failed', e);
      return Result.err(
        new AuthorizationError({
          code: 'push_request_permission_failed',
          message: 'expo-notifications threw while requesting permission',
          cause: e instanceof Error ? e : undefined,
        }),
      );
    }
  }

  async getCurrentToken(): Promise<
    Result<
      PushToken | null,
      NetworkError | AuthorizationError | ValidationError
    >
  > {
    const projectId = readEasProjectId();
    if (projectId === null) {
      logger.warn(
        'getCurrentToken: no EAS projectId in extra.eas.projectId — ' +
          'cannot mint Expo push token. Set Constants.expoConfig.extra.eas.projectId.',
      );
      return Result.err(
        new NetworkError({
          code: 'push_no_eas_project_id',
          message:
            'EAS project id is missing — cannot request an Expo push token',
        }),
      );
    }
    try {
      const result = await Notifications.getExpoPushTokenAsync({ projectId });
      const tokenR = PushToken.create(result.data);
      if (!tokenR.ok) {
        logger.error('getCurrentToken: SDK returned malformed token', {
          code: tokenR.error.code,
        });
        return Result.err(tokenR.error);
      }
      this.lastTokenString = result.data;
      return Result.ok(tokenR.value);
    } catch (e) {
      // Common case: simulator / no APNs / offline. SDK throws with code
      // ERR_NOTIFICATIONS_NETWORK_ERROR or similar. Surface as
      // NetworkError so the caller can retry on next launch.
      logger.warn('getCurrentToken: SDK threw — degrading to null', e);
      return Result.err(
        new NetworkError({
          code: 'push_get_token_failed',
          message:
            'expo-notifications failed to mint a push token (simulator, ' +
            'no APNs/FCM, or offline)',
          cause: e instanceof Error ? e : undefined,
        }),
      );
    }
  }

  subscribeToTokenChanges(
    callback: (token: PushToken | null) => void,
  ): () => void {
    this.tokenCallbacks.add(callback);
    if (this.tokenSubscription === null) {
      this.tokenSubscription = Notifications.addPushTokenListener((event) => {
        // SDK delivers raw token string in `event.data`. Validate via
        // PushToken.create — if it fails, log + emit null so subscribers
        // can clear their stored value rather than holding a stale token.
        const raw = event.data;
        if (raw === this.lastTokenString) return; // dedup
        this.lastTokenString = raw;
        const tokenR = PushToken.create(raw);
        if (!tokenR.ok) {
          logger.warn('addPushTokenListener: malformed token, emitting null', {
            code: tokenR.error.code,
          });
          for (const cb of [...this.tokenCallbacks]) cb(null);
          return;
        }
        for (const cb of [...this.tokenCallbacks]) cb(tokenR.value);
      });
    }
    return () => {
      const removed = this.tokenCallbacks.delete(callback);
      if (!removed) return;
      // Tear down the underlying SDK subscription when the last
      // domain subscriber disconnects, so we don't leak a permanent
      // SDK listener across sign-out / sign-in.
      if (this.tokenCallbacks.size === 0 && this.tokenSubscription !== null) {
        this.tokenSubscription.remove();
        this.tokenSubscription = null;
        this.lastTokenString = null;
      }
    };
  }

  subscribeToNotificationResponse(
    callback: (response: NotificationResponse) => void,
  ): () => void {
    this.responseCallbacks.add(callback);
    if (this.responseSubscription === null) {
      this.responseSubscription =
        Notifications.addNotificationResponseReceivedListener((event) => {
          const normalized = normalizeResponse(event);
          for (const cb of [...this.responseCallbacks]) cb(normalized);
        });
    }
    return () => {
      const removed = this.responseCallbacks.delete(callback);
      if (!removed) return;
      if (
        this.responseCallbacks.size === 0 &&
        this.responseSubscription !== null
      ) {
        this.responseSubscription.remove();
        this.responseSubscription = null;
      }
    };
  }

  async getLastNotificationResponse(): Promise<
    Result<NotificationResponse | null, NetworkError>
  > {
    try {
      const raw = await Notifications.getLastNotificationResponseAsync();
      if (raw === null) return Result.ok(null);
      return Result.ok(normalizeResponse(raw));
    } catch (e) {
      logger.error('getLastNotificationResponse failed', e);
      return Result.err(
        new NetworkError({
          code: 'push_get_last_response_failed',
          message:
            'expo-notifications threw while reading the cold-start tap response',
          cause: e instanceof Error ? e : undefined,
        }),
      );
    }
  }

  async setupAndroidChannel(): Promise<Result<void, NetworkError>> {
    if (Platform.OS !== 'android') {
      return Result.ok(undefined);
    }
    try {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'YeRide Notifications',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
      return Result.ok(undefined);
    } catch (e) {
      logger.error('setupAndroidChannel failed', e);
      return Result.err(
        new NetworkError({
          code: 'push_channel_setup_failed',
          message:
            'expo-notifications failed to register the default Android channel',
          cause: e instanceof Error ? e : undefined,
        }),
      );
    }
  }
}

/**
 * Convert the SDK's `NotificationResponse` shape into the domain's
 * `NotificationResponse`. The SDK shape is:
 *
 *   {
 *     notification: {
 *       date: number,
 *       request: {
 *         content: { title, body, data, ... },
 *         trigger: { type, ... },
 *         identifier: string,
 *       }
 *     },
 *     actionIdentifier: string,
 *     userText?: string,
 *   }
 *
 * We project just the fields the domain cares about.
 */
function normalizeResponse(raw: unknown): NotificationResponse {
  const safeData: NotificationData = {};
  let title: string | null = null;
  let body: string | null = null;
  let dateMs = Date.now();
  if (raw !== null && typeof raw === 'object') {
    const r = raw as {
      notification?: {
        date?: number;
        request?: {
          content?: {
            title?: string | null;
            body?: string | null;
            data?: NotificationData;
          };
        };
      };
    };
    const content = r.notification?.request?.content ?? {};
    title = typeof content.title === 'string' ? content.title : null;
    body = typeof content.body === 'string' ? content.body : null;
    if (content.data && typeof content.data === 'object') {
      Object.assign(safeData, content.data);
    }
    if (typeof r.notification?.date === 'number') {
      dateMs = r.notification.date;
    }
  }
  return {
    title,
    body,
    data: safeData,
    receivedAt: new Date(dateMs),
  };
}
