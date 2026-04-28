import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

import type { Email } from './Email';
import type { PersonName } from './PersonName';
import type { PhoneNumber } from './PhoneNumber';
import type { UserId } from './UserId';

/**
 * Sanitized vehicle info embedded on the trip at dispatch time. The legacy
 * yeride app queries the active vehicle doc on dispatch and copies these
 * fields into `trip.driver.vehicle` so the rider sees vehicle info before
 * pickup without an extra Firestore round-trip.
 *
 * The full Vehicle entity (Phase 5) has more — VIN, registration, insurance,
 * etc. We deliberately omit those here; only the rider-facing fields make
 * the snapshot.
 */
export interface VehicleSnapshotProps {
  readonly make: string;
  readonly model: string;
  readonly year: number;
  readonly color: string;
  readonly licensePlate: string;
  readonly stockPhoto: string | null;
  readonly photos: readonly string[];
}

export class VehicleSnapshot {
  private constructor(private readonly props: VehicleSnapshotProps) {}

  static create(
    props: VehicleSnapshotProps,
  ): Result<VehicleSnapshot, ValidationError> {
    if (
      !Number.isInteger(props.year) ||
      props.year < 1900 ||
      props.year > 2100
    ) {
      return Result.err(
        new ValidationError({
          code: 'vehicle_snapshot_invalid_year',
          message: 'year must be a four-digit integer in [1900, 2100]',
          field: 'year',
        }),
      );
    }
    if (props.licensePlate.trim().length === 0) {
      return Result.err(
        new ValidationError({
          code: 'vehicle_snapshot_empty_license_plate',
          message: 'licensePlate must be a non-empty string',
          field: 'licensePlate',
        }),
      );
    }
    return Result.ok(new VehicleSnapshot(props));
  }

  get make(): string {
    return this.props.make;
  }
  get model(): string {
    return this.props.model;
  }
  get year(): number {
    return this.props.year;
  }
  get color(): string {
    return this.props.color;
  }
  get licensePlate(): string {
    return this.props.licensePlate;
  }
  get stockPhoto(): string | null {
    return this.props.stockPhoto;
  }
  get photos(): readonly string[] {
    return this.props.photos;
  }
}

/**
 * Denormalized driver profile baked into `trips/{tripId}.driver` at dispatch
 * time. Distinct from `PassengerSnapshot` because drivers carry Stripe
 * Connect details and an optional vehicle subobject.
 *
 * Field set matches legacy 1:1 for round-trip safety:
 *   - `stripeAccountId`: Stripe Connect account id. The completeTrip
 *     Cloud Function uses this to route the driver's earnings.
 *   - `vehicle`: VehicleSnapshot taken at dispatch. May be null briefly
 *     during a legacy migration window; treat as "vehicle info not yet
 *     loaded" if so.
 */
export interface DriverSnapshotProps {
  readonly id: UserId;
  readonly name: PersonName;
  readonly email: Email;
  readonly phoneNumber: PhoneNumber;
  readonly stripeAccountId: string;
  readonly pushToken: string | null;
  readonly avatarUrl: string | null;
  readonly vehicle: VehicleSnapshot | null;
}

export class DriverSnapshot {
  private constructor(private readonly props: DriverSnapshotProps) {}

  static create(
    props: DriverSnapshotProps,
  ): Result<DriverSnapshot, ValidationError> {
    if (props.stripeAccountId.trim().length === 0) {
      return Result.err(
        new ValidationError({
          code: 'driver_snapshot_empty_stripe_account',
          message: 'stripeAccountId must be a non-empty string',
          field: 'stripeAccountId',
        }),
      );
    }
    return Result.ok(new DriverSnapshot(props));
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
  get stripeAccountId(): string {
    return this.props.stripeAccountId;
  }
  get pushToken(): string | null {
    return this.props.pushToken;
  }
  get avatarUrl(): string | null {
    return this.props.avatarUrl;
  }
  get vehicle(): VehicleSnapshot | null {
    return this.props.vehicle;
  }
}
