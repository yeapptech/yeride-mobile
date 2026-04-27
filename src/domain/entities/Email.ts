import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

/**
 * An RFC-822-ish email. We intentionally use a permissive but pragmatic regex
 * — strict RFC-822 parsing is out of scope and would reject many valid
 * addresses (e.g. those with comments). The server is the final authority.
 *
 * Stored normalized to lowercase.
 */

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const MAX_LENGTH = 254; // RFC 5321

export class Email {
  private constructor(public readonly value: string) {}

  static create(input: string): Result<Email, ValidationError> {
    if (typeof input !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'email_not_a_string',
          message: 'Email must be a string',
          field: 'email',
        }),
      );
    }
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'email_empty',
          message: 'Email is required',
          field: 'email',
        }),
      );
    }
    if (trimmed.length > MAX_LENGTH) {
      return Result.err(
        new ValidationError({
          code: 'email_too_long',
          message: `Email exceeds maximum length of ${String(MAX_LENGTH)}`,
          field: 'email',
        }),
      );
    }
    if (!EMAIL_REGEX.test(trimmed)) {
      return Result.err(
        new ValidationError({
          code: 'email_invalid_format',
          message: 'Email is not a valid address',
          field: 'email',
        }),
      );
    }
    return Result.ok(new Email(trimmed.toLowerCase()));
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
