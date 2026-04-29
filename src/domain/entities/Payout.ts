import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

import type { Money } from './Money';

/**
 * A scheduled or completed transfer of funds from a driver's Stripe Connect
 * balance to their external bank account. Read-only on the rewrite side —
 * Stripe owns the lifecycle; we display the recent list on the driver's
 * Earnings tab.
 *
 * Status values mirror Stripe's documented payout states. We accept all
 * five and surface them through the UI as needed; legacy yeride's Earnings
 * screen displays them as-is.
 */

export type PayoutStatus =
  | 'paid'
  | 'pending'
  | 'in_transit'
  | 'failed'
  | 'canceled';

const PAYOUT_STATUSES: ReadonlySet<PayoutStatus> = new Set<PayoutStatus>([
  'paid',
  'pending',
  'in_transit',
  'failed',
  'canceled',
]);

export interface PayoutProps {
  /** Stripe payout id, e.g. `po_1NQ7Vy...`. Kept as opaque string. */
  readonly id: string;
  readonly amount: Money;
  readonly status: PayoutStatus;
  readonly arrivalDate: Date;
}

export class Payout {
  private constructor(private readonly props: PayoutProps) {}

  static create(props: PayoutProps): Result<Payout, ValidationError> {
    if (typeof props.id !== 'string' || props.id.length === 0) {
      return Result.err(
        new ValidationError({
          code: 'payout_invalid_id',
          message: 'Payout id must be a non-empty string',
          field: 'id',
        }),
      );
    }
    if (!PAYOUT_STATUSES.has(props.status)) {
      return Result.err(
        new ValidationError({
          code: 'payout_invalid_status',
          message: `Payout status must be one of: ${[...PAYOUT_STATUSES].join(', ')}`,
          field: 'status',
        }),
      );
    }
    if (
      !(props.arrivalDate instanceof Date) ||
      Number.isNaN(props.arrivalDate.getTime())
    ) {
      return Result.err(
        new ValidationError({
          code: 'payout_invalid_arrival_date',
          message: 'Payout arrivalDate must be a valid Date',
          field: 'arrivalDate',
        }),
      );
    }
    // `Money.create` already rejects negatives; defense in depth here in
    // case a future caller hands us an unverified Money. (Money is
    // immutable so re-checking via minorUnits is cheap and safe.)
    if (props.amount.minorUnits < 0) {
      return Result.err(
        new ValidationError({
          code: 'payout_negative_amount',
          message: 'Payout amount must be non-negative',
          field: 'amount',
        }),
      );
    }
    return Result.ok(new Payout(props));
  }

  get id(): string {
    return this.props.id;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get status(): PayoutStatus {
    return this.props.status;
  }

  get arrivalDate(): Date {
    return this.props.arrivalDate;
  }
}
