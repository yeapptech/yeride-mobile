import type { PushToken } from '@domain/entities/PushToken';
import { setPushToken } from '@domain/entities/User';
import {
  AuthorizationError,
  type NetworkError,
  type NotFoundError,
  type ValidationError,
} from '@domain/errors';
import type { AuthRepository, UserRepository } from '@domain/repositories';
import type { PushNotificationService } from '@domain/services';
import { Result } from '@domain/shared/Result';

/**
 * Result of `RegisterPushToken.execute()`. Encodes both the resolved
 * token (or null) and whether the use case wrote to Firestore — useful
 * for the presentation hook's logging / metrics, and for tests.
 */
export interface RegisterPushTokenOutcome {
  readonly token: PushToken | null;
  /** True iff the use case wrote a fresh token to the user doc. */
  readonly written: boolean;
  /** Why the use case didn't write, when `written === false`. */
  readonly skippedReason:
    | 'no_change' // user.pushToken already matches current token
    | 'no_token' // SDK couldn't mint a token (no permission, simulator, etc.)
    | null;
}

/**
 * Read the device's current push token from the SDK and persist it on
 * the signed-in user's doc. Idempotent: if `user.pushToken` already
 * matches the current token, the use case skips the write to avoid
 * churning `updatedAt` (and consequently invalidating user-doc caches).
 *
 * Designed to be called:
 *
 *   - On app start, after auth resolves AND permission status is
 *     `'granted'`. The presentation hook
 *     `usePushTokenRegistration` (sub-turn 2b) drives this.
 *
 *   - On every token-refresh event from
 *     `pushService.subscribeToTokenChanges`. FCM rotates tokens
 *     periodically; APNs rotates on app reinstall / device restore.
 *
 *   - After a permission flip from undetermined → granted (e.g. user
 *     accepts the OS prompt that the soft-ask sheet triggered).
 *
 * Auth: caller must be signed in. The use case reads the current user
 * id from `AuthRepository`; callers don't pass it.
 *
 * Token-not-yet-available is a non-error: the use case returns
 * `Result.ok({token: null, written: false, skippedReason: 'no_token'})`
 * so the caller can log + retry on next launch without raising.
 *
 * Failure modes:
 *   - `AuthorizationError`           — no signed-in user.
 *   - `NotFoundError`                — user doc is missing.
 *   - `NetworkError` / `ValidationError` — bubbled from the push service
 *     adapter (e.g. malformed token shape) or the user-repo update.
 */
export class RegisterPushToken {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly pushService: PushNotificationService,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<
    Result<
      RegisterPushTokenOutcome,
      AuthorizationError | NotFoundError | NetworkError | ValidationError
    >
  > {
    const uid = await this.auth.currentUserId();
    if (!uid) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_no_current_user',
          message: 'No user is signed in — cannot register a push token',
        }),
      );
    }

    const tokenR = await this.pushService.getCurrentToken();
    if (!tokenR.ok) {
      // Adapter-level failures (no APNs registration, no EAS projectId,
      // SDK throw) — bubble for the caller to log. The caller (the
      // presentation hook) will degrade gracefully and retry on the
      // next launch.
      return tokenR;
    }
    const currentToken = tokenR.value;

    if (currentToken === null) {
      // Adapter resolved cleanly but the device has no token yet (e.g.
      // permission revoked between OS-prompt-grant and SDK call). Soft
      // skip — return a structured outcome so the caller can decide
      // whether to retry / clear the on-disk token.
      return Result.ok({
        token: null,
        written: false,
        skippedReason: 'no_token',
      });
    }

    const userR = await this.users.getById(uid);
    if (!userR.ok) return userR;
    const user = userR.value;

    // Idempotency: skip the write when the existing token matches.
    // `PushToken` is a branded string, and the brand strips on `===`,
    // so identity-by-value works.
    if (user.pushToken === currentToken) {
      return Result.ok({
        token: currentToken,
        written: false,
        skippedReason: 'no_change',
      });
    }

    const updated = setPushToken(user, currentToken, this.clock());
    const persistedR = await this.users.update(updated);
    if (!persistedR.ok) return persistedR;

    return Result.ok({
      token: currentToken,
      written: true,
      skippedReason: null,
    });
  }
}
