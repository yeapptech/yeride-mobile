import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

import type { Money } from './Money';

/**
 * A row from a Stripe Connect account's balance-transaction ledger. The
 * driver's Earnings tab displays the recent list (charges, transfers,
 * payouts, fees) so the driver can reconcile what they were paid for.
 *
 * The Stripe microservice's `/account-balance-transactions` endpoint already
 * narrows the on-the-wire shape and resolves the source-transaction's
 * `tripId` via `metadata.tripId` traversal (see
 * `yeride-stripe-server/stripe/routes.js` line ~948). The rewrite consumes
 * the narrowed shape directly.
 *
 * Invariant: `net = amount - fee`. Stripe enforces this on its side; we
 * re-check at the value-object boundary so a buggy adapter can't construct
 * a malformed transaction.
 */

export interface BalanceTransactionProps {
  /** Stripe balance-transaction id, e.g. `txn_1NQ7Vy...`. Opaque string. */
  readonly id: string;
  readonly amount: Money;
  readonly fee: Money;
  readonly net: Money;
  /** Timestamp of the underlying Stripe activity. */
  readonly createdAt: Date;
  /**
   * Stripe's `type` field. Free-form string from Stripe's perspective
   * (`charge`, `payment`, `transfer`, `payout`, `application_fee`, etc.) —
   * we keep it as a string rather than a closed union because Stripe adds
   * types over time and we don't want to break on unknowns.
   */
  readonly type: string;
  /**
   * The trip this transaction is associated with, if the source-chain
   * traversal could resolve one. `null` for activity not tied to a trip
   * (manual transfers, top-ups, fees).
   */
  readonly tripId: string | null;
}

export class BalanceTransaction {
  private constructor(private readonly props: BalanceTransactionProps) {}

  static create(
    props: BalanceTransactionProps,
  ): Result<BalanceTransaction, ValidationError> {
    if (typeof props.id !== 'string' || props.id.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'balance_txn_invalid_id',
          message: 'BalanceTransaction id must be a non-empty string',
          field: 'id',
        }),
      );
    }
    if (typeof props.type !== 'string' || props.type.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'balance_txn_invalid_type',
          message: 'BalanceTransaction type must be a non-empty string',
          field: 'type',
        }),
      );
    }
    if (
      !(props.createdAt instanceof Date) ||
      Number.isNaN(props.createdAt.getTime())
    ) {
      return Result.err(
        new ValidationError({
          code: 'balance_txn_invalid_created_at',
          message: 'BalanceTransaction createdAt must be a valid Date',
          field: 'createdAt',
        }),
      );
    }
    if (
      props.amount.currency !== props.fee.currency ||
      props.amount.currency !== props.net.currency
    ) {
      return Result.err(
        new ValidationError({
          code: 'balance_txn_currency_mismatch',
          message:
            'BalanceTransaction amount/fee/net must share the same currency',
          field: 'currency',
        }),
      );
    }
    if (
      props.amount.minorUnits - props.fee.minorUnits !==
      props.net.minorUnits
    ) {
      return Result.err(
        new ValidationError({
          code: 'balance_txn_invariant_broken',
          message: 'BalanceTransaction must satisfy net = amount - fee',
          field: 'net',
        }),
      );
    }
    return Result.ok(new BalanceTransaction(props));
  }

  get id(): string {
    return this.props.id;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get fee(): Money {
    return this.props.fee;
  }

  get net(): Money {
    return this.props.net;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get type(): string {
    return this.props.type;
  }

  get tripId(): string | null {
    return this.props.tripId;
  }
}
