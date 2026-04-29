import type { RideServiceId } from '@domain/entities/RideServiceId';
import type { UserId } from '@domain/entities/UserId';
import {
  Vehicle,
  type VehicleDataSource,
  type VehiclePhotos,
} from '@domain/entities/Vehicle';
import type { VehicleClass } from '@domain/entities/VehicleClass';
import type { VehicleSpecs } from '@domain/entities/VehicleSpecs';
import type { Vin } from '@domain/entities/Vin';
import {
  AuthorizationError,
  type ConflictError,
  type NotFoundError,
  type ValidationError,
} from '@domain/errors';
import type {
  AuthRepository,
  UserRepository,
  VehicleRepository,
} from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Composite registration: creates the vehicle as `'pending'`,
 * auto-approves it (legacy parity — see Phase 5 Turn 2 locked decision
 * 2), and auto-sets it as the driver's active vehicle iff they don't
 * already have one (locked decision 3).
 *
 * Auth flow:
 *   - `auth.currentUserId()` is the only source of `driverId`. The
 *     view-model can't pass someone else's UID.
 *   - `users.getById(uid)` is needed to read `activeVehicleId` for the
 *     first-vehicle check. Also fails fast with a NotFound if the user
 *     doc went missing between sign-in and registration.
 *
 * Persistence is sequenced rather than batched:
 *   1. `vehicles.create({ driverId, vehicle: pending })` — atomic
 *      vehicle-doc + user.vehicleIds[] write inside the repo.
 *   2. `vehicle.approve()` → `vehicles.update(approved)`.
 *   3. If first-vehicle: `vehicles.setActive({ driverId, vin })`.
 *
 * If step 2 or 3 fails after step 1, the doc is in `'pending'` status —
 * the driver could call `RegisterVehicle` again or use a manual retry.
 * Legacy doesn't compensate either; preserving that semantics is fine.
 */
export interface RegisterVehicleArgs {
  vin: Vin;
  make: string;
  model: string;
  year: number;
  vehicleClass: VehicleClass;
  eligibleServices: readonly RideServiceId[];
  dataSource: VehicleDataSource;
  trim?: string | null;
  bodyClass?: string | null;
  seats?: number | null;
  doors?: number | null;
  photos?: VehiclePhotos;
  stockPhoto?: string | null;
  specs?: VehicleSpecs;
}

export class RegisterVehicle {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly vehicles: VehicleRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(
    args: RegisterVehicleArgs,
  ): Promise<
    Result<
      Vehicle,
      AuthorizationError | NotFoundError | ConflictError | ValidationError
    >
  > {
    const uid = await this.auth.currentUserId();
    if (!uid) {
      return Result.err(
        new AuthorizationError({
          code: 'auth_no_current_user',
          message: 'No user is signed in',
        }),
      );
    }

    const userR = await this.users.getById(uid);
    if (!userR.ok) return userR;
    const user = userR.value;

    // Driver-only registration — riders shouldn't be able to register
    // vehicles. Legacy enforces this only in the UI; the rewrite makes
    // it an explicit use-case-level invariant.
    if (user.role !== 'driver') {
      return Result.err(
        new AuthorizationError({
          code: 'vehicle_register_role_not_driver',
          message: 'Only drivers can register vehicles',
        }),
      );
    }

    const now = this.clock();

    const pendingR = Vehicle.create({
      vin: args.vin,
      make: args.make,
      model: args.model,
      year: args.year,
      vehicleClass: args.vehicleClass,
      eligibleServices: args.eligibleServices,
      dataSource: args.dataSource,
      createdAt: now,
      ...(args.trim !== undefined ? { trim: args.trim } : {}),
      ...(args.bodyClass !== undefined ? { bodyClass: args.bodyClass } : {}),
      ...(args.seats !== undefined ? { seats: args.seats } : {}),
      ...(args.doors !== undefined ? { doors: args.doors } : {}),
      ...(args.photos !== undefined ? { photos: args.photos } : {}),
      ...(args.stockPhoto !== undefined ? { stockPhoto: args.stockPhoto } : {}),
      ...(args.specs !== undefined ? { specs: args.specs } : {}),
    });
    if (!pendingR.ok) return pendingR;

    const driverId: UserId = uid;

    const createR = await this.vehicles.create({
      driverId,
      vehicle: pendingR.value,
    });
    if (!createR.ok) return createR;

    // Auto-approve (locked decision 2: legacy parity).
    const approvedR = createR.value.approve(now);
    if (!approvedR.ok) return approvedR;
    const updateR = await this.vehicles.update(approvedR.value);
    if (!updateR.ok) return updateR;

    // First-vehicle auto-active (locked decision 3).
    if (user.activeVehicleId === null) {
      const setActiveR = await this.vehicles.setActive({
        driverId,
        vin: args.vin,
      });
      if (!setActiveR.ok) return setActiveR;
    }

    return Result.ok(updateR.value);
  }
}
