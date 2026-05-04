import type { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

import type { Email } from './Email';
import type { PaymentMethodId } from './PaymentMethodId';
import type { PersonName } from './PersonName';
import type { PhoneNumber } from './PhoneNumber';
import type { StripeCustomerId } from './StripeCustomerId';
import type { UserId } from './UserId';

/**
 * Denormalized rider profile baked into a `trips/{tripId}.passenger` field
 * at trip-creation time. The legacy yeride app embeds the rider's contact
 * info on the trip so the driver's UI doesn't need a second Firestore
 * round-trip — same pattern preserved here.
 *
 * Field set matches legacy `passenger` exactly so the rewrite can read &
 * write trips that legacy clients also process.
 *
 *   - `pushToken`: Expo push token captured at trip-creation; the driver's
 *     UI sends notifications through it. May go stale; the rewrite
 *     refreshes it via the user doc on each trip create (Phase 2 turn 3b).
 *   - `stripeCustomerId`: rider's Stripe customer id, baked at creation
 *     so the deployed `processPaymentForTrip` Cloud Function can charge
 *     the right Customer for fare / cancellation fee / tip without a
 *     second Firestore round-trip. Phase 6 polish (Phase 9 turn 4): the
 *     server-side validator hard-requires this field; without it any of
 *     `completeTrip` / `cancelTrip` / `tipDriver` fail (the trip-updated
 *     Firestore trigger fails silently, the callables fail loudly).
 *   - `defaultPaymentMethod`: an OBJECT carrying the Stripe payment-method
 *     id and its type (`'card' | 'cash'`). Server reads `.id` for the
 *     `/direct-charge` call and `.type` for cash-payment branching. The
 *     legacy yeride writes the FULL Stripe `PaymentMethod` object here
 *     (`{id, type, card: {brand, last4, ...}}`); the rewrite writes the
 *     minimum shape the server actually reads, which legacy can also
 *     consume.
 *   - `avatarUrl`: optional download URL.
 */

/**
 * Minimal payment-method snapshot baked into the trip doc. The deployed
 * Cloud Function reads `.id` (becomes `paymentMethodId` in `/direct-charge`)
 * and `.type` (cash-vs-card branching). Legacy yeride writes additional
 * `card.{brand, last4, exp_*}` fields; we don't carry them in the domain
 * because nothing on either side reads them off the trip doc — the brand /
 * last4 the rider sees on the receipt comes from the user-side
 * `useListPaymentMethodsQuery`, not from this snapshot.
 */
export interface PassengerPaymentMethod {
  readonly id: PaymentMethodId;
  readonly type: 'card' | 'cash';
}

export interface PassengerSnapshotProps {
  readonly id: UserId;
  readonly name: PersonName;
  readonly email: Email;
  readonly phoneNumber: PhoneNumber;
  readonly pushToken: string | null;
  readonly avatarUrl: string | null;
  readonly stripeCustomerId: StripeCustomerId | null;
  readonly defaultPaymentMethod: PassengerPaymentMethod | null;
}

export class PassengerSnapshot {
  private constructor(private readonly props: PassengerSnapshotProps) {}

  static create(
    props: PassengerSnapshotProps,
  ): Result<PassengerSnapshot, ValidationError> {
    return Result.ok(new PassengerSnapshot(props));
  }

  get id(): UserId {
    return this.props.id;
  }
  get name(): PersonName {
    return this.props.name;
  }
  get email(): Email {
    return this.props.email;
  }
  get phoneNumber(): PhoneNumber {
    return this.props.phoneNumber;
  }
  get pushToken(): string | null {
    return this.props.pushToken;
  }
  get avatarUrl(): string | null {
    return this.props.avatarUrl;
  }
  get stripeCustomerId(): StripeCustomerId | null {
    return this.props.stripeCustomerId;
  }
  get defaultPaymentMethod(): PassengerPaymentMethod | null {
    return this.props.defaultPaymentMethod;
  }
}
