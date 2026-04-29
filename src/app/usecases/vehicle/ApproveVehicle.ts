import type { Vehicle } from '@domain/entities/Vehicle';
import type { Vin } from '@domain/entities/Vin';
import {
  type AuthorizationError,
  type NotFoundError,
  type ValidationError,
} from '@domain/errors';
import type { VehicleRepository } from '@domain/repositories';
import type { Result } from '@domain/shared/Result';

/**
 * Admin path: approve a previously-pending vehicle. Not consumed by
 * Phase 5 UI but ships for parity with the entity's state machine and
 * to keep the admin-tooling path open.
 *
 * Note: legacy `approveVehicle` ALSO did first-vehicle auto-active —
 * the rewrite folds that behavior into `RegisterVehicle` (which
 * auto-approves immediately) and keeps this admin path strictly
 * status-only. If this use case ever becomes UI-reachable, surface the
 * auto-active behavior at that boundary, not here.
 */
export class ApproveVehicle {
  constructor(
    private readonly vehicles: VehicleRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(args: {
    vin: Vin;
  }): Promise<
    Result<Vehicle, NotFoundError | AuthorizationError | ValidationError>
  > {
    const vehicleR = await this.vehicles.getByVin(args.vin);
    if (!vehicleR.ok) return vehicleR;

    const approvedR = vehicleR.value.approve(this.clock());
    if (!approvedR.ok) return approvedR;

    return this.vehicles.update(approvedR.value);
  }
}
