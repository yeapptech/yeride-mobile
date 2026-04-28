import type { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

import type { Email } from './Email';
import type { PersonName } from './PersonName';
import type { PhoneNumber } from './PhoneNumber';
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
 *   - `defaultPaymentMethod`: opaque Stripe payment-method id used by the
 *     server-side fare-charge pipeline. The client never inspects fields on
 *     it.
 *   - `avatarUrl`: optional download URL.
 */
export interface PassengerSnapshotProps {
  readonly id: UserId;
  readonly name: PersonName;
  readonly email: Email;
  readonly phoneNumber: PhoneNumber;
  readonly pushToken: string | null;
  readonly avatarUrl: string | null;
  readonly defaultPaymentMethod: string | null;
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
  get defaultPaymentMethod(): string | null {
    return this.props.defaultPaymentMethod;
  }
}
