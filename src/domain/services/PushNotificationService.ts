import type { PushPermissionStatus } from '../entities/PushPermissionStatus';
import type { PushToken } from '../entities/PushToken';
import type { RideId } from '../entities/RideId';
import type {
  AuthorizationError,
  NetworkError,
  ValidationError,
} from '../errors';
import type { Result } from '../shared/Result';

/**
 * Abstraction over `expo-notifications`. The data layer's
 * `ExpoNotificationsAdapter` (Phase 9 turn 2 sub-turn 2b) speaks the SDK
 * directly; the domain interface keeps presentation (`usePushTokenRegistration`,
 * `useNotificationResponseHandler`) and use cases
 * (`RegisterPushToken`, `HandleNotificationResponse`) free of SDK imports.
 *
 * Why an adapter instead of importing `expo-notifications` directly:
 *
 *   - The SDK API mixes async (`getExpoPushTokenAsync`,
 *     `requestPermissionsAsync`) with sync subscription registration
 *     (`addNotificationResponseReceivedListener`). Wrapping it in a
 *     `Result`-returning facade keeps consumers in the project's
 *     "no expected throws" pattern.
 *
 *   - The token shape (Expo wrapped vs. raw FCM/APNs) is a domain concern;
 *     the SDK exposes both `getExpoPushTokenAsync` (Expo wrapped) and
 *     `getDevicePushTokenAsync` (raw native). The adapter hides that
 *     choice — Phase 9 turn 2 picks Expo wrapped to match legacy yeride's
 *     `users/{uid}.pushToken` shape exactly (the deployed
 *     `yeride-functions/lib/notifications.js`'s `sendNotification` is
 *     shape-agnostic via `Expo.isExpoPushToken()`, but staying with Expo
 *     wrapped means no Cloud Function changes are required).
 *
 *   - The OS permission flow has platform-specific quirks (Android needs
 *     a notification channel created BEFORE permission request; iOS has
 *     a sticky-deny state that requires Settings to flip). Encoding the
 *     differences in the adapter, not the use case.
 *
 * Subscription methods follow the project convention: synchronous
 * unsubscribe (no async cleanup — React's effect-cleanup contract requires
 * sync). The returned function is the unsubscribe; calling it twice is
 * a no-op.
 *
 * Error mapping at the boundary:
 *
 *   - SDK throw on permission / token / channel ops →
 *     `NetworkError` with `cause` carrying the original.
 *   - SDK reports the user as "denied" → returned as
 *     `Result.ok('denied')` (NOT an error — the user is allowed to say
 *     no; the use case decides whether to surface a soft-ask).
 *   - SDK reports a permission state that doesn't fit the domain enum
 *     (e.g. `provisional`) → collapsed to `'granted'` at the adapter
 *     boundary (kickoff decision: domain stays a 3-arm union).
 */

/**
 * The data payload sent inside a notification. Cloud Functions write a
 * `{type, tripId}` shape (sometimes with extras like `tipAmount`); the
 * tap-handler use case `HandleNotificationResponse` parses this into a
 * `NavigationIntent`. The domain interface keeps the type permissive
 * because notifications can carry whatever the server decides; the
 * use case does the structural validation.
 */
export interface NotificationData {
  readonly [key: string]: unknown;
}

/**
 * One delivery from the SDK, normalized to a domain shape. `data` carries
 * the Cloud Function payload; `title` / `body` are presentational only
 * (we don't render an in-app banner in Phase 9 turn 2 — those fields are
 * forwarded through for future surfaces).
 */
export interface NotificationResponse {
  readonly title: string | null;
  readonly body: string | null;
  readonly data: NotificationData;
  /** When the notification was delivered (clock-skew tolerant). */
  readonly receivedAt: Date;
}

