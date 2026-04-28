import { ValidationError } from '../errors/ValidationError';
import { Result } from '../shared/Result';

import type { RideServiceId } from './RideServiceId';
import type { VehicleClass } from './VehicleClass';
import type { VehiclePhotoType } from './VehiclePhotoType';
import type { VehicleSpecs } from './VehicleSpecs';
import type { VehicleStatus } from './VehicleStatus';
import type { Vin } from './Vin';

/**
 * The vehicle aggregate. Mirrors the legacy `vehicles/{vin}` document with
 * VIN as the document id (stable identifier; survives re-registration).
 *
 * Construction:
 *   - `Vehicle.create(...)` takes the *intrinsic* vehicle properties
 *     (make/model/year/class/eligibleServices/...) and produces a freshly
 *     registered vehicle with `status: 'pending'`. The `RegisterVehicle`
 *     use case (Turn 2) flips status to `'approved'` immediately to match
 *     legacy auto-approve. We don't auto-approve in the factory because
 *     hydration paths (`fromProps`) need to preserve whatever status the
 *     doc was written with.
 *   - `Vehicle.fromProps(...)` is the hydration path used by the mapper.
 *     Total over already-validated value objects.
 *
 * Transitions are immutable: every method returns a new Vehicle.
 *
 *      pending ──approve()──▶ approved ──suspend()──▶ suspended
 *         │                                            │
 *         └────reject(notes)──▶ rejected               │
 *                                                      │
 *                       any non-deleted ──markDeleted()─┘  (terminal)
 *
 * `attachPhoto`, `setStockPhoto`, and `setEligibleServices` are
 * non-status mutations: they're allowed in any non-deleted state.
 *
 * Photo coverage is NOT enforced by the entity. Legacy doesn't gate
 * approval on photo completeness, and the rewrite preserves that — the
 * `VehiclePhotos` screen lets the driver leave tiles empty.
 */
export interface VehiclePhotos {
  readonly front: string | null;
  readonly back: string | null;
  readonly left: string | null;
  readonly right: string | null;
  readonly interior: string | null;
}

export const EMPTY_VEHICLE_PHOTOS: VehiclePhotos = {
  front: null,
  back: null,
  left: null,
  right: null,
  interior: null,
};

export type VehicleDataSource = 'vin_decoded' | 'manual_entry';

export interface VehicleProps {
  readonly vin: Vin;
  readonly status: VehicleStatus;
  readonly make: string;
  readonly model: string;
  readonly year: number;
  readonly trim: string | null;
  readonly bodyClass: string | null;
  readonly vehicleClass: VehicleClass;
  readonly seats: number | null;
  readonly doors: number | null;
  readonly eligibleServices: readonly RideServiceId[];
  readonly photos: VehiclePhotos;
  readonly stockPhoto: string | null;
  readonly specs: VehicleSpecs;
  readonly dataSource: VehicleDataSource;
  readonly verificationNotes: string | null;
  readonly verifiedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;
const MIN_NAME_LEN = 1;
const MAX_NAME_LEN = 80;
const MIN_SEATS = 1;
const MAX_SEATS = 16;
const MIN_DOORS = 1;
const MAX_DOORS = 8;

export class Vehicle {
  private constructor(private readonly props: VehicleProps) {}

  /**
   * Hydrate a Vehicle from a (validated) document. Total — input is
   * assumed already-validated by the mapper layer.
   */
  static fromProps(props: VehicleProps): Result<Vehicle, ValidationError> {
    const v = validateProps(props);
    if (!v.ok) return v;
    return Result.ok(new Vehicle(props));
  }

  /**
   * Construct a freshly-registered vehicle. Status is `'pending'` — the
   * `RegisterVehicle` use case (Turn 2) flips it to `'approved'` right
   * away to match legacy auto-approve behavior.
   *
   * Required fields: vin, make, model, year, vehicleClass,
   * eligibleServices, dataSource, createdAt. Optional: trim, bodyClass,
   * seats, doors, photos (defaults to all-null), stockPhoto, specs.
   */
  static create(args: {
    vin: Vin;
    make: string;
    model: string;
    year: number;
    vehicleClass: VehicleClass;
    eligibleServices: readonly RideServiceId[];
    dataSource: VehicleDataSource;
    createdAt: Date;
    trim?: string | null;
    bodyClass?: string | null;
    seats?: number | null;
    doors?: number | null;
    photos?: VehiclePhotos;
    stockPhoto?: string | null;
    specs?: VehicleSpecs;
  }): Result<Vehicle, ValidationError> {
    return Vehicle.fromProps({
      vin: args.vin,
      status: 'pending',
      make: args.make,
      model: args.model,
      year: args.year,
      trim: args.trim ?? null,
      bodyClass: args.bodyClass ?? null,
      vehicleClass: args.vehicleClass,
      seats: args.seats ?? null,
      doors: args.doors ?? null,
      eligibleServices: args.eligibleServices,
      photos: args.photos ?? EMPTY_VEHICLE_PHOTOS,
      stockPhoto: args.stockPhoto ?? null,
      specs: args.specs ?? {},
      dataSource: args.dataSource,
      verificationNotes: null,
      verifiedAt: null,
      deletedAt: null,
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    });
  }

