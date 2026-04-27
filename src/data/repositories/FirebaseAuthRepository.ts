import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reload,
  sendEmailVerification as firebaseSendEmailVerification,
  sendPasswordResetEmail as firebaseSendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  verifyBeforeUpdateEmail,
  type FirebaseAuthTypes,
} from '@react-native-firebase/auth';

import type { Email } from '@domain/entities/Email';
import { UserId } from '@domain/entities/UserId';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@domain/errors';
import type { AuthObserverState, AuthRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';
import { LOG } from '@shared/logger';

const logger = LOG.extend('FirebaseAuth');

/**
 * Concrete `AuthRepository` backed by `@react-native-firebase/auth`.
 *
 * Maps Firebase Auth error codes (`auth/*`) to YeRide DomainError subtypes.
 * Programming-level errors (network down, SDK misconfigured) bubble up as
 * thrown errors and are caught by the React error boundary.
 *
 * Notes on email change: Firebase's modern, secure path is
 * `verifyBeforeUpdateEmail` — it sends a verification link to the new
 * address and only updates the auth user's email after the user clicks
 * through. The presentation layer should treat the new email as pending
 * until verified; the Firestore mirror tracks that via `emailVerified:
 * false` on the user doc immediately after the call.
 */
export class FirebaseAuthRepository implements AuthRepository {
  private readonly auth = getAuth();

  async signUp(args: {
    email: Email;
    password: string;
  }): Promise<Result<UserId, ValidationError | ConflictError>> {
    try {
      const cred = await createUserWithEmailAndPassword(
        this.auth,
        args.email.value,
        args.password,
      );
      const idR = UserId.create(cred.user.uid);
      if (!idR.ok) return idR;
      return Result.ok(idR.value);
    } catch (e) {
      const mapped = mapAuthError(e, 'signUp');
      if (mapped.kind === 'conflict' || mapped.kind === 'validation') {
        return Result.err(mapped);
      }
      throw e;
    }
  }

  async signIn(args: {
    email: Email;
    password: string;
  }): Promise<
    Result<UserId, NotFoundError | AuthorizationError | ValidationError>
  > {
    try {
      const cred = await signInWithEmailAndPassword(
        this.auth,
        args.email.value,
        args.password,
      );
      const idR = UserId.create(cred.user.uid);
      if (!idR.ok) return idR;
      return Result.ok(idR.value);
    } catch (e) {
      const mapped = mapAuthError(e, 'signIn');
      if (
        mapped.kind === 'not_found' ||
        mapped.kind === 'authorization' ||
        mapped.kind === 'validation'
      ) {
        return Result.err(mapped);
      }
      throw e;
    }
  }

  async signOut(): Promise<Result<true, never>> {
    await firebaseSignOut(this.auth);
    return Result.ok(true);
  }

  async currentUserId(): Promise<UserId | null> {
    const u = this.auth.currentUser;
    if (!u) return null;
    const idR = UserId.create(u.uid);
    return idR.ok ? idR.value : null;
  }

  observeAuthState(
    callback: (state: AuthObserverState | null) => void,
  ): () => void {
    return onAuthStateChanged(this.auth, (u: FirebaseAuthTypes.User | null) => {
      if (!u) {
        callback(null);
        return;
      }
      const idR = UserId.create(u.uid);
      if (!idR.ok) {
        // UserId is a branded string with a length constraint. Firebase
        // shouldn't ever hand us a uid that fails it, but if it does we
        // treat it as signed-out rather than crash.
        logger.warn('observeAuthState: invalid uid from firebase', {
          uid: u.uid,
        });
        callback(null);
        return;
      }
      callback({ userId: idR.value, emailVerified: u.emailVerified });
    });
  }

  async sendEmailVerification(): Promise<Result<true, AuthorizationError>> {
    const user = this.auth.currentUser;
    if (!user) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_no_current_user',
          message: 'No user is signed in',
        }),
      );
    }
    try {
      await firebaseSendEmailVerification(user);
      return Result.ok(true);
    } catch (e) {
      logger.error('sendEmailVerification failed', e);
      throw e;
    }
  }

  async isCurrentEmailVerified(): Promise<Result<boolean, AuthorizationError>> {
    const user = this.auth.currentUser;
    if (!user) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_no_current_user',
          message: 'No user is signed in',
        }),
      );
    }
    await reload(user);
    return Result.ok(user.emailVerified);
  }

  async sendPasswordResetEmail(
    email: Email,
  ): Promise<Result<true, ValidationError>> {
    try {
      await firebaseSendPasswordResetEmail(this.auth, email.value);
      return Result.ok(true);
    } catch (e) {
      const mapped = mapAuthError(e, 'sendPasswordResetEmail');
      if (mapped.kind === 'validation') return Result.err(mapped);
      // user-not-found is intentionally swallowed — Firebase doesn't expose
      // it (anti-enumeration), but if a malformed email or rate-limit flag
      // surfaces in dev, we want it logged.
      if (mapped.kind === 'not_found') return Result.ok(true);
      throw e;
    }
  }

  async reauthenticate(args: {
    password: string;
  }): Promise<Result<true, AuthorizationError | ValidationError>> {
    const user = this.auth.currentUser;
    if (!user || !user.email) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_no_current_user',
          message: 'No user is signed in',
        }),
      );
    }
    try {
      const cred = EmailAuthProvider.credential(user.email, args.password);
      await reauthenticateWithCredential(user, cred);
      return Result.ok(true);
    } catch (e) {
      const mapped = mapAuthError(e, 'reauthenticate');
      if (mapped.kind === 'authorization' || mapped.kind === 'validation') {
        return Result.err(mapped);
      }
      throw e;
    }
  }

  async updateEmail(args: {
    newEmail: Email;
  }): Promise<
    Result<true, AuthorizationError | ConflictError | ValidationError>
  > {
    const user = this.auth.currentUser;
    if (!user) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_no_current_user',
          message: 'No user is signed in',
        }),
      );
    }
    try {
      // Modern path: send a verification email to the new address and
      // wait for the user to click through. Old `updateEmail` is deprecated
      // unless email-enumeration protection is off.
      await verifyBeforeUpdateEmail(user, args.newEmail.value);
      return Result.ok(true);
    } catch (e) {
      const mapped = mapAuthError(e, 'updateEmail');
      if (
        mapped.kind === 'authorization' ||
        mapped.kind === 'conflict' ||
        mapped.kind === 'validation'
      ) {
        return Result.err(mapped);
      }
      throw e;
    }
  }
}

