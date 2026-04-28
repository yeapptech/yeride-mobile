import type { RideService } from '@domain/entities/RideService';
import type { ServiceAreaId } from '@domain/entities/ServiceAreaId';
import type { ServiceAreaRepository } from '@domain/repositories';
import type { Result } from '@domain/shared/Result';

/**
 * List the ride-tier catalog (Economy / XL / Premium / …) for a given
 * service area. Ordered by costPerKm ascending so the cheapest tier shows
 * first — matches the legacy app's RiderHome ordering.
 *
 * Empty list is a valid result. The presentation layer should treat it as
 * "no rides offered in this region yet" rather than as a fault.
 */
export class ListRideServices {
  constructor(private readonly repo: ServiceAreaRepository) {}

  execute(
    areaId: ServiceAreaId,
  ): Promise<Result<readonly RideService[], never>> {
    return this.repo.listRideServices(areaId);
  }
}