/**
 * Tap-handler routing target. `HandleNotificationResponse` returns this
 * domain shape; the presentation hook
 * `useNotificationResponseHandler` translates it into an actual
 * `navigationRef.navigate(...)` call.
 *
 * The target enum mirrors the Cloud Functions `data.type` codes from
 * `yeride-functions/handlers/{trip-event-created,trip-created,scheduled-notification,tip-driver}.js`:
 *
 *   - `'rider_ride_monitor'` — `driver_dispatched`, `driver_pickup_arrived`,
 *     `payment_failed`, `scheduled_driver_accepted`, `pickup_reminder`
 *   - `'rider_ride_receipt'` — `payment_succeeded`
 *   - `'driver_dispatch'`    — `awaiting_driver`, `scheduled`
 *   - `'driver_earnings'`    — `tip_succeeded`
 *
 * `'unknown'` covers any payload that doesn't match a routing rule (e.g.
 * a future `data.type` the rewrite hasn't taught itself yet — surfaces
 * as a no-op tap rather than a crash).
 */
export type NavigationIntent =
  | { readonly target: 'rider_ride_monitor'; readonly rideId: RideId }
  | { readonly target: 'rider_ride_receipt'; readonly rideId: RideId }
  | { readonly target: 'driver_dispatch'; readonly rideId: RideId }
  | { readonly target: 'driver_earnings' }
  | { readonly target: 'unknown' };

export interface PushNotificationService {
  /**
   * Read the current OS permission status WITHOUT prompting. Idempotent
   * and side-effect-free.
   */
  getPermissionStatus(): Promise<
    Result<PushPermissionStatus, NetworkError | AuthorizationError>
  >;

  /**
   * Show the OS permission prompt if status is `'undetermined'`. If
   * status is already resolved, returns the existing status without
   * prompting. The presentation layer is expected to render a soft-ask
   * UX BEFORE calling this — once the OS prompt fires and the user
   * denies, iOS makes re-prompting impossible without a Settings flip.
   */
  requestPermissions(): Promise<
    Result<PushPermissionStatus, NetworkError | AuthorizationError>
  >;

  /**
   * Read the current device's push token. Returns `null` if the device
   * doesn't have a token yet (e.g. permission denied, simulator without
   * APNs setup). Returns `ValidationError` only for shape failures
   * (the SDK returned a string the `PushToken` value object rejects).
   *
   * Implementation note: Phase 9 turn 2 calls
   * `Notifications.getExpoPushTokenAsync({projectId})` — Expo wrapped
   * format, matches legacy yeride's on-disk shape.
   */
  getCurrentToken(): Promise<
    Result<
      PushToken | null,
      NetworkError | AuthorizationError | ValidationError
    >
  >;

  /**
   * Subscribe to token-refresh events. FCM rotates tokens periodically;
   * APNs rotates on app reinstall / device restore. The callback fires
   * with the new token (or `null` on revocation).
   *
   * Returns a synchronous unsubscribe. `useGpsLifecycle`-style contract:
   * calling the unsubscribe twice is a no-op; React's effect cleanup
   * is allowed to discard the function reference.
   */
  subscribeToTokenChanges(
    callback: (token: PushToken | null) => void,
  ): () => void;

  /**
   * Subscribe to notification taps (the user opens a notification while
   * the app is in foreground OR background). `useNotificationResponseHandler`
   * is the sole consumer.
   *
   * Cold-start taps (the app was killed when the user tapped the
   * notification) are NOT delivered through this subscription —
   * use `getLastNotificationResponse()` once on AppContent mount for
   * that path.
   *
   * Synchronous unsubscribe.
   */
  subscribeToNotificationResponse(
    callback: (response: NotificationResponse) => void,
  ): () => void;

  /**
   * Read the most recent notification response captured before the
   * subscription was attached. Used at app boot for cold-start tap
   * routing — the SDK buffers exactly one response (the one that
   * actually launched the app). Returns `null` if the app was opened
   * normally (not via a notification tap).
   */
  getLastNotificationResponse(): Promise<
    Result<NotificationResponse | null, NetworkError>
  >;

  /**
   * Configure the Android default notification channel. Android 8+
   * requires a channel registration BEFORE the first notification
   * delivers; without it, the OS silently drops the message.
   *
   * On iOS this is a no-op (returns `Result.ok(undefined)` immediately
   * — channels are an Android-only concept). Idempotent: safe to call
   * on every app launch.
   */
  setupAndroidChannel(): Promise<Result<void, NetworkError>>;
}
