import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

/**
 * A person's display name, split into first and last components.
 * Both required, both bounded.
 *
 * Names are stored as-entered (preserving capitalization). Whitespace at the
 * edges is trimmed. We do not normalize case — names like "de la Cruz" or
 * "MacArthur" need to round-trip exactly.
 */

const MIN_LENGTH = 1;
const MAX_LENGTH = 80;

export class PersonName {
  private constructor(
    public readonly first: string,
    public readonly last: string,
  ) {}

  static create(args: {
    first: string;
    last: string;
  }): Result<PersonName, ValidationError> {
    const first = PersonName.cleanPart(args.first, 'firstName');
    if (!first.ok) return first;
    const last = PersonName.cleanPart(args.last, 'lastName');
    if (!last.ok) return last;
    return Result.ok(new PersonName(first.value, last.value));
  }

  private static cleanPart(
    value: string,
    field: 'firstName' | 'lastName',
  ): Result<string, ValidationError> {
    if (typeof value !== 'string') {
      return Result.err(
        new ValidationError({
          code: 'name_not_a_string',
          message: `${field} must be a string`,
          field,
        }),
      );
    }
    const trimmed = value.trim();
    if (trimmed.length < MIN_LENGTH) {
      return Result.err(
        new ValidationError({
          code: 'name_empty',
          message: `${field} is required`,
          field,
        }),
      );
    }
    if (trimmed.length > MAX_LENGTH) {
      return Result.err(
        new ValidationError({
          code: 'name_too_long',
          message: `${field} exceeds maximum length of ${String(MAX_LENGTH)}`,
          field,
        }),
      );
    }
    return Result.ok(trimmed);
  }

  get full(): string {
    return `${this.first} ${this.last}`;
  }

  equals(other: PersonName): boolean {
    return this.first === other.first && this.last === other.last;
  }
}
