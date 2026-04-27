import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

/**
 * A monetary amount stored as an integer number of minor units (cents for USD)
 * plus an ISO 4217 currency code. All math happens in minor units, so we never
 * accumulate floating-point error.
 *
 * Money is immutable. All operations return a new Money.
 *
 * To create:
 *   Money.create(100, 'USD')           // $1.00
 *   Money.fromMajor(1.5, 'USD')        // $1.50  → 150 cents
 */

export type CurrencyCode = 'USD';

const SUPPORTED_CURRENCIES: readonly CurrencyCode[] = ['USD'] as const;

const MAX_MINOR = 1_000_000 * 100; // $1M ceiling — well above any real trip fare.

export class Money {
  private constructor(
    public readonly minorUnits: number,
    public readonly currency: CurrencyCode,
  ) {}

  /**
   * Create a Money from an exact integer number of minor units.
   */
  static create(
    minorUnits: number,
    currency: CurrencyCode,
  ): Result<Money, ValidationError> {
    if (!Number.isInteger(minorUnits)) {
      return Result.err(
        new ValidationError({
          code: 'money_non_integer_minor_units',
          message: `minorUnits must be an integer, got ${String(minorUnits)}`,
          field: 'minorUnits',
        }),
      );
    }
    if (minorUnits < 0) {
      return Result.err(
        new ValidationError({
          code: 'money_negative',
          message: 'Money cannot be negative',
          field: 'minorUnits',
        }),
      );
    }
    if (minorUnits > MAX_MINOR) {
      return Result.err(
        new ValidationError({
          code: 'money_overflow',
          message: `Money amount exceeds maximum (${String(MAX_MINOR)} minor units)`,
          field: 'minorUnits',
        }),
      );
    }
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
      return Result.err(
        new ValidationError({
          code: 'money_unsupported_currency',
          message: `Unsupported currency: ${String(currency)}`,
          field: 'currency',
        }),
      );
    }
    return Result.ok(new Money(minorUnits, currency));
  }

  /**
   * Create a Money from a major-unit number (e.g. dollars). Rounded to the
   * nearest minor unit using banker's rounding via Math.round.
   *
   * Money.fromMajor(1.005, 'USD') → 100 cents (float artifact is intentionally accepted)
   */
  static fromMajor(
    major: number,
    currency: CurrencyCode,
  ): Result<Money, ValidationError> {
    if (!Number.isFinite(major)) {
      return Result.err(
        new ValidationError({
          code: 'money_not_finite',
          message: 'Money amount must be a finite number',
          field: 'amount',
        }),
      );
    }
    return Money.create(Math.round(major * 100), currency);
  }

  /**
   * The amount expressed in major units (e.g. dollars, not cents).
   */
  get majorUnits(): number {
    return this.minorUnits / 100;
  }

  add(other: Money): Result<Money, ValidationError> {
    const sameCurrency = this.assertSameCurrency(other, 'add');
    if (!sameCurrency.ok) return sameCurrency;
    return Money.create(this.minorUnits + other.minorUnits, this.currency);
  }

  subtract(other: Money): Result<Money, ValidationError> {
    const sameCurrency = this.assertSameCurrency(other, 'subtract');
    if (!sameCurrency.ok) return sameCurrency;
    return Money.create(this.minorUnits - other.minorUnits, this.currency);
  }

  multiply(factor: number): Result<Money, ValidationError> {
    if (!Number.isFinite(factor) || factor < 0) {
      return Result.err(
        new ValidationError({
          code: 'money_invalid_factor',
          message: `Multiplier must be a non-negative finite number, got ${String(factor)}`,
          field: 'factor',
        }),
      );
    }
    return Money.create(Math.round(this.minorUnits * factor), this.currency);
  }

  equals(other: Money): boolean {
    return (
      this.minorUnits === other.minorUnits && this.currency === other.currency
    );
  }

  /**
   * Format for display. We keep this minimal; richer locale-aware formatting
   * lives in presentation.
   */
  format(): string {
    const symbol = this.currency === 'USD' ? '$' : this.currency;
    return `${symbol}${this.majorUnits.toFixed(2)}`;
  }

  private assertSameCurrency(
    other: Money,
    op: string,
  ): Result<true, ValidationError> {
    if (this.currency !== other.currency) {
      return Result.err(
        new ValidationError({
          code: 'money_currency_mismatch',
          message: `Cannot ${op} ${String(this.currency)} and ${String(other.currency)}`,
        }),
      );
    }
    return Result.ok(true);
  }
}
