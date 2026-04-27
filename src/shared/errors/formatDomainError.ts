import type { DomainError } from '@domain/errors';

/**
 * Translate a `DomainError` to a user-facing message. The presentation
 * layer calls this whenever a use case returns Result.err — never logs
 * `error.message` directly, since that's often a raw Firebase error.
 *
 * The mapping is intentionally minimal at first; we add new codes as
 * screens surface them. The fallback returns a generic "Something went
 * wrong" so users never see naked stack traces.
 */
export function formatDomainError(error: DomainError): string {
  switch (error.code) {
    /* ───── Validation ───── */
    case 'email_invalid_format':
    case 'email_empty':
    case 'auth_invalid_email':
      return 'Enter a valid email address.';
    case 'phone_invalid':
    case 'phone_empty':
    case 'phone_too_short':
    case 'phone_too_long':
    case 'phone_missing_country_code':
      return 'Enter a valid phone number including country code.';
    case 'name_empty':
      return 'Enter your name.';
    case 'name_too_long':
      return 'Name is too long.';
    case 'auth_weak_password':
      return 'Password is too weak. Use at least 6 characters.';

    /* ───── Auth ───── */
    case 'auth_user_not_found':
      return 'No account found with that email.';
    case 'auth_wrong_password':
      return 'Email or password is incorrect.';
    case 'auth_email_already_in_use':
      return 'An account with that email already exists.';
    case 'auth_user_disabled':
      return 'Your account has been disabled. Contact support.';
    case 'auth_no_current_user':
      return 'You need to sign in to do that.';
    case 'auth_requires_recent_login':
      return 'For security, please sign in again before changing this.';
    case 'auth_too_many_requests':
      return 'Too many attempts. Try again in a few minutes.';

    /* ───── Saved places / not-found ───── */
    case 'user_not_found':
      return 'Your profile could not be loaded. Try signing in again.';

    /* ───── Default ───── */
    default:
      return 'Something went wrong. Please try again.';
  }
}