  /* ────────── property accessors ────────── */

  get vin(): Vin {
    return this.props.vin;
  }
  get status(): VehicleStatus {
    return this.props.status;
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
  get trim(): string | null {
    return this.props.trim;
  }
  get bodyClass(): string | null {
    return this.props.bodyClass;
  }
  get vehicleClass(): VehicleClass {
    return this.props.vehicleClass;
  }
  get seats(): number | null {
    return this.props.seats;
  }
  get doors(): number | null {
    return this.props.doors;
  }
  get eligibleServices(): readonly RideServiceId[] {
    return this.props.eligibleServices;
  }
  get photos(): VehiclePhotos {
    return this.props.photos;
  }
  get stockPhoto(): string | null {
    return this.props.stockPhoto;
  }
  get specs(): VehicleSpecs {
    return this.props.specs;
  }
  get dataSource(): VehicleDataSource {
    return this.props.dataSource;
  }
  get verificationNotes(): string | null {
    return this.props.verificationNotes;
  }
  get verifiedAt(): Date | null {
    return this.props.verifiedAt;
  }
  get deletedAt(): Date | null {
    return this.props.deletedAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /** Convenience: did this vehicle pass admin review? */
  get isApproved(): boolean {
    return this.props.status === 'approved';
  }

  /** Convenience: has the driver soft-deleted this vehicle? */
  get isDeleted(): boolean {
    return this.props.status === 'deleted';
  }

  /* ────────── status transitions ────────── */

  /**
   * Admin approves the vehicle. Allowed from `pending` or `suspended`
   * (re-approval after a temporary suspension lifts). Refused from
   * `rejected` (registration would have to start over) and `deleted`.
   */
  approve(at: Date): Result<Vehicle, ValidationError> {
    if (this.props.status !== 'pending' && this.props.status !== 'suspended') {
      return Result.err(
        illegal(
          this.props.status,
          'approve',
          '(pending | suspended) → approved',
        ),
      );
    }
    return Vehicle.fromProps({
      ...this.props,
      status: 'approved',
      verifiedAt: at,
      // Clear any prior rejection/suspension notes — approval supersedes.
      verificationNotes: null,
      updatedAt: at,
    });
  }

  /**
   * Admin rejects the vehicle. `notes` is required so the driver knows
   * why. Allowed from `pending` only (a previously approved vehicle is
   * `suspend`ed, not `reject`ed).
   */
  reject(args: { notes: string; at: Date }): Result<Vehicle, ValidationError> {
    if (this.props.status !== 'pending') {
      return Result.err(
        illegal(this.props.status, 'reject', 'pending → rejected'),
      );
    }
    if (args.notes.trim().length === 0) {
      return Result.err(
        new ValidationError({
          code: 'vehicle_reject_notes_required',
          message: 'Rejection notes must be a non-empty string',
          field: 'notes',
        }),
      );
    }
    return Vehicle.fromProps({
      ...this.props,
      status: 'rejected',
      verificationNotes: args.notes,
      verifiedAt: args.at,
      updatedAt: args.at,
    });
  }

  /**
   * Admin suspends an approved vehicle (e.g. failed inspection). Allowed
   * from `approved` only.
   */
  suspend(args: {
    notes?: string | null;
    at: Date;
  }): Result<Vehicle, ValidationError> {
    if (this.props.status !== 'approved') {
      return Result.err(
        illegal(this.props.status, 'suspend', 'approved → suspended'),
      );
    }
    return Vehicle.fromProps({
      ...this.props,
      status: 'suspended',
      verificationNotes: args.notes ?? null,
      updatedAt: args.at,
    });
  }

  /**
   * Driver soft-deletes the vehicle. Allowed from any non-deleted state;
   * re-deletion is a no-op-shaped error. The repository handles the
   * `user.vehicleIds[]` array removal + active-vehicle clearing — that's
   * cross-aggregate concern.
   */
  markDeleted(at: Date): Result<Vehicle, ValidationError> {
    if (this.props.status === 'deleted') {
      return Result.err(
        illegal(this.props.status, 'markDeleted', 'non-deleted → deleted'),
      );
    }
    return Vehicle.fromProps({
      ...this.props,
      status: 'deleted',
      deletedAt: at,
      updatedAt: at,
    });
  }

  /* ────────── non-status mutations ────────── */

  /**
   * Attach (or overwrite) a photo URL for one of the five perspectives.
   * Refused on a deleted vehicle.
   */
  attachPhoto(args: {
    type: VehiclePhotoType;
    url: string;
    at: Date;
  }): Result<Vehicle, ValidationError> {
    if (this.props.status === 'deleted') {
      return Result.err(
        new ValidationError({
          code: 'vehicle_attach_photo_on_deleted',
          message: 'Cannot attach a photo to a deleted vehicle',
          field: 'status',
        }),
      );
    }
    if (typeof args.url !== 'string' || args.url.trim().length === 0) {
      return Result.err(
        new ValidationError({
          code: 'vehicle_photo_url_invalid',
          message: 'Photo URL must be a non-empty string',
          field: 'url',
        }),
      );
    }
    const photos: VehiclePhotos = {
      ...this.props.photos,
      [args.type]: args.url,
    };
    return Vehicle.fromProps({
      ...this.props,
      photos,
      updatedAt: args.at,
    });
  }

  /**
   * Replace the eligible-services list (e.g. after admin reclassifies the
   * vehicle's tier). Empty list is allowed — the dispatcher will simply
   * not match the vehicle.
   */
  setEligibleServices(args: {
    services: readonly RideServiceId[];
    at: Date;
  }): Result<Vehicle, ValidationError> {
    if (this.props.status === 'deleted') {
      return Result.err(
        new ValidationError({
          code: 'vehicle_set_services_on_deleted',
          message: 'Cannot set eligible services on a deleted vehicle',
          field: 'status',
        }),
      );
    }
    return Vehicle.fromProps({
      ...this.props,
      eligibleServices: args.services,
      updatedAt: args.at,
    });
  }

  /** Set or clear the NHTSA stock photo URL. */
  setStockPhoto(args: {
    url: string | null;
    at: Date;
  }): Result<Vehicle, ValidationError> {
    if (this.props.status === 'deleted') {
      return Result.err(
        new ValidationError({
          code: 'vehicle_set_stock_photo_on_deleted',
          message: 'Cannot change stock photo on a deleted vehicle',
          field: 'status',
        }),
      );
    }
    return Vehicle.fromProps({
      ...this.props,
      stockPhoto: args.url,
      updatedAt: args.at,
    });
  }
}

/* ────────── private helpers ────────── */

function validateProps(props: VehicleProps): Result<true, ValidationError> {
  if (props.make.trim().length < MIN_NAME_LEN) {
    return Result.err(
      new ValidationError({
        code: 'vehicle_invalid_make',
        message: 'make must be a non-empty string',
        field: 'make',
      }),
    );
  }
  if (props.make.length > MAX_NAME_LEN) {
    return Result.err(
      new ValidationError({
        code: 'vehicle_invalid_make',
        message: `make must be ≤ ${String(MAX_NAME_LEN)} characters`,
        field: 'make',
      }),
    );
  }
  if (props.model.trim().length < MIN_NAME_LEN) {
    return Result.err(
      new ValidationError({
        code: 'vehicle_invalid_model',
        message: 'model must be a non-empty string',
        field: 'model',
      }),
    );
  }
  if (props.model.length > MAX_NAME_LEN) {
    return Result.err(
      new ValidationError({
        code: 'vehicle_invalid_model',
        message: `model must be ≤ ${String(MAX_NAME_LEN)} characters`,
        field: 'model',
      }),
    );
  }
  if (
    !Number.isInteger(props.year) ||
    props.year < MIN_YEAR ||
    props.year > MAX_YEAR
  ) {
    return Result.err(
      new ValidationError({
        code: 'vehicle_invalid_year',
        message: `year must be an integer in [${String(MIN_YEAR)}, ${String(MAX_YEAR)}]`,
        field: 'year',
      }),
    );
  }
  if (
    props.seats !== null &&
    (!Number.isInteger(props.seats) ||
      props.seats < MIN_SEATS ||
      props.seats > MAX_SEATS)
  ) {
    return Result.err(
      new ValidationError({
        code: 'vehicle_invalid_seats',
        message: `seats must be an integer in [${String(MIN_SEATS)}, ${String(MAX_SEATS)}]`,
        field: 'seats',
      }),
    );
  }
  if (
    props.doors !== null &&
    (!Number.isInteger(props.doors) ||
      props.doors < MIN_DOORS ||
      props.doors > MAX_DOORS)
  ) {
    return Result.err(
      new ValidationError({
        code: 'vehicle_invalid_doors',
        message: `doors must be an integer in [${String(MIN_DOORS)}, ${String(MAX_DOORS)}]`,
        field: 'doors',
      }),
    );
  }
  return Result.ok(true);
}

function illegal(
  current: VehicleStatus,
  op: string,
  expected: string,
): ValidationError {
  return new ValidationError({
    code: 'vehicle_illegal_transition',
    message: `Cannot ${op} a vehicle in status "${current}" — expected ${expected}`,
    field: 'status',
  });
}
