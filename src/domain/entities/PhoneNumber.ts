import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

/**
 * An E.164-formatted phone number, e.g. "+14155550123".
 *
 * We accept input with spaces, dashes, parens, dots, and a leading 0 or +;
 * we strip all of those and validate the digit-only form. The canonical
 * stored value is `+` followed by 7–15 digits.
 *
 * For the rewrite we don't enforce country-specific rules — backend is the
 * source of truth there. This value object guards basic shape only.
 */

const MIN_DIGITS = 7;
const MAX_DIGITS = 15;

export class PhoneNumber {
  private constructor(public readonly value: string) {}

  static create(input: string): Result<PhoneNumber, ValidationError> {
    if (typeof input !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'phone_not_a_string',
          message: 'Phone must be a string',
          field: 'phone',
        }),
      );
    }
    const trimmed = input.trim();
    if (trimmed.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'phone_empty',
          message: 'Phone is required',
          field: 'phone',
        }),
      );
    }
    const startsWithPlus = trimmed.startsWith('+');
    const digits = trimmed.replace(/\D+/g, '');
    if (digits.length < MIN_DIGITS) {
      return Result.err(
        new ValidationError({
          code: 'phone_too_short',
          message: `Phone must contain at least ${String(MIN_DIGITS)} digits`,
          field: 'phone',
        }),
      );
    }
    if (digits.length > MAX_DIGITS) {
      return Result.err(
        new ValidationError({
          code: 'phone_too_long',
          message: `Phone must contain at most ${String(MAX_DIGITS)} digits`,
          field: 'phone',
        }),
      );
    }
    // Re-introduce the leading + if the input already had one. If not, we
    // require the caller to present a country-coded number; we don't guess.
    if (!startsWithPlus) {
      return Result.err(
        new ValidationError({
          code: 'phone_missing_country_code',
          message: 'Phone must be in E.164 format and start with "+"',
          field: 'phone',
        }),
      );
    }
    return Result.ok(new PhoneNumber(`+${digits}`));
  }

  equals(other: PhoneNumber): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
