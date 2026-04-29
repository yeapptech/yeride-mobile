import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

import type { PaymentMethodId } from './PaymentMethodId';

/**
 * A saved card on a rider's Stripe customer record. Lightweight read model
 * over the subset of Stripe's `PaymentMethod` resource we surface in the UI.
 *
 * The Stripe microservice's `/customer-payment-methods` endpoint currently
 * narrows the on-the-wire shape to `{ id, type, brand, displayBrand, last4,
 * funding }` — Stripe's `card.exp_month` / `card.exp_year` are NOT exposed
 * by the legacy server today. So `expiry` is nullable: the rewrite stays
 * honest about what the contract delivers, and the UI hides the expiry
 * line when null. If/when the server adds expiry, switch the adapter to
 * pass it through and the value object accepts it without further change.
 *
 * Why a closed brand union rather than `string`: legacy yeride routes the
 * card glyph by `item.brand` (see `src/utils/cardImage.js`); Stripe ships ~7
 * canonical brands. Anything outside the list lands as `'unknown'` and the
 * UI shows a generic glyph rather than a stale-string surface.
 */

export type CardBrand =
  | 'visa'
  | 'mastercard'
  | 'amex'
  | 'discover'
  | 'diners'
  | 'jcb'
  | 'unionpay'
  | 'unknown';

const KNOWN_BRANDS: ReadonlySet<CardBrand> = new Set<CardBrand>([
  'visa',
  'mastercard',
  'amex',
  'discover',
  'diners',
  'jcb',
  'unionpay',
  'unknown',
]);

/**
 * Coerce a raw Stripe brand string into the closed `CardBrand` union.
 * Unknown values land at `'unknown'` rather than rejecting — the wallet
 * should render every payment method the customer has, even if Stripe added
 * a new brand we haven't catalogued yet.
 */
export function normalizeCardBrand(raw: string | null | undefined): CardBrand {
  if (typeof raw !== 'string') return 'unknown';
  const lower = raw.toLowerCase();
  return KNOWN_BRANDS.has(lower as CardBrand)
    ? (lower as CardBrand)
    : 'unknown';
}

const LAST4_REGEX = /^[0-9]{4}$/;
const MIN_EXPIRY_YEAR = 2000;
const MAX_EXPIRY_YEAR = 2099;

export interface PaymentMethodExpiry {
  /** 1..12 inclusive. */
  readonly month: number;
  /** 4-digit year, 2000..2099. */
  readonly year: number;
}

export interface PaymentMethodProps {
  readonly id: PaymentMethodId;
  readonly brand: CardBrand;
  readonly last4: string;
  /**
   * Expiry month + year, when the wire payload exposes them. The legacy
   * `/customer-payment-methods` endpoint omits expiry today, so adapter
   * paths over that contract construct payment methods with `expiry: null`.
   */
  readonly expiry: PaymentMethodExpiry | null;
}

export class PaymentMethod {
  private constructor(private readonly props: PaymentMethodProps) {}

  /**
   * Construct a `PaymentMethod`. Validates the static shape only — the
   * caller is expected to have already coerced `brand` via
   * `normalizeCardBrand` if it came off the wire as a free-form string.
   *
   * `expiry` is nullable. When non-null, month + year are validated; when
   * null, the value object simply doesn't carry expiry data and
   * `isExpired(now)` returns `false` (we cannot know).
   *
   * Note: we do NOT reject an expired card here even when expiry IS known.
   * Stripe's API exposes expired cards in the customer's saved-methods
   * list (the rider may want to see them and update the expiry instead of
   * re-entering the card). Surfacing the expired state is a presentation
   * concern; `isExpired(now)` is provided below for the UI.
   */
  static create(
    props: PaymentMethodProps,
  ): Result<PaymentMethod, ValidationError> {
    if (typeof props.last4 !== 'string' || !LAST4_REGEX.test(props.last4)) {
      return Result.err(
        new ValidationError({
          code: 'payment_method_invalid_last4',
          message: 'last4 must be exactly 4 digits',
          field: 'last4',
        }),
      );
    }
    if (props.expiry !== null) {
      if (
        !Number.isInteger(props.expiry.month) ||
        props.expiry.month < 1 ||
        props.expiry.month > 12
      ) {
        return Result.err(
          new ValidationError({
            code: 'payment_method_invalid_expiry_month',
            message: 'expiry.month must be an integer in 1..12',
            field: 'expiry.month',
          }),
        );
      }
      if (
        !Number.isInteger(props.expiry.year) ||
        props.expiry.year < MIN_EXPIRY_YEAR ||
        props.expiry.year > MAX_EXPIRY_YEAR
      ) {
        return Result.err(
          new ValidationError({
            code: 'payment_method_invalid_expiry_year',
            message: `expiry.year must be a 4-digit year in ${String(MIN_EXPIRY_YEAR)}..${String(MAX_EXPIRY_YEAR)}`,
            field: 'expiry.year',
          }),
        );
      }
    }
    return Result.ok(new PaymentMethod(props));
  }

  get id(): PaymentMethodId {
    return this.props.id;
  }

  get brand(): CardBrand {
    return this.props.brand;
  }

  get last4(): string {
    return this.props.last4;
  }

  get expiry(): PaymentMethodExpiry | null {
    return this.props.expiry;
  }

  /**
   * Whether the card is past its expiry as of `now`. A card with expiry
   * `{month: 12, year: 2026}` is valid through end-of-day on 2026-12-31; we
   * treat the FIRST day of the FOLLOWING month as the cutover.
   *
   * Returns `false` when `expiry` is unknown — the rewrite cannot label a
   * card as expired without the data, so the UI surfaces it as valid and
   * the actual charge attempt at trip-completion time is the source of
   * truth.
   */
  isExpired(now: Date): boolean {
    if (this.props.expiry === null) return false;
    const cutoverYear =
      this.props.expiry.month === 12
        ? this.props.expiry.year + 1
        : this.props.expiry.year;
    const cutoverMonth =
      this.props.expiry.month === 12 ? 1 : this.props.expiry.month + 1;
    // Compare against the first millisecond of the cutover month, UTC.
    const cutover = Date.UTC(cutoverYear, cutoverMonth - 1, 1);
    return now.getTime() >= cutover;
  }
}
