import { Coordinates } from '@domain/entities/Coordinates';
import { Money } from '@domain/entities/Money';
import { Route } from '@domain/entities/Route';
import type {
  NetworkError,
  NotFoundError,
  ValidationError,
} from '@domain/errors';
import type { ComputeRoutesArgs, RoutesService } from '@domain/services';
import { Result } from '@domain/shared/Result';

/**
 * In-memory `RoutesService` for use-case tests and the dev fakes branch
 * in the DI container. Returns scripted Route fixtures rather than calling
 * Google. Configurable behaviour:
 *
 *   - `seed(routes)` — return this exact list on the next call.
 *   - `seedError(error)` — return a Result.err with this domain error.
 *   - by default, returns one default-shaped route.
 *
 * The fake also captures every call so tests can assert that the use case
 * built the request body correctly (alternatives flag, tolls flag, the
 * origin / destination shapes).
 */
export class FakeRoutesService implements RoutesService {
  public spies: ComputeRoutesArgs[] = [];

  private nextResult:
    | { type: 'routes'; routes: readonly Route[] }
    | { type: 'error'; error: NetworkError | NotFoundError | ValidationError }
    | null = null;

  async computeRoutes(
    args: ComputeRoutesArgs,
  ): Promise<
    Result<readonly Route[], NetworkError | NotFoundError | ValidationError>
  > {
    this.spies.push(args);
    if (this.nextResult?.type === 'error') {
      const e = this.nextResult.error;
      this.nextResult = null;
      return Result.err(e);
    }
    if (this.nextResult?.type === 'routes') {
      const routes = this.nextResult.routes;
      this.nextResult = null;
      return Result.ok(routes);
    }
    return Result.ok([defaultRoute()]);
  }

  /* ────────── Test-only helpers ────────── */

  seed(routes: readonly Route[]): void {
    this.nextResult = { type: 'routes', routes };
  }

  seedError(error: NetworkError | NotFoundError | ValidationError): void {
    this.nextResult = { type: 'error', error };
  }

  reset(): void {
    this.spies = [];
    this.nextResult = null;
  }
}

function defaultRoute(): Route {
  const start = Coordinates.create(25.7617, -80.1918);
  const end = Coordinates.create(26.1224, -80.1373);
  if (!start.ok) throw start.error;
  if (!end.ok) throw end.error;
  const tollPrice = Money.fromMajor(1.5, 'USD');
  if (!tollPrice.ok) throw tollPrice.error;
  const r = Route.create({
    distanceMeters: 5_320,
    durationSeconds: 740,
    distanceText: '3.3 mi',
    durationText: '12 mins',
    encodedPolyline: '_p~iF~ps|U_ulLnnqC',
    startLocation: start.value,
    endLocation: end.value,
    routeLabels: ['DEFAULT_ROUTE'],
    tollPrice: tollPrice.value,
    routeToken: 'fake-route-token',
    description: 'via I-95 N (fake)',
  });
  if (!r.ok) throw r.error;
  return r.value;
}
