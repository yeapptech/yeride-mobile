import type { Vehicle } from '@domain/entities/Vehicle';
import type { Vin } from '@domain/entities/Vin';
import type { NotFoundError } from '@domain/errors';
import type { VehicleRepository } from '@domain/repositories';
import type { Result } from '@domain/shared/Result';

/**
 * Trivial wrap of `VehicleRepository.getByVin`. Exists as a use case so
 * presentation has a single seam to mock and so admin / vehicle-detail
 * surfaces don't reach into the repository layer directly.
 */
export class GetVehicle {
  constructor(private readonly vehicles: VehicleRepository) {}

  execute(args: { vin: Vin }): Promise<Result<Vehicle, NotFoundError>> {
    return this.vehicles.getByVin(args.vin);
  }
}
