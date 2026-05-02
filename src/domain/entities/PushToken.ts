import { ValidationError } from '../errors/ValidationError';
import { brand, type Brand } from '../shared/Brand';
import { Result } from '../shared/Result';

/**
 * A push-notification delivery token addressing one device. Branded so a
 * raw `string` cannot accidentally land in `User.pushToken` without going
 * through validation.
 *
 * Two on-the-wire formats are accepted:
 *
 *   1. **Expo wrapped** — `ExponentPushToken[<opaque body>]`. Issued by
 *      `Notifications.getExpoPushTokenAsync({projectId})`. Routes through
 *      Expo's push API server-side. This is the format legacy yeride
 *      writes, and the format the rewrite emits in Phase 9 turn 2 (see
 *      `docs/PHASE_9_TURN_2.md` — the deployed `lib/notifications.js`
 *      `sendNotification()` is shape-agnostic via `Expo.isExpoPushToken()`,
 *      so emitting Expo tokens stays compatible without server changes).
 *
 *   2. **Raw FCM / APNs** — opaque base64-ish blob from
 *      `Notifications.getDevicePushTokenAsync()`. Routes through FCM via
 *      `admin.messaging().send()` server-side. Accepted defensively so a
 *      future swap to native tokens (e.g. for iOS critical alerts) doesn't
 *      need a domain-level change.
 *
 * Validation rules:
 *
 *   - Non-empty string, ≤ 1000 characters (FCM tokens are typically
 *     150-300 chars; the cap is generous).
 *   - Either matches `^ExponentPushToken\[.+\]$` (Expo-wrapped) OR
 *     matches `^[A-Za-z0-9:_\-/+=]+$` (raw FCM / APNs token character
 *     set; FCM uses `:` as a section separator, APNs uses `+`/`=`).
 *
 * Reject reasons (all at the `ValidationError` boundary):
 *
 *   - `push_token_not_a_string`
 *   - `push_token_empty`
 *   - `push_token_too_long`
 *   - `push_token_invalid_format`
 */

export type PushToken = Brand<string, 'PushToken'>;

const MAX_LEN = 1000;
const EXPO_REGEX = /^ExponentPushToken\[.+\]$/;
const RAW_FCM_REGEX = /^[A-Za-z0-9:_\-/+=]+$/;

export const PushToken = {
  create(value: string): Result<PushToken, ValidationError> {
    if (typeof value !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'push_token_not_a_string',
          message: 'PushToken must be a string',
          field: 'pushToken',
        }),
      );
    }
    if (value.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'push_token_empty',
          message: 'PushToken must be non-empty',
          field: 'pushToken',
        }),
      );
    }
    if (value.length > MAX_LEN) {
      return Result.err(
        new ValidationError({
          code: 'push_token_too_long',
          message: `PushToken must be ≤ ${MAX_LEN} characters (got ${value.length})`,
          field: 'pushToken',
        }),
      );
    }
    if (!EXPO_REGEX.test(value) && !RAW_FCM_REGEX.test(value)) {
      return Result.err(
        new ValidationError({
          code: 'push_token_invalid_format',
          message:
            'PushToken must be either an Expo wrapped token (ExponentPushToken[...]) ' +
            'or a raw FCM/APNs token (alphanumeric + : _ - / + = characters)',
          field: 'pushToken',
        }),
      );
    }
    return Result.ok(brand<string, 'PushToken'>(value));
  },

  /** True when the token is Expo's wrapped format. Used at the data layer to
   *  decide which delivery path the server should pick (Expo's API vs FCM
   *  admin SDK) — though in practice the deployed `lib/notifications.js`
   *  re-checks via `Expo.isExpoPushToken()`. Exposed for tests + observability. */
  isExpoWrapped(token: PushToken): boolean {
    return EXPO_REGEX.test(token);
  },
};