/* ─────────────────────────── error mapping ───────────────────── */

function mapAuthError(
  e: unknown,
  op: string,
): ValidationError | AuthorizationError | ConflictError | NotFoundError {
  const code =
    typeof e === 'object' && e !== null && 'code' in e
      ? String((e as { code: unknown }).code)
      : 'unknown';
  const message =
    typeof e === 'object' && e !== null && 'message' in e
      ? String((e as { message: unknown }).message)
      : 'Auth operation failed';

  logger.warn(`${op} failed`, { code });

  switch (code) {
    case 'auth/invalid-email':
      return new ValidationError({
        code: 'auth_invalid_email',
        message,
        field: 'email',
        cause: e,
      });
    case 'auth/weak-password':
      return new ValidationError({
        code: 'auth_weak_password',
        message,
        field: 'password',
        cause: e,
      });
    case 'auth/email-already-in-use':
      return new ConflictError({
        code: 'auth_email_already_in_use',
        message,
        cause: e,
      });
    case 'auth/user-not-found':
      return new NotFoundError({
        code: 'auth_user_not_found',
        message,
        resource: 'auth_user',
        cause: e,
      });
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return new AuthorizationError({
        code: 'auth_wrong_password',
        message,
        cause: e,
      });
    case 'auth/user-disabled':
      return new AuthorizationError({
        code: 'auth_user_disabled',
        message,
        cause: e,
      });
    case 'auth/requires-recent-login':
      return new AuthorizationError({
        code: 'auth_requires_recent_login',
        message,
        cause: e,
      });
    case 'auth/too-many-requests':
      return new AuthorizationError({
        code: 'auth_too_many_requests',
        message,
        cause: e,
      });
    default:
      // Unmapped error — surface as authorization so the UI shows something
      // and the cause is preserved for Crashlytics.
      return new AuthorizationError({
        code: `auth_unknown:${code}`,
        message,
        cause: e,
      });
  }
}
