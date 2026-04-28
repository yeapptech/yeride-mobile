import type { UserId } from '@domain/entities/UserId';
import type { Vehicle } from '@domain/entities/Vehicle';
import type { Vin } from '@domain/entities/Vin';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type AuthorizationError,
  type NetworkError,
} from '@domain/errors';
import type { VehicleRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * In-memory `VehicleRepository` for use-case unit tests + the fakes
 * branch in the DI container.
 *
 * Storage model mirrors the legacy Firestore split:
 *   - `vehicles: Map<vin, Vehicle>` — the global vehicles collection
 *   - `vehicleIdsByDriver: Map<UserId, vin[]>` — `users/{uid}.vehicleIds`
 *   - `activeByDriver: Map<UserId, vin | null>` — `users/{uid}.activeVehicleId`
 *   - `servicesRideByDriver: Map<UserId, rideServiceId[]>` —
 *     `users/{uid}.services.ride`
 *
 * Subscriptions fire on every mutation that affects the watched driver.
 *
 * Test seams:
 *   - `seed(vehicle, driverId)` — populate without going through `create`,
 *     including the linkage update on `vehicleIds[]`.
 *   - `setActiveDirect(driverId, vin)` — bypasses ownership checks for
 *     tests that need to wedge the store into a particular state.
 *   - `getActive(driverId)` / `getServicesRide(driverId)` — assertion helpers.
 *   - `spies` — call-counts and last-args for the repo methods that
 *     other tests assert on.
 */
export class InMemoryVehicleRepository implements VehicleRepository {
  private vehicles = new Map<string, Vehicle>();
  private vehicleIdsByDriver = new Map<UserId, string[]>();
  private activeByDriver = new Map<UserId, string | null>();
  private servicesRideByDriver = new Map<UserId, readonly string[]>();

  private observers = new Map<
    UserId,
    Set<(vehicles: readonly Vehicle[]) => void>
  >();

  public spies = {
    create: 0,
    update: 0,
    softDelete: 0,
    setActive: 0,
    lastSetActive: null as null | { driverId: UserId; vin: Vin | null },
  };

  /* ─────────── VehicleRepository ─────────── */

  async getByVin(vin: Vin): Promise<Result<Vehicle, NotFoundError>> {
    const v = this.vehicles.get(String(vin));
    if (!v) return Result.err(this.notFound(vin));
    return Result.ok(v);
  }

  async existsByVin(vin: Vin): Promise<Result<boolean, NetworkError>> {
    const v = this.vehicles.get(String(vin));
    if (!v) return Result.ok(false);
    // Match legacy `isVINRegistered`: pending or approved counts as
    // "registered"; rejected / suspended / deleted do not block re-registration.
    if (v.status === 'pending' || v.status === 'approved') {
      return Result.ok(true);
    }
    return Result.ok(false);
  }

  async listByDriver(args: {
    driverId: UserId;
  }): Promise<Result<readonly Vehicle[], NetworkError>> {
    return Result.ok(this.computeList(args.driverId));
  }

  subscribeByDriver(args: {
    driverId: UserId;
    callback: (vehicles: readonly Vehicle[]) => void;
  }): () => void {
    let set = this.observers.get(args.driverId);
    if (!set) {
      set = new Set();
      this.observers.set(args.driverId, set);
    }
    set.add(args.callback);
    // Emit the current value synchronously so subscribers reflect initial state.
    args.callback(this.computeList(args.driverId));
    return () => {
      set?.delete(args.callback);
    };
  }

  async create(args: {
    driverId: UserId;
    vehicle: Vehicle;
  }): Promise<Result<Vehicle, ConflictError | ValidationError>> {
    this.spies.create += 1;
    const key = String(args.vehicle.vin);
    const existing = this.vehicles.get(key);
    // Match the legacy `isVINRegistered` filter: a fresh registration is
    // only blocked if the existing doc is pending/approved (rejected or
    // soft-deleted docs may be re-registered).
    if (
      existing &&
      (existing.status === 'pending' || existing.status === 'approved')
    ) {
      return Result.err(
        new ConflictError({
          code: 'vehicle_already_exists',
          message: `Vehicle ${key} already exists`,
        }),
      );
    }
    this.vehicles.set(key, args.vehicle);
    const ids = [...(this.vehicleIdsByDriver.get(args.driverId) ?? [])];
    if (!ids.includes(key)) ids.push(key);
    this.vehicleIdsByDriver.set(args.driverId, ids);
    this.notify(args.driverId);
    return Result.ok(args.vehicle);
  }

  async update(
    vehicle: Vehicle,
  ): Promise<
    Result<Vehicle, NotFoundError | AuthorizationError | ValidationError>
  > {
    this.spies.update += 1;
    const key = String(vehicle.vin);
    if (!this.vehicles.has(key)) {
      return Result.err(this.notFound(vehicle.vin));
    }
    this.vehicles.set(key, vehicle);
    // Notify every driver subscription that could observe this VIN.
    for (const driverId of this.driversOwning(key)) {
      this.notify(driverId);
    }
    return Result.ok(vehicle);
  }

  async softDelete(args: {
    driverId: UserId;
    vin: Vin;
  }): Promise<Result<true, NotFoundError | ValidationError>> {
    this.spies.softDelete += 1;
    const key = String(args.vin);
    const vehicle = this.vehicles.get(key);
    if (!vehicle) return Result.err(this.notFound(args.vin));
    const ids = this.vehicleIdsByDriver.get(args.driverId) ?? [];
    if (!ids.includes(key)) {
      return Result.err(
        new ValidationError({
          code: 'vehicle_not_owned_by_driver',
          message: `Driver ${String(args.driverId)} does not own vehicle ${key}`,
          field: 'vin',
        }),
      );
    }
    const markedR = vehicle.markDeleted(new Date());
    if (!markedR.ok) return markedR;
    this.vehicles.set(key, markedR.value);
    this.vehicleIdsByDriver.set(
      args.driverId,
      ids.filter((v) => v !== key),
    );
    if (this.activeByDriver.get(args.driverId) === key) {
      this.activeByDriver.set(args.driverId, null);
    }
    this.notify(args.driverId);
    return Result.ok(true);
  }

  async setActive(args: {
    driverId: UserId;
    vin: Vin | null;
  }): Promise<
    Result<true, NotFoundError | AuthorizationError | ValidationError>
  > {
    this.spies.setActive += 1;
    this.spies.lastSetActive = {
      driverId: args.driverId,
      vin: args.vin,
    };
    if (args.vin === null) {
      this.activeByDriver.set(args.driverId, null);
      this.notify(args.driverId);
      return Result.ok(true);
    }
    const key = String(args.vin);
    const vehicle = this.vehicles.get(key);
    if (!vehicle) return Result.err(this.notFound(args.vin));
    const ids = this.vehicleIdsByDriver.get(args.driverId) ?? [];
    if (!ids.includes(key)) {
      return Result.err(
        new ValidationError({
          code: 'vehicle_not_owned_by_driver',
          message: `Driver ${String(args.driverId)} does not own vehicle ${key}`,
          field: 'vin',
        }),
      );
    }
    if (vehicle.status !== 'approved') {
      return Result.err(
        new ValidationError({
          code: 'vehicle_not_approved',
          message: `Vehicle ${key} is not approved (status="${vehicle.status}")`,
          field: 'status',
        }),
      );
    }
    this.activeByDriver.set(args.driverId, key);
    // Propagate eligibleServices to user.services.ride (legacy parity).
    this.servicesRideByDriver.set(
      args.driverId,
      vehicle.eligibleServices.map(String),
    );
    this.notify(args.driverId);
    return Result.ok(true);
  }

  /* ─────────── Test-only helpers ─────────── */

  /** Seed a vehicle directly (bypasses create's conflict check). */
  seed(vehicle: Vehicle, driverId: UserId): void {
    const key = String(vehicle.vin);
    this.vehicles.set(key, vehicle);
    const ids = [...(this.vehicleIdsByDriver.get(driverId) ?? [])];
    if (!ids.includes(key) && vehicle.status !== 'deleted') ids.push(key);
    this.vehicleIdsByDriver.set(driverId, ids);
    this.notify(driverId);
  }

  /** Bypass-ownership setActive for state-priming in tests. */
  setActiveDirect(driverId: UserId, vin: Vin | null): void {
    this.activeByDriver.set(driverId, vin === null ? null : String(vin));
    this.notify(driverId);
  }

  getActive(driverId: UserId): string | null {
    return this.activeByDriver.get(driverId) ?? null;
  }

  getServicesRide(driverId: UserId): readonly string[] | null {
    return this.servicesRideByDriver.get(driverId) ?? null;
  }

  reset(): void {
    this.vehicles.clear();
    this.vehicleIdsByDriver.clear();
    this.activeByDriver.clear();
    this.servicesRideByDriver.clear();
    this.observers.clear();
    this.spies = {
      create: 0,
      update: 0,
      softDelete: 0,
      setActive: 0,
      lastSetActive: null,
    };
  }

  /* ─────────── private ─────────── */

  private notFound(vin: Vin): NotFoundError {
    return new NotFoundError({
      code: 'vehicle_not_found',
      message: `Vehicle ${String(vin)} not found`,
      resource: 'vehicle',
      id: String(vin),
    });
  }

  private computeList(driverId: UserId): readonly Vehicle[] {
    const ids = this.vehicleIdsByDriver.get(driverId) ?? [];
    const out: Vehicle[] = [];
    for (const vin of ids) {
      const v = this.vehicles.get(vin);
      if (!v) continue;
      out.push(v);
    }
    out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return out;
  }

  private notify(driverId: UserId): void {
    const set = this.observers.get(driverId);
    if (!set) return;
    const list = this.computeList(driverId);
    for (const callback of set) {
      callback(list);
    }
  }

  private *driversOwning(vin: string): Iterable<UserId> {
    for (const [driverId, ids] of this.vehicleIdsByDriver) {
      if (ids.includes(vin)) yield driverId;
    }
  }
}
