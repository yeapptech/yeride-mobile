import type { UserId } from '../entities/UserId';
import type { Vehicle } from '../entities/Vehicle';
import type { Vin } from '../entities/Vin';
import type {
  AuthorizationError,
  ConflictError,
  NetworkError,
  NotFoundError,
  ValidationError,
} from '../errors';
import type { Result } from '../shared/Result';

/**
 * Read/write access to `vehicles/{vin}` documents and the cross-aggregate
 * driver↔vehicle linkage on `users/{uid}` (`vehicleIds[]`,
 * `activeVehicleId`, `services.ride`).
 *
 * Why the user-doc fields live on this interface, not on `UserRepository`:
 * vehicle ownership and active-vehicle selection are vehicle-aggregate
 * concerns. The repository implementation (Turn 2) writes both documents
 * in the same transaction so the driver doc never observes a vehicleIds
 * array out of sync with the vehicles collection.
 *
 * Subscription methods return synchronous unsubscribe per the project
 * rule (legacy `subscribeToDriverVehicles` was already sync-unsubscribe;
 * preserve it).
 */
export interface VehicleRepository {
  /** One-shot fetch by VIN. NotFound when the document doesn't exist. */
  getByVin(vin: Vin): Promise<Result<Vehicle, NotFoundError>>;

  /**
   * Cheap existence check — used by `RegisterVehicle` to reject duplicate
   * registrations without hydrating the full doc. Returns `true` if a
   * non-deleted, non-rejected vehicle with this VIN exists (matches the
   * legacy `isVINRegistered` filter).
   */
  existsByVin(vin: Vin): Promise<Result<boolean, NetworkError>>;

  /**
   * One-shot list of vehicles owned by `driverId`, sorted by createdAt
   * descending. Mirrors legacy `getDriverVehicles`: returns the vehicles
   * still in the driver's `vehicleIds[]` array. Soft-deleted vehicles are
   * unlinked from `vehicleIds[]` by `softDelete` and therefore do not
   * appear in this list — by design (matches legacy semantics).
   */
  listByDriver(args: {
    driverId: UserId;
  }): Promise<Result<readonly Vehicle[], NetworkError>>;

  /**
   * Live subscription to the driver's vehicle list. Mirrors legacy
   * `subscribeToDriverVehicles`: watches the user doc for vehicleIds
   * changes, then fans out per-vehicle subscriptions and emits a single
   * sorted array on every change. Synchronous unsubscribe. Same
   * soft-delete-unlink semantics as `listByDriver`.
   */
  subscribeByDriver(args: {
    driverId: UserId;
    callback: (vehicles: readonly Vehicle[]) => void;
  }): () => void;

  /**
   * Create a new vehicle and link it to the driver in a single
   * transaction. Conflict if a non-deleted/non-rejected doc with the same
   * VIN already exists.
   */
  create(args: {
    driverId: UserId;
    vehicle: Vehicle;
  }): Promise<Result<Vehicle, ConflictError | ValidationError>>;

  /**
   * Persist any non-status-cross-cutting transition produced by the
   * entity (`approve`, `reject`, `suspend`, `attachPhoto`,
   * `setEligibleServices`, `setStockPhoto`). Implementations should write
   * with merge semantics so unknown fields legacy may have written are
   * preserved.
   */
  update(
    vehicle: Vehicle,
  ): Promise<
    Result<Vehicle, NotFoundError | AuthorizationError | ValidationError>
  >;

  /**
   * Soft-delete a vehicle: flip status to `'deleted'`, remove the VIN
   * from `users/{driverId}.vehicleIds[]`, and clear
   * `users/{driverId}.activeVehicleId` if it pointed at this VIN. All
   * three writes happen transactionally.
   */
  softDelete(args: {
    driverId: UserId;
    vin: Vin;
  }): Promise<Result<true, NotFoundError | ValidationError>>;

  /**
   * Set (or clear) the driver's active vehicle. When `vin` is non-null,
   * verifies ownership and propagates `vehicle.eligibleServices` to
   * `users/{driverId}.services.ride` to mirror legacy `setActiveVehicle`.
   * When `vin` is `null`, clears the pointer (the driver can't go online
   * without an active vehicle — Phase 5 enforces this in
   * `useDriverHomeViewModel`).
   */
  setActive(args: {
    driverId: UserId;
    vin: Vin | null;
  }): Promise<
    Result<true, NotFoundError | AuthorizationError | ValidationError>
  >;
}
