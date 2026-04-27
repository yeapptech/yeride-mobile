import type { Email } from '../entities/Email';
import type { Role } from '../entities/Role';
import type { UserId } from '../entities/UserId';
import type {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../errors';
import type { Result } from '../shared/Result';

/**
 * Abstraction over the authentication subsystem (Firebase Auth in production,
 * in-memory in tests). Domain code talks only to this interface; the data
 * layer provides the concrete adapter.
 *
 * Method conventions:
 *   - All operations that can fail in expected ways return
 *     `Result<T, DomainError>` and never throw.
 *   - Programming errors (network catastrophes, broken SDK state) still throw.
 *   - `currentUserId()` returns the locally-cached auth state and may be
 *     `null` when no user is signed in. The presentation layer subscribes to
 *     `observeAuthState` for live updates.
 */
export interface AuthRepository {
  /**
   * Create a new Firebase Auth account. Returns the new user's UID. On
   * success, the caller is responsible for creating the matching Firestore
   * user document via UserRepository.create.
   *
   * Error codes the data adapter is expected to surface:
   *   - 'auth_email_already_in_use'   → ConflictError
   *   - 'auth_invalid_email'          → ValidationError
   *   - 'auth_weak_password'          → ValidationError
   */
  signUp(args: {
    email: Email;
    password: string;
  }): Promise<Result<UserId, ValidationError | ConflictError>>;

  /**
   * Sign an existing user in. Returns the UID on success.
   *
   * Error codes:
   *   - 'auth_user_not_found'         → NotFoundError
   *   - 'auth_wrong_password'         → AuthorizationError
   *   - 'auth_user_disabled'          → AuthorizationError
   */
  signIn(args: {
    email: Email;
    password: string;
  }): Promise<
    Result<UserId, NotFoundError | AuthorizationError | ValidationError>
  >;

  /** Sign out the current user. Idempotent. */
  signOut(): Promise<Result<true, never>>;

  /**
   * The currently-signed-in user's UID, or null if no user is signed in. This
   * is the *cached* value — synchronous on the underlying SDK but exposed as
   * a Promise for adapter flexibility.
   */
  currentUserId(): Promise<UserId | null>;

  /**
   * Observe auth state changes. Calls back with the new auth state (or null on
   * sign out) whenever the underlying auth subsystem reports a change. Returns
   * an unsubscribe function — must be synchronous to satisfy React's effect
   * cleanup contract.
   *
   * The `emailVerified` field lets the presentation layer route an unverified
   * user to `EmailVerificationScreen` rather than the main app — see the
   * 'needs-verification' branch in `useSessionStore` and `RootNavigator`.
   *
   * Note: Firebase Auth's `onAuthStateChanged` does NOT re-fire when
   * `emailVerified` flips on the same user (e.g. after `user.reload()`). The
   * presentation layer must explicitly nudge the session store after
   * `isCurrentEmailVerified()` returns `true` for the verification poll —
   * see `useEmailVerificationViewModel`.
   */
  observeAuthState(
    callback: (state: AuthObserverState | null) => void,
  ): () => void;

  /**
   * Send the current user a verification email. Requires a signed-in user.
   *
   * Error codes:
   *   - 'auth_no_current_user'        → AuthorizationError
   */
  sendEmailVerification(): Promise<Result<true, AuthorizationError>>;

  /**
   * Reload the underlying Auth user record and report whether the email is
   * verified. Use this after the user clicks the link in their email.
   */
  isCurrentEmailVerified(): Promise<Result<boolean, AuthorizationError>>;

  /**
   * Send a password reset email to the given address. Does not require the
   * user to be signed in.
   *
   * Returns success even if the address is not registered — Firebase doesn't
   * disclose that to avoid email enumeration. Surface validation errors only
   * for malformed input.
   */
  sendPasswordResetEmail(email: Email): Promise<Result<true, ValidationError>>;

  /**
   * Re-authenticate the current user with their password. Required by
   * Firebase before sensitive operations like email change. Returns ok on
   * success.
   *
   * Error codes:
   *   - 'auth_no_current_user'        → AuthorizationError
   *   - 'auth_wrong_password'         → AuthorizationError
   */
  reauthenticate(args: {
    password: string;
  }): Promise<Result<true, AuthorizationError | ValidationError>>;

  /**
   * Update the current user's email in Firebase Auth and trigger a
   * verification email to the new address. Caller is expected to have
   * reauthenticated within the recent past.
   *
   * Error codes:
   *   - 'auth_no_current_user'        → AuthorizationError
   *   - 'auth_email_already_in_use'   → ConflictError
   *   - 'auth_requires_recent_login'  → AuthorizationError
   *   - 'auth_invalid_email'          → ValidationError
   */
  updateEmail(args: {
    newEmail: Email;
  }): Promise<
    Result<true, AuthorizationError | ConflictError | ValidationError>
  >;
}

/**
 * Helper carried alongside the AuthRepository interface — used by the
 * RegisterUser use case to convey the role chosen at signup time. Lives here
 * (not in the use case) so any future adapter that needs to pass role through
 * to a custom-claim mechanism can reach it.
 */
export interface RegisterUserCredentials {
  readonly email: Email;
  readonly password: string;
  readonly role: Role;
}

/**
 * The shape emitted by `observeAuthState` when a user is signed in.
 * `emailVerified` mirrors Firebase Auth's flag and drives 'needs-verification'
 * routing in the presentation layer.
 */
export interface AuthObserverState {
  readonly userId: UserId;
  readonly emailVerified: boolean;
}
