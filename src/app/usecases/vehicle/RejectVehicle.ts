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
 * Admin path: reject a pending vehicle with required notes. Not
 * consumed by Phase 5 UI; ships for parity with the entity's state
 * machine.
 */
export class RejectVehicle {
  constructor(
    private readonly vehicles: VehicleRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(args: {
    vin: Vin;
    notes: string;
  }): Promise<
    Result<Vehicle, NotFoundError | AuthorizationError | ValidationError>
  > {
    const vehicleR = await this.vehicles.getByVin(args.vin);
    if (!vehicleR.ok) return vehicleR;

    const rejectedR = vehicleR.value.reject({
      notes: args.notes,
      at: this.clock(),
    });
    if (!rejectedR.ok) return rejectedR;

    return this.vehicles.update(rejectedR.value);
  }
}
