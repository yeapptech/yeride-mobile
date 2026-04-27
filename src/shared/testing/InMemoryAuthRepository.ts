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

/**
 * In-memory AuthRepository for use-case unit tests. Behaves like Firebase
 * Auth would, minus the network. Tracks emails → password + uid bindings,
 * a current "signed-in" uid, and verification state.
 *
 * Limitations on purpose:
 *   - No password hashing (it's a test fake)
 *   - No email enumeration guard on sendPasswordResetEmail (deliberate so
 *     tests can assert the call happened against a known address)
 *   - Auth state observers are notified on signIn/signOut only
 */
export class InMemoryAuthRepository implements AuthRepository {
  private static UID_COUNTER = 0;

  /** email → { uid, password, emailVerified } */
  private accounts = new Map<
    string,
    { uid: UserId; password: string; emailVerified: boolean }
  >();

  private currentUid: UserId | null = null;

  private observers = new Set<(state: AuthObserverState | null) => void>();

  /** Test-only knobs: spy on whether each method got called. */
  public spies = {
    sendEmailVerification: 0,
    sendPasswordResetEmail: 0,
    reauthenticate: 0,
  };

  /** Test seam for forcing a specific uid. */
  static synthUid(): UserId {
    InMemoryAuthRepository.UID_COUNTER += 1;
    const padded = String(InMemoryAuthRepository.UID_COUNTER).padStart(28, 'a');
    const uid = UserId.create(padded);
    if (!uid.ok) throw uid.error;
    return uid.value;
  }

  /* ────────── AuthRepository ────────── */

  async signUp(args: {
    email: Email;
    password: string;
  }): Promise<Result<UserId, ValidationError | ConflictError>> {
    if (args.password.length < 6) {
      return Result.err(
        new ValidationError({
          code: 'auth_weak_password',
          message: 'Password must be at least 6 characters',
          field: 'password',
        }),
      );
    }
    const key = args.email.value;
    if (this.accounts.has(key)) {
      return Result.err(
        new ConflictError({
          code: 'auth_email_already_in_use',
          message: 'An account with that email already exists',
        }),
      );
    }
    const uid = InMemoryAuthRepository.synthUid();
    this.accounts.set(key, {
      uid,
      password: args.password,
      emailVerified: false,
    });
    this.setCurrent(uid);
    return Result.ok(uid);
  }

  async signIn(args: {
    email: Email;
    password: string;
  }): Promise<
    Result<UserId, NotFoundError | AuthorizationError | ValidationError>
  > {
    const acct = this.accounts.get(args.email.value);
    if (!acct) {
      return Result.err(
        new NotFoundError({
          code: 'auth_user_not_found',
          message: 'No user with that email',
          resource: 'auth_user',
          id: args.email.value,
        }),
      );
    }
    if (acct.password !== args.password) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_wrong_password',
          message: 'Incorrect password',
        }),
      );
    }
    this.setCurrent(acct.uid);
    return Result.ok(acct.uid);
  }

  async signOut(): Promise<Result<true, never>> {
    this.setCurrent(null);
    return Result.ok(true);
  }

  async currentUserId(): Promise<UserId | null> {
    return this.currentUid;
  }

  observeAuthState(
    callback: (state: AuthObserverState | null) => void,
  ): () => void {
    this.observers.add(callback);
    // Emit current value synchronously so subscribers reflect initial state.
    callback(this.currentState());
    return () => {
      this.observers.delete(callback);
    };
  }

  async sendEmailVerification(): Promise<Result<true, AuthorizationError>> {
    this.spies.sendEmailVerification += 1;
    if (!this.currentUid) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_no_current_user',
          message: 'No user is signed in',
        }),
      );
    }
    return Result.ok(true);
  }

  async isCurrentEmailVerified(): Promise<Result<boolean, AuthorizationError>> {
    if (!this.currentUid) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_no_current_user',
          message: 'No user is signed in',
        }),
      );
    }
    const account = this.findByUid(this.currentUid);
    return Result.ok(account?.emailVerified ?? false);
  }

  async sendPasswordResetEmail(
    _email: Email,
  ): Promise<Result<true, ValidationError>> {
    this.spies.sendPasswordResetEmail += 1;
    return Result.ok(true);
  }

  async reauthenticate(args: {
    password: string;
  }): Promise<Result<true, AuthorizationError | ValidationError>> {
    this.spies.reauthenticate += 1;
    if (!this.currentUid) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_no_current_user',
          message: 'No user is signed in',
        }),
      );
    }
    const account = this.findByUid(this.currentUid);
    if (!account || account.password !== args.password) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_wrong_password',
          message: 'Incorrect password',
        }),
      );
    }
    return Result.ok(true);
  }

  async updateEmail(args: {
    newEmail: Email;
  }): Promise<
    Result<true, AuthorizationError | ConflictError | ValidationError>
  > {
    if (!this.currentUid) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_no_current_user',
          message: 'No user is signed in',
        }),
      );
    }
    if (this.accounts.has(args.newEmail.value)) {
      return Result.err(
        new ConflictError({
          code: 'auth_email_already_in_use',
          message: 'That email is already in use',
        }),
      );
    }
    const oldEntry = [...this.accounts.entries()].find(
      ([, a]) => a.uid === this.currentUid,
    );
    if (!oldEntry) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_no_current_user',
          message: 'Current user not found in account store',
        }),
      );
    }
    const [oldEmail, account] = oldEntry;
    this.accounts.delete(oldEmail);
    this.accounts.set(args.newEmail.value, {
      ...account,
      emailVerified: false,
    });
    return Result.ok(true);
  }

  /* ────────── Test-only helpers ────────── */

  /**
   * Mark the currently-signed-in user as having verified their email. Notifies
   * observers because the verification flag is part of the emitted state — the
   * presentation layer needs to know to flip out of 'needs-verification'.
   * (This is the in-memory analogue of the manual session-store nudge in
   * `useEmailVerificationViewModel` since Firebase doesn't fire
   * `onAuthStateChanged` on `user.reload()`.)
   */
  markCurrentVerified(): void {
    if (!this.currentUid) return;
    const acct = this.findByUid(this.currentUid);
    if (acct) acct.emailVerified = true;
    this.notifyObservers();
  }

  /** Test-only: directly seed an account without going through signUp. */
  seedAccount(args: {
    email: string;
    password: string;
    emailVerified?: boolean;
  }): UserId {
    const uid = InMemoryAuthRepository.synthUid();
    this.accounts.set(args.email, {
      uid,
      password: args.password,
      emailVerified: args.emailVerified ?? false,
    });
    return uid;
  }

  /* ────────── private ────────── */

  private setCurrent(uid: UserId | null): void {
    this.currentUid = uid;
    this.notifyObservers();
  }

  private currentState(): AuthObserverState | null {
    if (!this.currentUid) return null;
    const acct = this.findByUid(this.currentUid);
    return {
      userId: this.currentUid,
      emailVerified: acct?.emailVerified ?? false,
    };
  }

  private notifyObservers(): void {
    const state = this.currentState();
    for (const o of this.observers) o(state);
  }

  private findByUid(uid: UserId) {
    for (const acct of this.accounts.values()) {
      if (acct.uid === uid) return acct;
    }
    return null;
  }
}
