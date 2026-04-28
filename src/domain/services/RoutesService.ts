import type { Coordinates } from '../entities/Coordinates';
import type { Route } from '../entities/Route';
import type { NetworkError, NotFoundError, ValidationError } from '../errors';
import type { Result } from '../shared/Result';

/**
 * Abstraction over the Google Routes API ("v2:computeRoutes"). Domain code
 * talks only to this interface; the data layer's `GoogleRoutesService`
 * speaks HTTPS and the curated FieldMask.
 *
 * Why a service and not a repository: repositories model persistence (CRUD
 * over a resource collection); services model operations against an
 * external system. Routes are computed on demand, never stored, never
 * re-read by id.
 *
 * Inputs:
 *   - `origin` / `destination` are sum types — a Google Places `placeId` OR
 *     a `Coordinates` lat/lng pair. The Routes API accepts both shapes.
 *     Mixed (placeId at one end, coords at the other) is allowed and
 *     supported by Google.
 *   - `options.alternatives` requests `computeAlternativeRoutes: true` —
 *     up to ~3 routes returned. Default false.
 *   - `options.tolls` requests `extraComputations: ['TOLLS']` so each
 *     route's `tollPrice` is populated. Default false.
 *
 * Failure modes:
 *   - `NetworkError` — HTTP error, timeout, malformed JSON, or any infra
 *     failure. The presentation layer surfaces as "Couldn't compute route
 *     — try again".
 *   - `NotFoundError` — Google returned 200 with `routes: []`. No route
 *     exists between the points (e.g. a remote island). Surface as "No
 *     drivable route found".
 *   - `ValidationError` — input was malformed before we hit the wire
 *     (e.g. neither `placeId` nor `coordinates` set on origin).
 */
export type RoutesEndpoint =
  | { readonly placeId: string }
  | { readonly coordinates: Coordinates };

export interface ComputeRoutesArgs {
  readonly origin: RoutesEndpoint;
  readonly destination: RoutesEndpoint;
  readonly options?: ComputeRoutesOptions;
}

export interface ComputeRoutesOptions {
  /** Request alternative routes (Google returns up to ~3). Default false. */
  readonly alternatives?: boolean;
  /** Request toll-price computation. Default false. */
  readonly tolls?: boolean;
}

export interface RoutesService {
  computeRoutes(
    args: ComputeRoutesArgs,
  ): Promise<
    Result<readonly Route[], NetworkError | NotFoundError | ValidationError>
  >;
}
