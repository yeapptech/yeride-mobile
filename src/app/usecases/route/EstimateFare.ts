import type { Money } from '@domain/entities/Money';
import type { RideService } from '@domain/entities/RideService';
import type { RideServiceSnapshot } from '@domain/entities/RideServiceSnapshot';
import type { Route } from '@domain/entities/Route';
import type { ValidationError } from '@domain/errors';
import { FareCalculator } from '@domain/services';
import type { Result } from '@domain/shared/Result';

/**
 * Pre-trip fare estimate for a (route × ride-service) pair.
 *
 * Pulled out as a use case (rather than letting the view-model call
 * `FareCalculator.estimate` directly) so the presentation layer has a
 * single seam to mock in tests and so future refactors — caching,
 * server-side fare authority, fuel-surcharge multipliers, surge — can
 * land here without touching screens.
 *
 * Returns the fare as `Money` (USD minor units). The view-model formats
 * it for display.
 *
 * Legacy yeride called this `calculateRangeFare` and returned a single
 * number. The "range" naming was a vestige of a commented-out
 * `fare * 1.19` upper bound. We follow the legacy behavior for parity;
 * Phase 6 can revisit if product wants an explicit min-max display.
 */
export class EstimateFare {
  execute(args: {
    route: Route;
    rideService: RideService | RideServiceSnapshot;
  }): Result<Money, ValidationError> {
    return FareCalculator.estimate({
      rideService: args.rideService,
      distanceMeters: args.route.distanceMeters,
      durationSeconds: args.route.durationSeconds,
    });
  }
}
