import type { Route } from '@domain/entities/Route';
import type {
  NetworkError,
  NotFoundError,
  ValidationError,
} from '@domain/errors';
import type { ComputeRoutesArgs, RoutesService } from '@domain/services';
import type { Result } from '@domain/shared/Result';

/**
 * Compute one or more drivable routes between origin and destination.
 *
 * Thin pass-through over `RoutesService.computeRoutes`. Future enhancements
 * that warrant business logic (e.g. caching, fallback to a cheaper API,
 * inferring "tolls: true" automatically when the user has saved-place tolls
 * preferences) live here; for now there's nothing the use case adds beyond
 * existing as the presentation layer's seam.
 */
export class ComputeRoutes {
  constructor(private readonly service: RoutesService) {}

  execute(
    args: ComputeRoutesArgs,
  ): Promise<
    Result<readonly Route[], NetworkError | NotFoundError | ValidationError>
  > {
    return this.service.computeRoutes(args);
  }
}
