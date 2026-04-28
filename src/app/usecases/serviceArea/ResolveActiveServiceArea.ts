import type { Coordinates } from '@domain/entities/Coordinates';
import type { ServiceArea } from '@domain/entities/ServiceArea';
import { NotFoundError } from '@domain/errors';
import type { ServiceAreaRepository } from '@domain/repositories';
import { Result } from '@domain/shared/Result';

/**
 * Given the user's current coordinates, find the service area whose circular
 * region contains the user.
 *
 * Differs from the legacy yeride app on purpose: legacy hardcodes
 * `setServiceArea(areas[0].identifier)` and ignores the user's location
 * entirely (which broke any future multi-region rollout). The rewrite
 * resolves properly via Haversine distance.
 *
 * Tie-break: when multiple service areas contain the user (overlapping
 * regions, e.g. a city-level area nested inside a regional one), the FIRST
 * match in the order returned by the repository wins. The repository orders
 * by document id ascending, which is stable and lets ops control ordering by
 * naming convention. We could surface a more sophisticated rule (smallest
 * radius wins, "primary" flag, etc.) when there's a real product call;
 * single-region today, no decision needed.
 *
 * Failure: NotFoundError when no area contains the user. The presentation
 * layer surfaces this as "we don't operate in your area yet" rather than as
 * an error toast.
 */
export class ResolveActiveServiceArea {
  constructor(private readonly repo: ServiceAreaRepository) {}

  async execute(
    point: Coordinates,
  ): Promise<Result<ServiceArea, NotFoundError>> {
    const all = await this.repo.listAll();
    if (!all.ok) return all;
    const found = all.value.find((a) => a.containsPoint(point));
    if (!found) {
      return Result.err(
        new NotFoundError({
          code: 'no_service_area_for_point',
          message: 'User location is not inside any service area',
          resource: 'service_area',
        }),
      );
    }
    return Result.ok(found);
  }
}
